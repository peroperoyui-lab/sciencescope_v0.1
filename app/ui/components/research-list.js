// The knowledge page's toolbar filters and its list rows (design system
// List): one row per source, item or entity; a click selects it and opens
// the node detail panel, ⋯ and right-click open the row's menu.
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { useActions } from '../context.js';
import { ChoiceMenu, usePopover } from './popover.js';
import { entityKinds, kindIcon, kindLabel, shortDate } from './knowledge-fields.js';
import {
  authorText,
  researchLabel,
  sourceKinds,
  researchSubtypes,
  ResearchHighlight,
} from './research-fields.js';

/** Filters that differ from the defaults, so the funnel can show it is on. */
export const filterKeys = {
  sources: ['kind', 'contentStatus', 'readStatus', 'tag'],
  entities: ['entityKind', 'label', 'origin'],
  items: ['subtype', 'pinned'],
};

/**
 * @param {{tab:string,filters:any,onFilter:(key:string,value:string)=>void,onClear:()=>void}} props
 */
export function ResearchFilters({ tab, filters, onFilter, onClear }) {
  const pop = usePopover({ placement: 'bottom-start' });
  const group = tab === 'sources' || tab === 'entities' ? tab : 'items';
  const active =
    filterKeys[group].some((key) => filters[key]) ||
    (group === 'items' && filters.status !== 'active');
  const choice = (key, title, options) => {
    const entries = options.map((entry) =>
      Array.isArray(entry) ? entry : [entry, researchLabel(entry)],
    );
    const current = entries.find(([value]) => value === filters[key]) ?? entries[0];
    return html`<div class="ss-pop__section">
      <span class="ss-pop__label">${t(title)}</span>
      <${ChoiceMenu}
        label=${t(title)}
        triggerClass="ss-select ss-select--sm"
        placement="bottom-start"
        items=${entries.map(([value, text]) => ({
          text,
          selected: value === filters[key],
          run: () => onFilter(key, value),
        }))}
      >
        <span class="ss-select__value">${current[1]}</span>
      <//>
    </div>`;
  };
  const text = (key, title) =>
    html`<div class="ss-pop__section">
      <span class="ss-pop__label">${t(title)}</span>
      <span class="ss-input ss-input--sm"
        ><${Lucide} name="tag" /><input
          aria-label=${t(title)}
          placeholder=${t('输入标签名')}
          value=${filters[key]}
          onChange=${(event) => onFilter(key, event.currentTarget.value.trim())}
      /></span>
    </div>`;
  return html`<button
      type="button"
      ref=${pop.trigger}
      class="ss-icon-btn"
      aria-label=${t('筛选')}
      aria-haspopup="dialog"
      aria-expanded=${pop.open}
      aria-pressed=${String(active)}
      data-tip=${t('筛选')}
      onClick=${pop.toggle}
    >
      <${Lucide} name="funnel" />
    </button>
    ${
      pop.open &&
      html`<div ref=${pop.layer} class="ss-pop kb-filter" role="dialog" aria-label=${t('筛选')}>
        <div class="ss-pop__body">
          ${
            group === 'sources'
              ? html`${choice('kind', '类型', [['', t('全部类型')], ...sourceKinds])}
                ${choice('contentStatus', '解析状态', [
                  ['', t('全部状态')],
                  'parsed',
                  'partial',
                  'queued',
                  'failed',
                  ['unsupported', t('仅索引文件名')],
                ])}
                ${choice('readStatus', '阅读状态', [['', t('全部阅读状态')], 'unread', 'reading', 'read'])}
                ${text('tag', '按标签筛选')}`
              : group === 'entities'
                ? html`${choice('entityKind', '种类', [
                      ['', t('全部种类')],
                      ...entityKinds.map((kind) => [kind, kindLabel(kind)]),
                    ])}
                    ${text('label', '按标签筛选')}
                    <div class="ss-pop__section">
                      <label class="ss-check"
                        ><input
                          type="checkbox"
                          checked=${filters.origin === 'ai'}
                          onChange=${(event) =>
                            onFilter('origin', event.currentTarget.checked ? 'ai' : '')}
                        /><span>${t('只看 AI 添加的')}</span></label
                      >
                    </div>`
                : html`${choice('subtype', '子类型', [['', t('全部子类型')], ...(researchSubtypes[tab] ?? [])])}
                  ${choice('status', '状态', ['active', 'archived', 'superseded'])}
                  ${choice('pinned', '置顶', [
                    ['', t('全部条目')],
                    ['true', t('仅置顶')],
                    ['false', t('未置顶')],
                  ])}`
          }
        </div>
        <div class="ss-pop__foot">
          <span class="ss-muted">${t('筛选立即生效')}</span>
          <button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${onClear}>
            ${t('清除')}
          </button>
        </div>
      </div>`
    }`;
}

