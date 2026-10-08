import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { DocumentReader } from './document-reader.js';

export function FilePreview() {
  const actions = useActions();
  const target = useAppState((state) => state.previewTarget);
  const [doc, setDoc] = useState(null);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setDoc(null);
    setError('');
    if (target)
      actions
        .previewDocument(target)
        .then(async (value) => {
          if (!active) return;
          setDoc(value);
          const result = await actions.researchSources({ projectId: value.projectId ?? '' });
          if (active) setSources(result.sources);
        })
        .catch((failure) => {
          if (active) setError(failure.message);
        });
    return () => {
      active = false;
    };
  }, [target?.kind, target?.id, target?.path]);
  if (!target) return null;
  return html`<aside class="rightpanel file-preview-panel">
    <div class="panelhead between">
      <h2>${t('文件预览与标记')}</h2>
      <button aria-label=${t('关闭侧栏')} onClick=${() => actions.openPreview(null)}>
        <${Icon} name="close" />
      </button>
    </div>
    <div class="panelbody file-preview-body">
      <div class="file-preview-toolbar">
        <select
          aria-label=${t('选择要预览的资料')}
          value=${target.id ?? ''}
          onChange=${(event) => actions.openPreview({ kind: 'source', id: event.currentTarget.value, owner: target.owner })}
        >
          ${!sources.some((source) => source.id === target.id) && html`<option value=${target.id ?? ''}>${doc?.name ?? t('正在读取…')}</option>`}
          ${sources.map((source) => html`<option value=${source.id}>${source.title}</option>`)}</select
        ><button
          class="btn tiny"
          onClick=${() => actions.attempt(() => actions.openPreviewOriginal(target))}
        >
          ${t('打开原件')}
        </button>
      </div>
      ${error && html`<p role="alert">${error}</p>`}
      <div class="file-preview-content">
        ${doc && html`<${DocumentReader} key=${JSON.stringify([target.kind, target.id, target.path])} doc=${doc} target=${target} />`}
      </div>
    </div>
  </aside>`;
}
