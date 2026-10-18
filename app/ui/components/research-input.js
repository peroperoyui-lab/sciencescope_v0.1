// Main, secretary and assistant share the same attachment controls and draft.
import { useEffect, useRef } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { InfoTip } from './info-tip.js';
import { MarksPopover } from './marks-popover.js';
import { navigate } from '../route.js';

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
  const hideWindow = useAppState(
    (state) => state.settings?.composer?.hideWindowOnScreenshot ?? true,
  );
  const picker = useRef(null);
  async function screenshot() {
    const invoke = globalThis.__TAURI__?.core?.invoke;
    if (!invoke) {
      actions.openModal(
        t('截图'),
        html`<${InfoTip} text=${t('使用系统截图后，在输入框中粘贴。')} />`,
      );
      return;
    }
    await actions.attempt(async () => {
      const base64 = await invoke('capture_screenshot', { hideWindow });
      if (!base64) return;
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      await actions.attachInput(owner, projectId, [
        new File([bytes], `Screenshot-${Date.now()}.png`, { type: 'image/png' }),
      ]);
    });
  }
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
      type="button"
      class="ss-icon-btn"
      aria-label=${t('添加材料')}
      data-tip=${t('添加文件或资料')}
      onClick=${(event) =>
        actions.openMenu(event, [
          { text: t('文件'), icon: 'paperclip', run: () => picker.current.click() },
          {
            text: t('截图'),
            icon: 'file',
            run: screenshot,
          },
          {
            text: t('引用'),
            icon: 'quote',
            run: () => actions.showMaterials({ owner, projectId }),
          },
        ])}
    >
      <${Lucide} name="plus" />
    </button>
  </span>`;
}

/**
 * @param {{owner:string,projectId?:string|null,value:any}} props
 */
export function InputAttachments({ owner, value }) {
  const actions = useActions();
  if (!value.materials.length && !value.marks.length) return null;
  return html`<div class="ss-composer__files attachmentbar">
    <${MarksPopover} owner=${owner} marks=${value.marks} />
    ${value.materials.map(
      (entry) =>
        html`<span class="ss-file-chip" key=${entry.selectionId}>
          <${Lucide} name=${entry.type === 'source' ? 'book-open' : 'file-text'} />
          <button
            type="button"
            class="ss-file-chip__open"
            onClick=${(event) =>
              actions.openMenu(event, [
                ...(entry.type === 'source'
                  ? [
                      {
                        text: t('预览'),
                        icon: 'eye',
                        run: () => actions.openPreview({ kind: 'source', id: entry.id, owner }),
                      },
                    ]
                  : []),
                {
                  text: t('打开'),
                  icon: 'external-link',
                  run: () =>
                    entry.type === 'source'
                      ? actions.attempt(() => actions.openResearchSource(entry.id))
                      : showInputContext(actions, { materials: [entry], marks: [] }),
                },
              ])}
          >
            ${entry.title}
          </button>
          <button
            type="button"
            aria-label=${t('移除附件')}
            data-tip=${t('移除附件')}
            onClick=${() =>
              actions.attempt(() =>
                actions.changeInput(owner, { op: 'remove', selectionId: entry.selectionId }),
              )}
          >
            <${Lucide} name="x" small=${true} />
          </button>
        </span>`,
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
                } else if (entry.type === 'version-notes') {
                  actions.closeModal();
                  navigate({ view: 'version-notes', id: entry.key });
                }
              }}
            >
              ${entry.title}</button
            >${['item', 'version-notes'].includes(entry.type) && html`<p>${entry.text}</p>`}
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
  const images = input.materials.filter((entry) => entry.type === 'image');
  const files = input.materials.filter((entry) => entry.type !== 'image');
  return html`<div class="ss-msg__files" data-input-receipt>
    ${images.map(
      (image) =>
        html`<button
          type="button"
          class="ss-msg__thumb"
          key=${image.selectionId ?? image.id}
          aria-label=${t('查看图片 {name}', { name: image.name })}
          data-tip=${image.name}
          onClick=${() =>
            actions.openModal(
              image.name,
              html`<img
                class="input-image-full"
                src=${actions.inputImageUrl(image.url)}
                alt=${image.name}
              />`,
              'image-modal',
            )}
        >
          <img src=${actions.inputImageUrl(image.url)} alt="" loading="lazy" />
        </button>`,
    )}
    ${files.map(
      (entry) =>
        html`<span class="ss-file-chip" key=${entry.selectionId ?? entry.id}>
          <${Lucide} name=${entry.type === 'source' ? 'book-open' : 'file-text'} />
          <button
            type="button"
            class="ss-file-chip__open"
            onClick=${() => showInputContext(actions, input)}
          >
            ${entry.title}
          </button>
        </span>`,
    )}
    ${
      input.marks.length > 0 &&
      html`<span class="ss-file-chip">
        <${Lucide} name="sticky-note" />
        <button
          type="button"
          class="ss-file-chip__open"
          onClick=${() => showInputContext(actions, input)}
        >
          ${t('标记 {count} 条', { count: input.marks.length })}
        </button>
      </span>`
    }
  </div>`;
}