/** One list row; the caller fills the middle. */
function Row({ selected, attrs, icon, kind, title, sub, children, menu, onSelect, preview }) {
  const actions = useActions();
  const open = (event) => actions.openMenu(event, menu(), title);
  return html`<div
    class="ss-list-row ss-list-row--2"
    role="option"
    tabindex="0"
    aria-selected=${String(selected)}
    onClick=${onSelect}
    onKeyDown=${(event) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) onSelect();
    }}
    onContextMenu=${open}
    ...${attrs}
  >
    ${icon === 'spin' ? html`<span class="ss-spin"></span>` : html`<span class="ss-list-row__icon kb-row-icon" data-node-kind=${kind}><${Lucide} name=${icon} /></span>`}
    <div class="ss-list-row__main">
      <span class="ss-list-row__title">${title}</span>
      ${sub && html`<span class="ss-list-row__sub">${sub}</span>`}
    </div>
    ${children}
    <span class="ss-list-row__actions">
      ${
        preview &&
        html`<button
          type="button"
          class="ss-icon-btn ss-icon-btn--sm"
          aria-label=${t('预览')}
          data-tip=${t('预览')}
          onClick=${(event) => {
            event.stopPropagation();
            preview();
          }}
        >
          <${Lucide} name="eye" />
        </button>`
      }
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('更多')}
        data-tip=${t('更多')}
        onClick=${open}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </span>
  </div>`;
}

const relations = (count) =>
  html`<span class="ss-list-row__meta">${count ? t('{n} 条关系', { n: count }) : '—'}</span>`;
const time = (iso) =>
  html`<span class="ss-list-row__meta ss-list-row__meta--time">${shortDate(iso)}</span>`;

/** Parse state as a result and its next step; no batches or percentages. @param {any} source */
export function sourceStatus(source) {
  const status = source.contentStatus;
  if (status === 'parsed') return html`<span class="ss-tag ss-tag--ok">${t('已解析')}</span>`;
  if (status === 'partial')
    return html`<span class="ss-tag ss-tag--warn" data-tip=${source.parseError ?? undefined}
      >${t('部分解析')}</span
    >`;
  if (status === 'failed')
    return html`<span class="ss-tag ss-tag--warn" data-tip=${source.parseError ?? undefined}
      >${t('解析失败')}</span
    >`;
  if (status === 'queued') return html`<span class="ss-tag">${t('等待解析')}</span>`;
  if (status === 'unsupported')
    return html`<span
      class="ss-tag"
      data-tip=${t('这种格式不解析内容，专家能按文件名和位置找到它。')}
      >${t('仅索引文件名')}</span
    >`;
  if (!source.originalPath && !source.name)
    return html`<span class="ss-tag" data-tip=${t('没有原件，只有标题、作者等信息。')}
      >${t('只有题录')}</span
    >`;
  return html`<span class="ss-tag">${t('未解析')}</span>`;
}

/** @param {any} source */
export const sourceSub = (source) => {
  const metadata = source.metadata ?? {};
  return [
    authorText(metadata.authors),
    metadata.year,
    metadata.venue,
    source.folderPath != null ? `${source.folderPath || '.'}/` : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * @param {{sources:any[],selected:string|null,onSelect:(row:any)=>void,
 *   menu:(source:any)=>any[]}} props
 */
export function ResearchSources({ sources, selected, onSelect, menu }) {
  const actions = useActions();
  return html`<div class="ss-list" role="listbox" aria-label=${t('文献与资料')}>
    ${sources.map(
      (source) =>
        html`<${Row}
          key=${source.id}
          selected=${selected === 'source:' + source.id}
          attrs=${{ 'data-rb-source': source.id }}
          icon=${source.contentStatus === 'queued' ? 'spin' : kindIcon(source.kind === 'dataset' ? 'dataset' : 'source')}
          kind="source"
          title=${source.title}
          sub=${sourceSub(source)}
          menu=${() => menu(source)}
          onSelect=${() => onSelect(source)}
          preview=${() => actions.openPreview({ kind: 'source', id: source.id })}
        >
          ${sourceStatus(source)}${relations(source.relations)}${time(source.createdAt)}
        <//>`,
    )}
  </div>`;
}

/** @param {string} [text] */
const excerpt = (text = '') =>
  text
    .replace(/[#*_`>[\]$|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);

