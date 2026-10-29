// Main, secretary and assistant share the same attachment controls and draft.
import { useEffect, useRef } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { MarksPopover } from './marks-popover.js';
import { deskReference } from '../desk-assist.js';
import { deskEnabled, focusDesk } from '../desk-window.js';

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
        html`<div class="ss-dialog__body">
          <p>${t('使用系统截图后，在输入框中粘贴。')}</p>
        </div>`,
        'sm',
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
  // Sentences quoted from the desk show their words (PageDeskChat); other marks
  // stay behind the 标记 toggle.
  const quotes = value.marks.filter((mark) => mark.manuscriptKey && deskReference(mark));
  const others = value.marks.filter((mark) => !quotes.includes(mark));
  return html`<div class="ss-composer__files" data-input-attachments>
    ${quotes.map(
      (mark) =>
        html`<span class="ss-file-chip" key=${mark.id} data-desk-quote>
          <${Lucide} name="text-quote" />
          <button
            type="button"
            class="ss-file-chip__open"
            data-tip=${[mark.title, mark.location?.description].filter(Boolean).join(' · ')}
            onClick=${() => actions.attempt(() => focusDesk(actions, deskReference(mark)))}
          >
            “${mark.text}”
          </button>
          <button
            type="button"
            aria-label=${t('移除引用')}
            data-tip=${t('移除引用')}
            onClick=${() =>
              actions.attempt(() => actions.changeInput(owner, { op: 'mark-remove', id: mark.id }))}
          >
            <${Lucide} name="x" small=${true} />
          </button>
        </span>`,
    )}
    <${MarksPopover} owner=${owner} marks=${others} />
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
  const open = (entry) => {
    if (entry.type === 'source') {
      actions.closeModal();
      actions.openPreview({ kind: 'source', id: entry.id });
    }
  };
  actions.openModal(
    t('本次上下文'),
    html`<div class="ss-dialog__body" data-input-context>
      ${
        input.materials.length > 0 &&
        html`<div class="ss-list">
          ${input.materials.map(
            (entry) =>
              html`<div
                class=${`ss-list-row ${entry.text ? 'ss-list-row--2' : ''} ${entry.type === 'source' ? 'ss-list-row--link' : ''}`}
                key=${entry.selectionId ?? entry.id}
                onClick=${() => open(entry)}
              >
                <${Lucide}
                  name=${entry.type === 'source' ? 'book-open' : 'file-text'}
                  class="ss-list-row__icon"
                />
                <div class="ss-list-row__main">
                  <span class="ss-list-row__title">${entry.title}</span>
                  ${
                    ['item', 'version-notes'].includes(entry.type) &&
                    entry.text &&
                    html`<span class="ss-list-row__sub">${entry.text}</span>`
                  }
                </div>
              </div>`,
          )}
        </div>`
      }
      ${input.marks.map(
        (mark) =>
          html`<blockquote class="ss-quote" key=${mark.id}>
            ${mark.text} ${mark.comment && html`<div class="ss-quote__src">${mark.comment}</div>`}
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
  const desk = useAppState((state) => deskEnabled(state.settings));
  const input = message.researchInput ?? EMPTY;
  // Sentences of desk documents open on the desk; other marks stay in the receipt.
  const cited = desk ? input.marks.filter((mark) => deskReference(mark)) : [];
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
              html`<div class="ss-dialog__body">
                <img
                  class="ss-dialog__image"
                  src=${actions.inputImageUrl(image.url)}
                  alt=${image.name}
                />
              </div>`,
              'lg',
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
    ${cited.map(
      (mark, index) =>
        html`<span class="ss-file-chip" key=${mark.selectionId ?? mark.id ?? index}>
          <${Lucide} name="file-pen" />
          <button
            type="button"
            class="ss-file-chip__open"
            data-desk-mark
            data-tip=${t('在编辑台打开这句：{text}', { text: mark.text })}
            onClick=${() => actions.attempt(() => focusDesk(actions, deskReference(mark)))}
          >
            ${[mark.title, mark.location?.description].filter(Boolean).join(' · ')}
          </button>
        </span>`,
    )}
    ${
      input.marks.length > cited.length &&
      html`<span class="ss-file-chip">
        <${Lucide} name="sticky-note" />
        <button
          type="button"
          class="ss-file-chip__open"
          onClick=${() => showInputContext(actions, input)}
        >
          ${t('标记 {count} 条', { count: input.marks.length - cited.length })}
        </button>
      </span>`
    }
  </div>`;
}
