// Files presented with an answer (workspace_present), folded into one line
// under it like a coding agent's 编辑了 N 个文件: names at a glance, a list
// with thumbnails when opened. A file opens with the system's default app;
// the context menu previews it inside ScienceScope.
import { useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

/** @param {{ files?: any[] }} props */
export function Deliverables({ files = [] }) {
  const actions = useActions();
  const [open, setOpen] = useState(false);
  if (!files.length) return null;
  const preview = (event, file) =>
    actions.openMenu(event, [
      { text: t('预览'), run: () => actions.openPreview({ kind: 'deliverable', id: file.id }) },
    ]);
  return html`<div class="ss-files" data-deliverables data-open=${open || undefined}>
    <button
      type="button"
      class="ss-files__head"
      aria-expanded=${open}
      onClick=${() => setOpen(!open)}
    >
      <${Lucide} name="files" />
      <span class="ss-files__count">${t('交付了 {n} 个文件', { n: files.length })}</span>
      ${!open && html`<span class="ss-files__names">${files.map((file) => file.name).join('、')}</span>`}
      <${Lucide} name="chevron-down" class="ss-files__chev" />
    </button>
    ${
      open &&
      html`<div class="ss-files__list" aria-label=${t('交付物')}>
        ${files.map((file) => {
          const image = file.mediaType.startsWith('image/');
          return html`<button
            key=${file.id}
            type="button"
            class="ss-files__row"
            data-deliverable=${file.id}
            data-kind=${image ? 'image' : 'document'}
            title=${`${t('打开交付物')} · ${file.description || file.name}`}
            onClick=${() => actions.attempt(() => actions.openDeliverable(file.id))}
            onContextMenu=${(event) => preview(event, file)}
          >
            ${
              image
                ? html`<span class="ss-files__thumb"
                    ><img
                      src=${actions.deliverableContent(file.id)}
                      alt=${file.description || file.name}
                  /></span>`
                : html`<span class="ss-files__icon"><${Lucide} name="file-text" /></span>`
            }
            <span class="ss-files__name">${file.name}</span>
            ${file.description && html`<span class="ss-files__desc">${file.description}</span>`}
          </button>`;
        })}
      </div>`
    }
  </div>`;
}