/**
 * @param {{items:any[],selected:string|null,onSelect:(row:any)=>void,menu:(item:any)=>any[]}} props
 */
export function ResearchItems({ items, selected, onSelect, menu }) {
  return html`<div class="ss-list" role="listbox" aria-label=${t('条目')}>
    ${items.map(
      (item) =>
        html`<${Row}
          key=${item.id}
          selected=${selected === 'item:' + item.id}
          attrs=${{ 'data-rb-item': item.id }}
          icon=${kindIcon(item.type)}
          kind=${item.type === 'code' ? 'code' : 'concept'}
          title=${item.title}
          sub=${[researchLabel(item.subtype), excerpt(item.body)].filter(Boolean).join(' · ')}
          menu=${() => menu(item)}
          onSelect=${() => onSelect(item)}
        >
          ${item.pinned && html`<span class="ss-list-row__meta" data-tip=${t('已置顶')}><${Lucide} name="pin" /></span>`}
          ${item.status !== 'active' && html`<span class="ss-tag">${researchLabel(item.status)}</span>`}
          ${relations(item.relations)}${time(item.updatedAt)}
        <//>`,
    )}
  </div>`;
}

/** 「由 方法专家 在《某对话》中添加」 @param {any} createdBy */
export const addedBy = (createdBy) =>
  t('由 {name} 在《{meeting}》中添加', {
    name: createdBy?.name ?? t('专家'),
    meeting: createdBy?.meetingTitle ?? t('已删除的对话'),
  });

/**
 * @param {{entities:any[],selected:string|null,onSelect:(row:any)=>void,menu:(entity:any)=>any[]}} props
 */
export function KnowledgeEntities({ entities, selected, onSelect, menu }) {
  return html`<div class="ss-list" role="listbox" aria-label=${t('实体')}>
    ${entities.map(
      (entity) =>
        html`<${Row}
          key=${entity.id}
          selected=${selected === 'entity:' + entity.id}
          attrs=${{ 'data-kb-entity': entity.id }}
          icon=${kindIcon(entity.kind)}
          kind=${entity.kind}
          title=${entity.nameEn ? `${entity.name}（${entity.nameEn}）` : entity.name}
          sub=${[kindLabel(entity.kind), entity.aliases?.join('、'), excerpt(entity.description)]
            .filter(Boolean)
            .join(' · ')}
          menu=${() => menu(entity)}
          onSelect=${() => onSelect(entity)}
        >
          ${entity.origin === 'ai' && html`<span class="ss-ai" data-tip=${addedBy(entity.createdBy)}>AI</span>`}
          ${relations(entity.degree)}${time(entity.updatedAt)}
        <//>`,
    )}
  </div>`;
}

/** @param {{hits:any[],query:string,mode:string,onHit:(hit:any)=>void}} props */
export function ResearchSearchResults({ hits, query, mode, onHit }) {
  return html`<div class="kb-results" data-rb-search-results>
    <p class="ss-muted" role="status">
      ${mode === 'hybrid' ? t('本次为混合检索') : t('本次为关键词检索')}
    </p>
    ${['item', 'source', 'chunk'].map((type) => {
      const selected = hits.filter((hit) => hit.type === type);
      return (
        selected.length > 0 &&
        html`<section>
          <h3 class="ss-section-title">
            ${t({ item: '条目', source: '文献与资料', chunk: '段落' }[type])}
          </h3>
          <div class="ss-list">
            ${selected.map(
              (hit) =>
                html`<button
                  type="button"
                  class="ss-list-row ss-list-row--2 kb-hit"
                  data-hit-type=${type}
                  onClick=${() => onHit(hit)}
                >
                  <span class="ss-list-row__icon"
                    ><${Lucide}
                      name=${type === 'item' ? 'book-marked' : type === 'chunk' ? 'quote' : 'file-text'}
                  /></span>
                  <span class="ss-list-row__main">
                    <span class="ss-list-row__title">${hit.title}</span>
                    <span class="ss-list-row__sub kb-hit__text"
                      ><${ResearchHighlight} text=${hit.text ?? ''} query=${query}
                    /></span>
                  </span>
                  <code class="ss-list-row__meta">${hit.citation}</code>
                </button>`,
            )}
          </div>
        </section>`
      );
    })}
  </div>`;
}
