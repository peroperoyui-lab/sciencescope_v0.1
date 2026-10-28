import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { parseRoute } from '../route.js';
import { markHighlight } from '../mark-ranges.js';

export function MarkSelection() {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const messages = useAppState((state) => state.messages);
  const participants = useAppState((state) => state.participants);
  const preview = useAppState((state) => state.previewTarget);
  const [selection, setSelection] = useState(null);
  const [comment, setComment] = useState('');
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const pop = useRef(null),
    note = useRef(null);
  const close = () => {
    setSelection(null);
    markHighlight('research-pending', []);
  };
  // The listener reads the latest state through a ref: a message can render and
  // be selected before an effect would have re-subscribed with the new list.
  const latest = useRef({ messages, participants, preview });
  latest.current = { messages, participants, preview };
  useEffect(() => {
    const select = () => {
      const state = latest.current;
      const current = getSelection();
      if (!current?.rangeCount || current.isCollapsed || !current.toString().trim()) return;
      const range = current.getRangeAt(0);
      const node =
        range.commonAncestorContainer.nodeType === 1
          ? range.commonAncestorContainer
          : range.commonAncestorContainer.parentElement;
      const element = /** @type {Element} */ (node);
      if (element.closest('[data-mark-selection],[data-marks-popover]')) return;
      const messageNode = element.closest('[data-message-id],[data-assistant-message]');
      const file = element.closest('[data-preview-doc]');
      let owner, mark;
      if (messageNode && element.closest('.message-text')) {
        const id =
          messageNode.getAttribute('data-message-id') ??
          messageNode.getAttribute('data-assistant-message');
        const message = Object.values(state.messages)
          .flat()
          .find((entry) => entry.id === id);
        if (!message) return;
        owner = message.meetingId;
        mark = {
          meetingId: owner,
          messageId: id,
          speaker:
            state.participants.find((person) => person.id === message.authorId)?.name ??
            message.authorId,
          text: current.toString(),
        };
      } else if (file) {
        const route = parseRoute();
        owner = state.preview?.owner ?? (route.view === 'meeting' ? route.id.split('/')[0] : null);
        if (!owner) {
          actions.toast(t('请先打开一个对话，再添加标记。'));
          return;
        }
        const page = element.closest('.page');
        const before = document.createRange();
        before.selectNodeContents(file);
        before.setEnd(range.startContainer, range.startOffset);
        const line = before.toString().split('\n').length;
        const paragraph = element.closest('p,li,h1,h2,h3,h4,h5,h6,tr');
        const paragraphIndex = paragraph
          ? [...file.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,tr')].indexOf(paragraph) + 1
          : null;
        mark = {
          sourceId: file.getAttribute('data-resource-id'),
          target: state.preview,
          title: document
            .querySelector('.file-preview-toolbar .ss-select__value')
            ?.textContent?.trim(),
          text: current.toString(),
          location: page
            ? {
                page: Number(page.getAttribute('data-page-number')),
                offset: before.toString().length,
              }
            : {
                line,
                paragraph: paragraphIndex,
                offset: before.toString().length,
                description: paragraphIndex
                  ? t('第 {number} 段', { number: paragraphIndex })
                  : t('第 {number} 行', { number: line }),
              },
        };
      } else return;
      setComment('');
      setSelection({ owner, mark, rect: range.getBoundingClientRect() });
      markHighlight('research-pending', [range.cloneRange()]);
    };
    document.addEventListener('mouseup', select);
    return () => document.removeEventListener('mouseup', select);
  }, []);
  useLayoutEffect(() => {
    if (!selection || !pop.current) return;
    const { width, height } = pop.current.getBoundingClientRect(),
      rect = selection.rect;
    setPosition({
      left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)),
      top: Math.max(
        8,
        Math.min(
          rect.bottom + height + 8 < innerHeight ? rect.bottom + 8 : rect.top - height - 8,
          innerHeight - height - 8,
        ),
      ),
    });
    note.current?.focus({ preventScroll: true });
  }, [selection]);
  useEffect(() => {
    if (!selection) return;
    const outside = (event) => {
      if (!pop.current?.contains(event.target)) close();
    };
    const escape = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [selection]);
  async function add(target = 'own') {
    await actions.attempt(async () => {
      let owner = selection.owner;
      if (target === 'assistant') owner = (await actions.assistantSnapshot(true)).id;
      if (target === 'secretary') {
        const meeting = meetings.find((entry) => entry.id === owner);
        owner = (await actions.secretarySnapshot(meeting?.attachedToMeetingId ?? owner, true))
          .meeting.id;
      }
      await actions.changeInput(owner, { op: 'mark-add', mark: { ...selection.mark, comment } });
      close();
      getSelection()?.removeAllRanges();
    });
  }
  if (!selection) return null;
  return html`<div
    class="ss-pop ss-mark-pop"
    data-mark-selection
    ref=${pop}
    role="dialog"
    aria-label=${t('添加标记')}
    style=${{ left: position.left + 'px', top: position.top + 'px' }}
  >
    <div class="ss-pop__body">
      <blockquote class="ss-quote ss-marks__text">${selection.mark.text}</blockquote>
      <textarea
        ref=${note}
        class="ss-textarea"
        rows="2"
        aria-label=${t('标记备注')}
        placeholder=${t('备注（可选）· Enter 添加，Shift+Enter 换行')}
        value=${comment}
        onInput=${(event) => setComment(event.currentTarget.value)}
        onKeyDown=${(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.isComposing &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            void add();
          }
        }}
      ></textarea>
    </div>
    <div class="ss-pop__foot ss-mark-pop__foot">
      <span class="ss-mark-pop__more">
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => add('secretary')}
        >
          ${t('引用至任务秘书')}
        </button>
        <button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => add('assistant')}
        >
          ${t('引用至全局助手')}
        </button>
        <button
          type="button"
          class="ss-icon-btn ss-icon-btn--sm"
          aria-label=${t('复制')}
          data-tip=${t('复制')}
          onClick=${() => navigator.clipboard.writeText(selection.mark.text).then(close)}
        >
          <${Lucide} name="copy" />
        </button>
      </span>
      <button type="button" class="ss-btn ss-btn--primary ss-btn--sm" onClick=${() => add()}>
        ${t('添加标记')}
      </button>
    </div>
  </div>`;
}
