// Main, secretary and assistant share the same attachment controls and draft.
import { useEffect, useRef } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { InfoTip } from './info-tip.js';
import { MarksPopover } from './marks-popover.js';

const EMPTY = { materials: [], marks: [] };

/**
 * @param {string} owner
 * @param {string|null} projectId
 */
export function useResearchInput(owner, projectId) {
  const actions = useActions();
  const value = useAppState((state) => state.researchDrafts[owner] ?? EMPTY);
  useEffect(() => {
    if (owner) void actions.attempt(() => actions.loadInput(owner));
  }, [owner]);
  const attach = (files) =>
    actions.attempt(() => actions.attachInput(owner, projectId, [...files]));
  return {
    value,
    onDrop(event) {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault();
      void attach(event.dataTransfer.files);
    },
    onDragOver(event) {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    },
    onPaste(event) {
      if (!event.clipboardData?.files.length) return;
      event.preventDefault();
      void attach(event.clipboardData.files);
    },
    consume: (sent) => actions.changeInput(owner, { op: 'consume', input: sent }),
  };
}

/**
 * @param {{owner:string,projectId?:string|null,value:any}} props
 */
export function InputAdd({ owner, projectId = null }) {
  const actions = useActions();
  const picker = useRef(null);
  return html`<span class="input-add">
    <input
      ref=${picker}
      type="file"
      multiple
      hidden
      data-input-files
      onChange=${(event) => {
        const files = [...event.currentTarget.files];
        event.currentTarget.value = '';
        void actions.attempt(() => actions.attachInput(owner, projectId, files));
      }}
    />
    <button
      class="ref-chip"
      aria-label=${t('添加材料')}
      onClick=${(event) =>
        actions.openMenu(event, [
          { text: t('文件'), run: () => picker.current.click() },
          {
            text: t('截图'),
            run: () =>
              actions.openModal(
                t('截图'),
                html`<${InfoTip} text=${t('使用系统截图后，在输入框中粘贴。')} />`,
              ),
          },
          { text: t('引用'), run: () => actions.showMaterials({ owner, projectId }) },
        ])}
    >
      <${Icon} name="plus" />
    </button>
  </span>`;
}

/**
 * @param {{owner:string,projectId?:string|null,value:any}} props
 */
export function InputAttachments({ owner, value }) {
  const actions = useActions();
  if (!value.materials.length && !value.marks.length) return null;
  return html`<div class="research-input-chips attachmentbar">
    <${MarksPopover} owner=${owner} marks=${value.marks} />
    ${value.materials.map(
      (entry) =>
        html`<button
          class="ref-chip"
          key=${entry.selectionId}
          onClick=${(event) =>
            actions.openMenu(event, [
              ...(entry.type === 'source'
                ? [
                    {
                      text: t('预览'),
                      run: () => actions.openPreview({ kind: 'source', id: entry.id, owner }),
                    },
                  ]
                : []),
              {
                text: t('打开'),
                run: () =>
                  entry.type === 'source'
                    ? actions.attempt(() => actions.openResearchSource(entry.id))
                    : showInputContext(actions, { materials: [entry], marks: [] }),
              },
              {
                text: t('移除附件'),
                run: () =>
                  actions.attempt(() =>
                    actions.changeInput(owner, { op: 'remove', selectionId: entry.selectionId }),
                  ),
              },
            ])}
        >
          ${entry.title}
        </button>`,
    )}
  </div>`;
}

/**
 * @param {import('../actions.js').Actions} actions
 * @param {any} input
 */
export function showInputContext(actions, input) {
  actions.openModal(
    t('本次上下文'),
    html`<div class="context-receipt">
      ${input.materials.map(
        (entry) =>
          html`<div class="receipt-materials">
            <button
              class="ref-chip"
              onClick=${() => {
                if (entry.type === 'source') {
                  actions.closeModal();
                  actions.openPreview({ kind: 'source', id: entry.id });
                }
              }}
            >
              ${entry.title}</button
            >${entry.type === 'item' && html`<p>${entry.text}</p>`}
          </div>`,
      )}
      ${input.marks.map(
        (mark) =>
          html`<blockquote>
            ${mark.text}
            <p>${mark.comment}</p>
          </blockquote>`,
      )}
    </div>`,
  );
}

/**
 * @param {{message:any}} props
 */
export function InputReceipt({ message }) {
  const actions = useActions();
  const input = message.researchInput ?? EMPTY;
  if (!input.materials.length && !input.marks.length) return null;
  return html`<button class="research-receipt" onClick=${() => showInputContext(actions, input)}>
    ${[t('标记 {count} 条', { count: input.marks.length }), t('材料 {count} 份', { count: input.materials.length })].join(' · ')}
  </button>`;
}
