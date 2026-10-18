import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';
import { SidePanel } from './side-panel.js';

/**
 * @param {{target:{owner:string,projectId:string|null}}} props
 */
export function MaterialsPanel({ target }) {
  const actions = useActions();
  const draft = useAppState((state) => state.researchDrafts[target.owner]);
  const version = useAppState((state) => state.researchVersion);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState({ rows: [], more: false });
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      const options = { projectId: target.projectId ?? '', offset, limit: 50 };
      let rows, more;
      if (query) {
        const found = await actions.researchSearch(query, options);
        const unique = [
          ...new Map(
            found.hits.map((hit) => [hit.type === 'item' ? hit.id : (hit.sourceId ?? hit.id), hit]),
          ).values(),
        ];
        rows = unique.map((hit) => ({
          ...hit,
          type: hit.type === 'item' ? 'item' : 'source',
          id: hit.type === 'item' ? hit.id : (hit.sourceId ?? hit.id),
        }));
        more = found.remaining > 0;
      } else {
        const [sources, items] = await Promise.all([
          actions.researchSources(options),
          actions.researchItems({ ...options, status: 'active' }),
        ]);
        rows = [
          ...sources.sources.map((source) => ({ ...source, type: 'source' })),
          ...items
            .filter((item) => item.visibility === 'shared')
            .map((item) => ({ ...item, type: 'item' })),
        ];
        more = sources.remaining > 0 || items.length === 50;
      }
      if (active) setResult({ rows, more });
    };
    load().catch((failure) => {
      if (active) setError(failure.message);
    });
    return () => {
      active = false;
    };
  }, [target.owner, query, offset, version]);
  return html`<${SidePanel}
    name="materials"
    title="项目材料与引用"
    closeLabel="关闭侧栏"
    className="materials-panel"
    onClose=${() => actions.showMaterials(null)}
    buttons=${html`<${InfoTip} text=${t('选择来源或共享条目加入当前输入；不会自动发送。')} />`}
  >
    <div class="ss-panel__body">
      <div class="rb-materials">
        <form
          onSubmit=${(event) => {
            event.preventDefault();
            setOffset(0);
            setQuery(text);
          }}
        >
          <span class="ss-input"
            ><input
              aria-label=${t('搜索资料与条目')}
              placeholder=${t('搜索资料与条目')}
              value=${text}
              onInput=${(event) => setText(event.currentTarget.value)} /></span
          ><button class="ss-btn ss-btn--sm">${t('搜索')}</button>
        </form>
        ${error && html`<p role="alert">${error}</p>`}
        <div class="rb-materials-list">
          ${result.rows.map((entry) => html`<label key=${entry.id}><input type="checkbox" checked=${draft?.materials.some((old) => old.id === entry.id)} onChange=${(event) => actions.attempt(() => actions.changeInput(target.owner, event.currentTarget.checked ? { op: 'add', material: entry } : { op: 'remove', selectionId: draft.materials.find((old) => old.id === entry.id)?.selectionId }))} />${entry.label ? entry.label + ' · ' : ''}${entry.title}</label>`)}
        </div>
        <div class="rb-pagination">
          <button
            class="ss-btn ss-btn--sm"
            disabled=${offset === 0}
            onClick=${() => setOffset(offset - 50)}
          >
            ${t('上一页')}</button
          ><button
            class="ss-btn ss-btn--sm"
            disabled=${!result.more}
            onClick=${() => setOffset(offset + 50)}
          >
            ${t('下一页')}
          </button>
        </div>
      </div>
    </div>
  <//>`;
}
