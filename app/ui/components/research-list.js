import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { InfoTip } from './info-tip.js';
import {
  authorText,
  researchLabel,
  sourceKinds,
  researchSubtypes,
  ResearchHighlight,
} from './research-fields.js';

/** @param {{tab:string,filters:any,onFilter:(key:string,value:string)=>void}} props */
export function ResearchFilters({ tab, filters, onFilter }) {
  const select = (key, title, options) =>
    html`<select
      aria-label=${t(title)}
      value=${filters[key]}
      onChange=${(event) => onFilter(key, event.currentTarget.value)}
    >
      ${options.map((entry) => {
        const [value, text] = Array.isArray(entry) ? entry : [entry, researchLabel(entry)];
        return html`<option value=${value}>${text}</option>`;
      })}
    </select>`;
  return html`<div class="rb-filters">
    ${
      tab === 'sources'
        ? html` ${select('kind', '类型', [['', t('全部类型')], ...sourceKinds])}${select('readStatus', '阅读状态', [['', t('全部阅读状态')], 'unread', 'reading', 'read'])}
            <input
              aria-label=${t('按标签筛选')}
              placeholder=${t('按标签筛选')}
              value=${filters.tag}
              onChange=${(event) => onFilter('tag', event.currentTarget.value)}
            />
            ${select('sort', '排序', [
              ['addedAt', t('导入时间')],
              ['title', t('标题')],
              ['year', t('年份')],
            ])}${select('direction', '排序方向', [
              ['desc', t('降序')],
              ['asc', t('升序')],
            ])}`
        : html` ${select('subtype', '子类型', [['', t('全部子类型')], ...researchSubtypes[tab]])}${select('status', '状态', ['active', 'archived', 'superseded'])}${select(
            'pinned',
            '置顶',
            [
              ['', t('全部条目')],
              ['true', t('仅置顶')],
              ['false', t('未置顶')],
            ],
          )}`
    }
  </div>`;
}
/** @param {{sources:any[],onAction:(action:string,source:any)=>void}} props */
export function ResearchSources({ sources, onAction }) {
  const button = (text, action, source) =>
    html`<button type="button" class="btn tiny" onClick=${() => onAction(action, source)}>
      ${t(text)}
    </button>`;
  return html`<div class="rb-table-scroll">
    <table class="table">
      <thead>
        <tr>
          ${['标签', '标题', '作者', '年份', '期刊或来源', '类型', '解析状态', '阅读状态', '标签', '操作'].map((title) => html`<th>${t(title)}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${sources.map((source) => {
          const metadata = source.metadata ?? {};
          return html`<tr data-rb-source=${source.id}>
            <td>${source.label}</td>
            <td>${source.title}</td>
            <td>${authorText(metadata.authors)}</td>
            <td>${metadata.year ?? '—'}</td>
            <td>${metadata.venue ?? '—'}</td>
            <td>${researchLabel(source.kind)}</td>
            <td>
              ${researchLabel(source.contentStatus)}${source.parseError && html`<${InfoTip} text=${source.parseError} />`}
            </td>
            <td>${researchLabel(metadata.readStatus ?? 'unread')}</td>
            <td>${(metadata.tags ?? []).join(', ')}</td>
            <td>
              <div class="rb-row-actions">
                ${source.originalPath && button('打开原件', 'open', source)}${button('详情', 'detail', source)}${button('编辑元数据', 'edit-source', source)}${source.originalPath && button('重新解析', 'reparse', source)}
              </div>
            </td>
          </tr>`;
        })}
      </tbody>
    </table>
  </div>`;
}
/** @param {{hits:any[],query:string,mode:string,onHit:(hit:any)=>void}} props */
export function ResearchSearchResults({ hits, query, mode, onHit }) {
  return html`<div data-rb-search-results>
    <p role="status">${mode === 'hybrid' ? t('本次为混合检索') : t('本次为关键词检索')}</p>
    ${['item', 'source', 'chunk'].map((type) => {
      const selected = hits.filter((hit) => hit.type === type);
      return (
        selected.length > 0 &&
        html`<section>
          <h3>${t({ item: '条目', source: '文献与资料', chunk: '段落' }[type])}</h3>
          ${selected.map(
            (hit) =>
              html`<article class="card rb-card">
                <button class="btn tiny" data-hit-type=${type} onClick=${() => onHit(hit)}>
                  ${hit.title}
                </button>
                <p><${ResearchHighlight} text=${hit.text ?? ''} query=${query} /></p>
                <code>${hit.citation}</code>
              </article>`,
          )}
        </section>`
      );
    })}
  </div>`;
}
