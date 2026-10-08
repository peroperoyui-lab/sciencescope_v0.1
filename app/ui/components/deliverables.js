import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions } from '../context.js';
import { Icon } from '../icons.js';

/** Original presented bytes and descriptions are owned by the host. */
export function Deliverables({ files = [] }) {
  const actions = useActions();
  if (!files.length) return null;
  return html`<div class="deliverables" aria-label=${t('交付物')}>
    ${files.map((file) => {
      const image = file.mediaType.startsWith('image/');
      return html`<button
        key=${file.id}
        type="button"
        class=${`deliverable ${image ? 'is-image' : 'is-document'}`}
        data-deliverable=${file.id}
        title=${`${t('打开交付物')} · ${file.description || file.name}`}
        onClick=${() => actions.attempt(() => actions.openDeliverable(file.id))}
        onContextMenu=${(event) => actions.openMenu(event, [{ text: t('预览'), run: () => actions.openPreview({ kind: 'deliverable', id: file.id }) }])}
      >
        ${image ? html`<span class="deliverable-thumb"><img src=${actions.deliverableContent(file.id)} alt=${file.description || file.name} /></span>` : html`<span class="deliverable-icon"><${Icon} name="file" /></span>`}
        <span class="deliverable-text"
          ><b>${file.name}</b>${file.description && html`<small>${file.description}</small>`}</span
        >
      </button>`;
    })}
  </div>`;
}
