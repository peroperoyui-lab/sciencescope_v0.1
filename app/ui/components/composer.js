// The main input box in the old interface's markup (`.composer`), shared by
// the welcome page and meetings: the context ring, the model and reasoning
// menus (the default model in settings) and send / stop.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { Outbox } from './outbox.js';
import { DiscussionMode } from './discussion-strip.js';
import { DiscussionUsageRing } from './discussion-usage.js';
import { useDiscussion } from './discussion-state.js';
import { useDiscussionMention } from './discussion-mention.js';
import { InputAdd, InputAttachments, useResearchInput } from './research-input.js';

function useModelMenu() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const current = settings?.models?.default;
  const choices = (settings?.providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      provider: provider.id,
      model: model.id,
      text: `${provider.name ?? provider.id} · ${model.name ?? model.id}`,
    })),
  );
  const label = current
    ? (choices.find((c) => c.provider === current.provider && c.model === current.model)?.text ??
      `${current.provider} · ${current.model}`)
    : t('未连接模型');
  const open = (event) => {
    actions.openMenu(
      event,
      [
        ...choices.map((choice) => ({
          text: choice.text,
          check: current?.provider === choice.provider && current?.model === choice.model,
          run: () =>
            actions.attempt(() =>
              actions.updateSettings({
                // A different model has its own efforts; start from its default.
                models: {
                  default: { provider: choice.provider, model: choice.model, effort: null },
                },
              }),
            ),
        })),
        ...(choices.length ? [{ sep: true }] : []),
        {
          text: t('管理模型与 API'),
          icon: 'gear',
          run: () => navigate({ view: 'settings', id: 'models' }),
        },
      ],
      t('模型'),
    );
  };
  return { label, open };
}

/** Reasoning effort of the default model, from the efforts the model lists. */
function useEffortMenu() {
  const actions = useActions();
  const settings = useAppState((state) => state.settings);
  const current = settings?.models?.default;
  const model = (settings?.providers ?? [])
    .find((provider) => provider.id === current?.provider)
    ?.models.find((candidate) => candidate.id === current?.model);
  const efforts = model?.efforts ?? [];
  const choose = (effort) =>
    actions.attempt(() =>
      // Settings patches merge, so "model default" is stored as null.
      actions.updateSettings({ models: { default: { ...current, effort: effort || null } } }),
    );
  const open = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('模型默认'), check: !current?.effort, run: () => choose('') },
        ...efforts.map((effort) => ({
          text: effort,
          check: current?.effort === effort,
          run: () => choose(effort),
        })),
      ],
      t('思考强度'),
    );
  return { label: current?.effort || t('模型默认'), open, disabled: !current };
}

/**
 * @param {{ onSend: (text: string, input?:any) => Promise<any>, running?: boolean,
 *   onStop?: () => void, inputRef?: any, meetingId?: string, projectId?:string|null }} props
 */
export function Composer({
  onSend,
  running = false,
  onStop,
  inputRef,
  meetingId,
  projectId = null,
}) {
  const actions = useActions();
  const sendKey = useAppState((state) => state.settings?.composer?.sendKey ?? 'enter');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const owner = meetingId ?? `new:${projectId ?? 'global'}`;
  const researchInput = useResearchInput(owner, projectId);
  const ownRef = useRef(null);
  const box = inputRef ?? ownRef;
  const model = useModelMenu();
  const effort = useEffortMenu();
  const quote = useAppState((state) => state.quote);
  const fillDraft = useAppState((state) => state.fillDraft);
  const discussion = useDiscussion(meetingId);
  const mention = useDiscussionMention({
    candidates: discussion.candidates,
    enabled: Boolean(meetingId) && !discussion.ordered,
    box,
    text,
    onChange: setText,
  });

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
    const sent = await actions.attempt(() => onSend(value, snapshot));
    setSending(false);
    if (sent !== undefined) {
      setText((current) => (current === text ? '' : current));
      if (!meetingId) await actions.attempt(() => researchInput.consume(snapshot));
    }
  }

  return html`<div
    class="composer"
    data-composer="main"
    onDrop=${researchInput.onDrop}
    onDragOver=${researchInput.onDragOver}
    onPaste=${researchInput.onPaste}
  >
    <${InputAttachments} owner=${owner} projectId=${projectId} value=${researchInput.value} />
    ${meetingId && html`<${Outbox} meetingId=${meetingId} />`}
    <textarea
      ref=${box}
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
    <div class="composerbar">
      <${InputAdd} owner=${owner} projectId=${projectId} value=${researchInput.value} />
      <${DiscussionMode} meetingId=${meetingId} running=${running} />
      <span class="spacer"></span>
      <${DiscussionUsageRing} meetingId=${meetingId} />
      <button data-v="model-menu" onClick=${model.open}>
        ${model.label} <${Icon} name="down" />
      </button>
      <button data-v="reasoning-menu" disabled=${effort.disabled} onClick=${effort.open}>
        ${effort.label}
      </button>
      ${
        running &&
        html`<button
          class="sendbtn"
          data-main-stop
          aria-label=${t('停止当前回复')}
          title=${t('停止当前回复')}
          onClick=${onStop}
        >
          ■
        </button>`
      }
      <button
        class="sendbtn"
        aria-label=${t('发送')}
        disabled=${!text.trim() || sending}
        onClick=${send}
      >
        <${Icon} name="arrow" />
      </button>
    </div>
  </div>`;
}
