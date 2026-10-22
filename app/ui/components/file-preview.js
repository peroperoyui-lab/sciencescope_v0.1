import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { deskEnabled, openDesk } from '../desk-window.js';
import { deskKind } from './desk-nav.js';
import { DocumentReader } from './document-reader.js';
import { ChoiceMenu } from './popover.js';
import { SidePanel } from './side-panel.js';

export function FilePreview() {
  const actions = useActions();
  const target = useAppState((state) => state.previewTarget);
  const desk = deskEnabled(useAppState((state) => state.settings));
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
          const result = await actions.previewSources(value.projectId);
          if (active) setSources(result);
        })
        .catch((failure) => {
          if (active) setError(failure.message);
        });
    return () => {
      active = false;
    };
  }, [target?.kind, target?.id, target?.path]);
  if (!target) return null;
  const listed = sources.some((source) => source.id === target.id);
  const choices = [
    ...(listed ? [] : [{ id: target.id ?? '', title: doc?.name ?? t('正在读取…') }]),
    ...sources,
  ];
  return html`<${SidePanel}
    name="preview"
    title="文件预览与标记"
    closeLabel="关闭侧栏"
    defaultWidth=${440}
    className="file-preview-panel"
    onClose=${() => actions.openPreview(null)}
  >
    <div class="file-preview-toolbar">
      <${ChoiceMenu}
        label=${t('选择要预览的资料')}
        triggerClass="ss-select file-preview-select"
        items=${choices.map((source) => ({
          text: source.title,
          selected: source.id === target.id,
          run: () => actions.openPreview({ kind: 'source', id: source.id, owner: target.owner }),
        }))}
      >
        <span class="ss-select__value">${doc?.name ?? t('正在读取…')}</span>
      <//>
      <button
        type="button"
        class="ss-btn ss-btn--sm"
        onClick=${() => actions.attempt(() => actions.openPreviewOriginal(target))}
      >
        <${Lucide} name="external-link" /><span>${t('打开原件')}</span>
      </button>
      ${
        desk &&
        target.kind === 'project' &&
        deskKind(target.path ?? '') &&
        html`<button
          type="button"
          class="ss-btn ss-btn--sm"
          data-tip=${t('在独立窗口打开编辑台')}
          onClick=${() =>
            actions.attempt(() => openDesk({ projectId: target.projectId, path: target.path }))}
        >
          <${Lucide} name="file-pen" /><span>${t('在编辑台打开')}</span>
        </button>`
      }
    </div>
    ${error && html`<div class="ss-status ss-status--fail file-preview-error" role="alert">${error}</div>`}
    <div class="file-preview-content">
      ${doc && html`<${DocumentReader} key=${JSON.stringify([target.kind, target.id, target.path])} doc=${doc} target=${target} />`}
    </div>
  <//>`;
}
