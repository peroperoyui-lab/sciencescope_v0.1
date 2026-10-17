// The main input box (design system Composer), shared by the welcome page and
// meetings: attachments, the auto-growing input and one bar with the add
// menu, work and execution modes, the context ring, the model picker and one
// send / stop button.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Outbox } from './outbox.js';
import { DiscussionMode } from './discussion-strip.js';
import { DiscussionUsageRing } from './discussion-usage.js';
import { useDiscussion } from './discussion-state.js';
import { useDiscussionMention } from './discussion-mention.js';
import { InputAdd, InputAttachments, useResearchInput } from './research-input.js';
import { ExecutionMode } from './execution-mode.js';
import { ModelPicker } from './model-picker.js';

// A floating layer is open: Esc belongs to it, not to the running answer.
const LAYERS = '.ss-menu, .ss-pop, .ss-dialog, #v-menu, .modalback, .command-palette';

/**
 * @param {{ onSend: (text: string, input?:any, approval?:'ask' | 'auto') => Promise<any>, running?: boolean,
 *   onStop?: () => void, inputRef?: any, meetingId?: string, projectId?:string|null,
 *   onGoal?: (text:string,input:any,maxRounds:number,approval?:'ask' | 'auto')=>Promise<any> }} props
 */
export function Composer({
  onSend,
  running = false,
  onStop,
  inputRef,
  meetingId,
  projectId = null,
  onGoal,
}) {
  const actions = useActions();
  const sendKey = useAppState((state) => state.settings?.composer?.sendKey ?? 'enter');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const owner = meetingId ?? `new:${projectId ?? 'global'}`;
  const researchInput = useResearchInput(owner, projectId);
  const ownRef = useRef(null);
  const box = inputRef ?? ownRef;
  const quote = useAppState((state) => state.quote);
  const fillDraft = useAppState((state) => state.fillDraft);
  const discussion = useDiscussion(meetingId);
  const goal = useAppState((state) => state.goals[meetingId]);
  const [executionMode, setExecutionMode] = useState('direct');
  // Approval is part of the meeting's rules; before the meeting exists the
  // choice waits here and is passed when the first message creates it.
  const [draftApproval, setDraftApproval] = useState('ask');
  const approval = meetingId ? (discussion.policy.approval ?? 'ask') : draftApproval;
  const chooseMode = (mode) => {
    setExecutionMode(mode === 'autonomous' ? 'autonomous' : 'direct');
    const next = mode === 'approval' ? 'ask' : 'auto';
    if (!meetingId) setDraftApproval(next);
    else if (next !== approval) discussion.save({ approval: next });
  };
  const [maxRounds, setMaxRounds] = useState(30);
  const goalActive = goal && ['running', 'paused', 'blocked'].includes(goal.status);
  const startsGoal = executionMode === 'autonomous' && !discussion.ordered && !goalActive;
  const mention = useDiscussionMention({
    candidates: discussion.candidates,
    enabled: Boolean(meetingId) && !discussion.ordered,
    box,
    text,
    onChange: setText,
  });

  // The input grows with its text up to the stylesheet's max-height.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [text]);

  // Esc stops the answer when no floating layer is open and the input is empty.
  useEffect(() => {
    if (!running || !onStop) return undefined;
    /** @param {KeyboardEvent} event */
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector(LAYERS))
        return;
      if (box.current?.value.trim()) return;
      event.preventDefault();
      onStop();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [running, onStop]);

  // "引用到输入框" from a message of this meeting.
  useEffect(() => {
    if (!quote || quote.meetingId !== meetingId) return;
    setText(
      (current) => `${current}${current && !current.endsWith('\n') ? '\n' : ''}${quote.text}`,
    );
    box.current?.focus();
  }, [quote]);

  // A filled secretary proposal is still an unsent draft. Consume its request
  // once so remounting the composer does not overwrite later user edits.
  useEffect(() => {
    if (!fillDraft || fillDraft.meetingId !== meetingId) return;
    setText(fillDraft.text);
    box.current?.focus();
    actions.consumeMainDraft(fillDraft.at);
  }, [fillDraft]);

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    if (
      discussion.ordered &&
      !discussion.experts.some(
        (expert) =>
          (discussion.policy.order ?? []).includes(expert.id) &&
          expert.id !== discussion.policy.reviewer,
      )
    ) {
      actions.toast(t('请在讨论条上至少选择一位作答专家。'));
      return;
    }
    mention.close();
    setSending(true);
    // Keep the draft until the host accepts the message.
    const snapshot = researchInput.value;
    const sent = await actions.attempt(() =>
      startsGoal ? onGoal(value, snapshot, maxRounds, 'auto') : onSend(value, snapshot, approval),
    );
    setSending(false);
    if (sent !== undefined) {
      setText((current) => (current === text ? '' : current));
      if (!meetingId) await actions.attempt(() => researchInput.consume(snapshot));
    }
  }

  // While an answer runs the button stops it; typed text is queued instead.
  const stops = running && !text.trim() && Boolean(onStop);
  const roundsInvalid = startsGoal && (!Number.isSafeInteger(maxRounds) || maxRounds < 1);
  const auto = executionMode === 'autonomous' || Boolean(goalActive);
  return html`<div class="ss-composer-wrap">
    <div
      class="ss-composer"
      data-composer="main"
      data-mode=${auto && !discussion.ordered ? 'auto' : undefined}
      onDrop=${researchInput.onDrop}
      onDragOver=${researchInput.onDragOver}
      onPaste=${researchInput.onPaste}
    >
      <${InputAttachments} owner=${owner} projectId=${projectId} value=${researchInput.value} />
      ${meetingId && html`<${Outbox} meetingId=${meetingId} />`}
      <textarea
        ref=${box}
        class="ss-composer__input"
        rows="1"
        value=${text}
        placeholder=${t('输入问题或下一步工作…')}
        aria-label=${t('主输入框')}
        onInput=${(event) => {
          setText(event.currentTarget.value);
          if (!event.isComposing) mention.update(event.currentTarget);
        }}
        onCompositionEnd=${(event) => mention.update(event.currentTarget)}
        onClick=${(event) => mention.update(event.currentTarget)}
        onKeyDown=${(event) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (mention.onKey(event)) return;
          if (event.key !== 'Enter' || event.shiftKey) return;
          const wantsModifier = sendKey === 'ctrl-enter';
          if (wantsModifier === (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            send();
          }
        }}
      ></textarea>
      ${mention.content}
      <div class="ss-composer__bar">
        <${InputAdd} owner=${owner} projectId=${projectId} value=${researchInput.value} />
        <${DiscussionMode} meetingId=${meetingId} running=${running} />
        ${onGoal && html`<${ExecutionMode} mode=${goalActive || (executionMode === 'autonomous' && !discussion.ordered) ? 'autonomous' : approval === 'ask' ? 'approval' : 'direct'} onChange=${chooseMode} ordered=${discussion.ordered} locked=${Boolean(goalActive) || running} />`}
        ${
          startsGoal &&
          html`<label class="goal-rounds"
            >${t('最多轮数')}<input
              type="number"
              min="1"
              step="1"
              aria-label=${t('发送目标最多轮数')}
              value=${maxRounds}
              onInput=${(event) => setMaxRounds(Number(event.currentTarget.value))}
          /></label>`
        }
        <span class="ss-composer__spacer"></span>
        <${DiscussionUsageRing} meetingId=${meetingId} />
        <${ModelPicker} />
        ${
          stops
            ? html`<button
                type="button"
                class="ss-send"
                data-state="running"
                aria-label=${t('停止')}
                data-tip=${t('停止')}
                data-kbd="Esc"
                onClick=${onStop}
              >
                <span class="ss-send__stop"></span>
              </button>`
            : html`<button
                type="button"
                class="ss-send"
                aria-label=${t('发送')}
                data-tip=${running ? t('发送（排队，当前回答结束后发出）') : t('发送')}
                data-kbd=${sendKey === 'ctrl-enter' ? 'Ctrl Enter' : 'Enter'}
                disabled=${!text.trim() || sending || roundsInvalid}
                onClick=${send}
              >
                <${Lucide} name="arrow-up" />
              </button>`
        }
      </div>
    </div>
  </div>`;
}
