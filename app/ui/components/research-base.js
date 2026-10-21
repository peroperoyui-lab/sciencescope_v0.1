// The knowledge base page (design system PageKnowledge, table view): header
// with the scope and the tabs, a toolbar with search, filters and sort, one
// list per tab, and the node detail panel for the selected row.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { knowledgeRoute, navigate } from '../route.js';
import { Sites } from './home.js';
import { ChoiceMenu } from './popover.js';
import { ResearchCard, ResearchHistory } from './research-card.js';
import { researchTabs, researchSubtypes, researchLabel } from './research-fields.js';
import { KnowledgeEntityForm, ResearchItemForm, ResearchSourceForm } from './research-forms.js';
import {
  KnowledgeEntities,
  ResearchFilters,
  ResearchItems,
  ResearchSearchResults,
  ResearchSources,
} from './research-list.js';
import { KnowledgePanel } from './knowledge-panel.js';
import { KnowledgeGraph } from './knowledge-graph.js';
import { MemoryViews } from './memory-views.js';
import { MemoryHistory } from './memory-history.js';
import { ResearchSourceDetail } from './research-source-detail.js';

const PAGE = 50;
const MEMORY_TABS = ['memory', 'inbox', 'brief'];
// A project has its own database, not its own knowledge base: only its
// sources and its memory views (DECISIONS 2026-10-21).
const PROJECT_TABS = ['sources', ...MEMORY_TABS];
const ITEM_TABS = ['knowledge', 'model', 'claim', 'code'];
const defaultFilters = {
  kind: '',
  contentStatus: '',
  readStatus: '',
  tag: '',
  sort: 'addedAt',
  direction: 'desc',
  subtype: '',
  status: 'active',
  pinned: '',
  entityKind: '',
  label: '',
  origin: '',
  entitySort: 'name',
};
const sourceSorts = [
  ['addedAt', '导入时间'],
  ['title', '标题'],
  ['year', '年份'],
  ['relations', '关系数'],
];
const entitySorts = [
  ['name', '名称'],
  ['updated', '最近修改'],
  ['degree', '关系数'],
];

/** @param {string} tab @param {any} filters @param {number} offset @param {string|null} projectId */
function listOptions(tab, filters, offset, projectId) {
  const pick = (keys) =>
    Object.fromEntries(keys.filter((key) => filters[key] !== '').map((key) => [key, filters[key]]));
  // Global: the knowledge base (global sources plus every project's literature).
  const scope = projectId ? { projectId, includePersonal: 0 } : { knowledge: 1 };
  if (tab === 'sources')
    return {
      ...scope,
      limit: PAGE,
      pageSize: PAGE,
      offset,
      ...pick(['kind', 'contentStatus', 'readStatus', 'tag', 'sort', 'direction']),
    };
  return { ...scope, limit: PAGE, offset, ...pick(['subtype', 'status', 'pinned']) };
}

/** @param {{view:string,projectId?:string|null}} props */
export function ResearchBase({ view, projectId = null }) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const version = useAppState((state) => state.researchVersion);
  const project = projects.find((candidate) => candidate.id === projectId);
  const targetProject = projectId ?? projects.find((candidate) => !candidate.archived)?.id;
  const inboxRequest = useAppState((state) => state.memoryInboxRequest);
  const scope = useAppState((state) => state.settings?.appearance?.knowledgeScope);
  const savedView = useAppState((state) => state.settings?.appearance?.knowledgeView);
  const [graphStatus, setGraphStatus] = useState('');
  const [chosenTab, setTab] = useState('sources');
  useEffect(() => {
    if (inboxRequest && inboxRequest.projectId === projectId) {
      setTab('inbox');
      actions.consumeMemoryInbox();
    }
  }, [inboxRequest, projectId]);
  const [filters, setFilters] = useState(defaultFilters);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState({
    rows: [],
    hits: null,
    total: 0,
    mode: 'keyword',
    remaining: 0,
  });
  const [counts, setCounts] = useState({ sources: null, entities: null, inbox: 0 });
  const [selection, setSelection] = useState(
    /** @type {{type:string,id:string,title?:string}|null} */ (null),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [imports, setImports] = useState([]);
  const fileInput = useRef(null);
  const reload = () => setRefresh((value) => value + 1);
  const scopeId = view === 'database' ? projectId : null;
  const tab = scopeId && !PROJECT_TABS.includes(chosenTab) ? 'sources' : chosenTab;
  // The graph shows the shared knowledge base only; a project database is a list.
  const graphView = !scopeId && savedView === 'graph';
  function changeView(next) {
    setQuery('');
    setDraft('');
    setOffset(0);
    actions.updateSettings({ appearance: { knowledgeView: next } }).catch(() => {});
  }

  useEffect(() => {
    if (view === 'sources') return;
    const next = view === 'database' ? 'project' : 'global';
    if (scope !== undefined && (scope ?? 'global') !== next)
      actions.updateSettings({ appearance: { knowledgeScope: next } }).catch(() => {});
  }, [view, scope]);

  useEffect(() => {
    if (view === 'sources') return undefined;
    let current = true;
    Promise.all([
      actions.researchSources({
        ...(scopeId ? { projectId: scopeId, includePersonal: 0 } : { knowledge: 1 }),
        pageSize: 1,
        offset: 0,
      }),
      scopeId ? Promise.resolve({ total: null }) : actions.knowledgeEntities({ limit: 1 }),
      scopeId ? actions.memoryInbox(scopeId) : Promise.resolve({ count: 0 }),
    ])
      .then(
        ([sources, entities, inbox]) =>
          current &&
          setCounts({ sources: sources.total, entities: entities.total, inbox: inbox.count }),
      )
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [view, scopeId, version, refresh]);

  useEffect(() => {
    if (view === 'sources' || graphView || ['inbox', 'brief'].includes(tab)) return undefined;
    let current = true;
    setLoading(true);
    setError('');
    const options = listOptions(tab, filters, offset, scopeId);
    const work =
      tab === 'entities'
        ? actions.knowledgeEntities({
            projectId: scopeId ?? undefined,
            kind: filters.entityKind || undefined,
            label: filters.label || undefined,
            origin: filters.origin || undefined,
            q: query.trim() || undefined,
            sort: filters.entitySort,
            offset,
            limit: PAGE,
          })
        : query.trim()
          ? actions.researchSearch(query, options)
          : tab === 'sources'
            ? actions.researchSources(options)
            : actions.researchItems({ ...options, type: tab });
    work
      .then((result) => {
        if (!current) return;
        const rows = Array.isArray(result)
          ? result
          : (result.sources ?? result.items ?? result.rows ?? []);
        const searched = tab !== 'entities' && query.trim();
        setPage({
          rows,
          hits: searched ? result.hits : null,
          total: result.total ?? offset + rows.length,
          mode: result.mode ?? 'keyword',
          remaining: result.remaining ?? (rows.length === PAGE ? 1 : 0),
        });
      })
      .catch((caught) => {
        if (current) setError(caught.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [view, scopeId, version, tab, filters, query, offset, refresh, graphView]);

  function changeFilter(key, value) {
    setFilters({ ...filters, [key]: value });
    setOffset(0);
  }
  function changeTab(value) {
    setTab(value);
    setQuery('');
    setDraft('');
    setOffset(0);
    setFilters(defaultFilters);
  }
  const select = (type, row) => setSelection({ type, id: row.id, title: row.title ?? row.name });

  async function itemAction(action, item) {
    await actions.attempt(async () => {
      const detail = await actions.researchItem(item.id);
      const current = detail.item;
      if (['edit', 'supersede'].includes(action))
        actions.openModal(
          action === 'edit' ? t('编辑条目') : t('取代条目'),
          html`<${ResearchItemForm}
            item=${current}
            replace=${action === 'supersede'}
            onSaved=${reload}
          />`,
        );
      else if (action === 'history')
        actions.openModal(
          t('修订历史'),
          current.type === 'memory'
            ? html`<${MemoryHistory} itemId=${item.id} />`
            : html`<${ResearchHistory} detail=${detail} />`,
        );
      else if (action === 'detail')
        actions.openModal(
          t('条目详情'),
          html`<div class="rb-dialog">
            <${ResearchCard} item=${current} onAction=${itemAction} />
          </div>`,
        );
      else {
        await (current.type === 'memory' ? actions.updateMemory : actions.updateResearchItem)(
          item.id,
          {
            expectedRevision: current.revision,
            ...(action === 'pin'
              ? { payload: { ...current.payload, pinned: !current.pinned } }
              : { status: 'archived' }),
          },
        );
        reload();
      }
    });
  }
  const itemMenu = (item) => [
    { text: t('编辑'), icon: 'pencil', run: () => itemAction('edit', item) },
    {
      text: item.pinned ? t('取消置顶') : t('置顶'),
      icon: 'pin',
      run: () => itemAction('pin', item),
    },
    ...(item.status === 'active'
      ? [
          { text: t('取代'), icon: 'git-branch', run: () => itemAction('supersede', item) },
          { text: t('归档'), icon: 'archive', run: () => itemAction('archive', item) },
        ]
      : []),
    { sep: true },
    { text: t('修订历史'), icon: 'history', run: () => itemAction('history', item) },
  ];
  function newItem() {
    const item = {
      type: tab,
      subtype: researchSubtypes[tab][0],
      title: '',
      body: '',
      payload: {},
      projectId: scopeId,
      scope: scopeId ? 'project' : 'personal',
      visibility: 'shared',
    };
    actions.openModal(t('新建条目'), html`<${ResearchItemForm} item=${item} onSaved=${reload} />`);
  }
  const editEntity = (entity) =>
    actions.openModal(
      entity ? t('编辑实体') : t('新建实体'),
      html`<${KnowledgeEntityForm}
        entity=${entity}
        projectId=${scopeId}
        onSaved=${(saved) => {
          reload();
          if (saved) setSelection({ type: 'entity', id: saved.id, title: saved.name });
        }}
      />`,
    );
  const removeEntity = (entity) =>
    actions.attempt(async () => {
      const { version: change } = await actions.knowledgeSession(scopeId, (sessionId) =>
        actions.removeKnowledgeEntity(entity.id, sessionId),
      );
      if (selection?.id === entity.id) setSelection(null);
      actions.toast(t('已删除「{name}」', { name: entity.name }), {
        label: t('撤销'),
        run: () => actions.attempt(() => actions.restoreKnowledgeVersion(change.id)),
      });
    });
  const entityMenu = (entity) => [
    { text: t('编辑'), icon: 'pencil', run: () => editEntity(entity) },
    { sep: true },
    { text: t('删除'), icon: 'trash-2', danger: true, run: () => removeEntity(entity) },
  ];
  async function sourceAction(action, source) {
    await actions.attempt(async () => {
      if (action === 'detail')
        actions.openModal(t('材料详情'), html`<${ResearchSourceDetail} sourceId=${source.id} />`);
      else if (action === 'edit-source') {
        const detail = await actions.researchSource(source.id);
        actions.openModal(
          t('编辑信息'),
          html`<${ResearchSourceForm} source=${detail.source} onSaved=${reload} />`,
        );
      } else if (action === 'open') await actions.openResearchSource(source.id);
      else {
        await actions.reparseResearchSource(source.id);
        reload();
      }
    });
  }
  const sourceMenu = (source) => [
    {
      text: t('预览'),
      icon: 'eye',
      run: () => actions.openPreview({ kind: 'source', id: source.id }),
    },
    ...(source.originalPath
      ? [{ text: t('打开原件'), icon: 'external-link', run: () => sourceAction('open', source) }]
      : []),
    { text: t('查看段落'), icon: 'file-search', run: () => sourceAction('detail', source) },
    { sep: true },
    { text: t('编辑信息'), icon: 'pencil', run: () => sourceAction('edit-source', source) },
    ...(source.originalPath
      ? [{ text: t('重新解析'), icon: 'refresh-cw', run: () => sourceAction('reparse', source) }]
      : []),
  ];
  function openHit(hit) {
    if (hit.type === 'item') {
      setSelection({ type: 'item', id: hit.id, title: hit.title });
      return;
    }
    actions.openModal(
      t('材料详情'),
      html`<${ResearchSourceDetail}
        sourceId=${hit.sourceId ?? hit.id}
        focusChunkId=${hit.type === 'chunk' ? hit.id : undefined}
        ordinal=${hit.ordinal ?? 0}
      />`,
    );
  }
  async function importFiles(event) {
    const files = Array.from(event.currentTarget.files);
    event.currentTarget.value = '';
    let progress = files.map((file) => ({ name: file.name, status: 'queued', error: '' }));
    setImports(progress);
    const update = (index, patch) => {
      progress = progress.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      );
      setImports(progress);
    };
    for (const [index, file] of files.entries()) {
      update(index, { status: 'importing' });
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let start = 0; start < bytes.length; start += 16384)
          binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
        const source = await actions.importResearchSource({
          name: file.name,
          mime: file.type,
          base64: btoa(binary),
          projectId: scopeId,
        });
        update(index, { status: source.contentStatus, error: source.parseError ?? '' });
      } catch (caught) {
        update(index, { status: 'failed', error: caught.message });
      }
    }
    reload();
  }

  if (view === 'sources')
    return html`<main class="main ss-main research-base">
      <div class="ss-header">
        <button
          type="button"
          class="ss-icon-btn kb-back"
          aria-label=${t('返回知识库')}
          data-tip=${t('返回知识库')}
          onClick=${() => navigate(knowledgeRoute(scope, targetProject))}
        >
          <${Lucide} name="arrow-left" />
        </button>
        <div class="ss-header__title"><span>${t('外部资源')}</span></div>
      </div>
      <div class="ss-content kb-content"><${Sites} /></div>
    </main>`;

  const memoryTab = MEMORY_TABS.includes(tab);
  const tabButton = (key, count) =>
    html`<button
      type="button"
      class="ss-tab"
      role="tab"
      aria-selected=${String(tab === key)}
      data-rb-tab=${key}
      onClick=${() => changeTab(key)}
    >
      ${t(researchTabs[key])}${count != null && html`<span class="ss-tab__count">${count}</span>`}
    </button>`;
  const empty = page.hits ? page.hits.length === 0 : page.rows.length === 0;
  const shown = page.hits?.length ?? page.rows.length;
  const status =
    loading || error || page.hits
      ? ''
      : tab === 'sources'
        ? t('共 {n} 份', { n: page.total })
        : tab === 'entities'
          ? t('共 {n} 个', { n: page.total })
          : '';
  const sorts = tab === 'sources' ? sourceSorts : tab === 'entities' ? entitySorts : null;
  const sortKey = tab === 'entities' ? 'entitySort' : 'sort';
  const selectedRef = selection ? `${selection.type}:${selection.id}` : null;
  let list;
  if (page.hits)
    list = html`<${ResearchSearchResults}
      hits=${page.hits}
      query=${query}
      mode=${page.mode}
      onHit=${openHit}
    />`;
  else if (tab === 'sources')
    list = html`<${ResearchSources}
      sources=${page.rows}
      selected=${selectedRef}
      onSelect=${(row) => select('source', row)}
      menu=${sourceMenu}
    />`;
  else if (tab === 'entities')
    list = html`<${KnowledgeEntities}
      entities=${page.rows}
      selected=${selectedRef}
      onSelect=${(row) => select('entity', row)}
      menu=${entityMenu}
    />`;
  else if (tab === 'memory')
    list = html`${researchSubtypes.memory.map((subtype) => {
      const rows = page.rows.filter((item) => item.subtype === subtype);
      return (
        rows.length > 0 &&
        html`<section>
          <h3 class="ss-section-title">${researchLabel(subtype)}</h3>
          <div class="rb-cards">
            ${rows.map((item) => html`<${ResearchCard} key=${item.id} item=${item} onAction=${itemAction} />`)}
          </div>
        </section>`
      );
    })}`;
  else
    list = html`<${ResearchItems}
      items=${page.rows}
      selected=${selectedRef}
      onSelect=${(row) => select('item', row)}
      menu=${itemMenu}
    />`;

  return html`<main class="main ss-main research-base">
      <div class="ss-header">
        <div class="ss-header__title"><span>${scopeId ? t('数据库') : t('知识库')}</span></div>
        <${ChoiceMenu}
          label=${t('范围')}
          triggerClass="ss-select ss-select--ghost"
          placement="bottom-start"
          attrs=${{ 'data-kb-scope': scopeId ? 'project' : 'global' }}
          items=${[
            { group: t('范围') },
            {
              text: t('知识库（所有项目共用）'),
              icon: 'book-open',
              selected: !scopeId,
              run: () => navigate({ view: 'library' }),
            },
            ...(targetProject
              ? [
                  {
                    text: t('项目数据库：{name}', {
                      name:
                        (project ?? projects.find((row) => row.id === targetProject))?.name ?? '',
                    }),
                    icon: 'folder-open',
                    selected: Boolean(scopeId),
                    run: () => navigate({ view: 'database', id: targetProject }),
                  },
                ]
              : []),
            { group: t('网上') },
            { text: t('外部资源'), icon: 'globe', run: () => navigate({ view: 'sources' }) },
          ]}
        >
          <${Lucide} name=${scopeId ? 'folder-open' : 'book-open'} /><span class="ss-select__value"
            >${scopeId ? (project?.name ?? '') : t('所有项目')}</span
          >
        <//>
        ${!graphView && html`<span class="ss-header__sep"></span>`}
        <nav class="ss-tabs" role="tablist" aria-label=${t('知识库内容')} hidden=${graphView}>
          ${tabButton('sources', counts.sources)}${!scopeId && tabButton('entities', counts.entities)}
          ${!scopeId && ITEM_TABS.map((key) => tabButton(key))}
          <button
            type="button"
            class="ss-tab"
            role="tab"
            aria-selected=${String(memoryTab)}
            aria-haspopup="menu"
            data-rb-tab="memory"
            onClick=${(event) =>
              actions.openMenu(
                event,
                [
                  { text: t('记忆'), icon: 'brain', run: () => changeTab('memory') },
                  {
                    text: t('记忆收件箱'),
                    icon: 'inbox',
                    key: counts.inbox > 0 ? String(counts.inbox) : undefined,
                    disabled: !scopeId,
                    run: () => changeTab('inbox'),
                  },
                  {
                    text: t('项目简报'),
                    icon: 'newspaper',
                    disabled: !scopeId,
                    run: () => changeTab('brief'),
                  },
                ],
                t('记忆'),
              )}
          >
            ${memoryTab ? t(researchTabs[tab]) : t('记忆')}${counts.inbox > 0 && html`<span class="ss-tab__count">${counts.inbox}</span>`}<${Lucide}
              name="chevron-down"
              class="ss-i--sm"
            />
          </button>
        </nav>
        <div class="ss-header__actions">
          ${
            !graphView &&
            (tab === 'entities' || (researchSubtypes[tab] && tab !== 'memory')) &&
            html`<button
              type="button"
              class="ss-icon-btn"
              aria-label=${tab === 'entities' ? t('新建实体') : t('新建条目')}
              data-tip=${tab === 'entities' ? t('新建实体') : t('新建条目')}
              onClick=${() => (tab === 'entities' ? editEntity(null) : newItem())}
            >
              <${Lucide} name="plus" />
            </button>`
          }
          <button type="button" class="ss-btn" onClick=${() => fileInput.current.click()}>
            <${Lucide} name="import" />${t('导入')}
          </button>
          <input ref=${fileInput} type="file" multiple hidden onChange=${importFiles} />
        </div>
      </div>
      ${
        ['inbox', 'brief'].includes(tab) && !graphView
          ? html`<div class="ss-content kb-content">
              <${MemoryViews}
                key=${tab}
                projectId=${scopeId}
                tab=${tab}
                onEdit=${(item) => itemAction('edit', item)}
              />
            </div>`
          : html`<form
                class="ss-toolbar kb-toolbar"
                onSubmit=${(event) => {
                  event.preventDefault();
                  setQuery(draft);
                  setOffset(0);
                  reload();
                }}
              >
                <span class="ss-input"
                  ><${Lucide} name="search" /><input
                    value=${draft}
                    aria-label=${graphView ? t('找一个节点设为中心') : tab === 'entities' ? t('按名称或别名查找实体') : t('统一检索资料与条目')}
                    placeholder=${graphView ? t('找一个节点设为中心') : tab === 'entities' ? t('按名称或别名查找') : scopeId ? t('搜索标题或正文') : t('搜索标题、实体或正文')}
                    onInput=${(event) => setDraft(event.currentTarget.value)}
                  />${
                    query &&
                    html`<button
                      type="button"
                      class="ss-icon-btn ss-icon-btn--sm"
                      aria-label=${t('清除搜索')}
                      data-tip=${t('清除搜索')}
                      onClick=${() => {
                        setQuery('');
                        setDraft('');
                        setOffset(0);
                      }}
                    >
                      <${Lucide} name="x" />
                    </button>`
                  }</span
                >
                ${
                  !query &&
                  !graphView &&
                  html`<${ResearchFilters}
                    tab=${tab}
                    filters=${filters}
                    onFilter=${changeFilter}
                    onClear=${() => {
                      setFilters({
                        ...defaultFilters,
                        sort: filters.sort,
                        direction: filters.direction,
                        entitySort: filters.entitySort,
                      });
                      setOffset(0);
                    }}
                  />`
                }
                ${
                  sorts &&
                  !query &&
                  !graphView &&
                  html`<${ChoiceMenu}
                    label=${t('排序')}
                    triggerClass="ss-select ss-select--ghost"
                    placement="bottom-start"
                    items=${[
                      { group: t('排序依据') },
                      ...sorts.map(([value, text]) => ({
                        text: t(text),
                        selected: filters[sortKey] === value,
                        run: () => changeFilter(sortKey, value),
                      })),
                      ...(tab === 'sources'
                        ? [
                            { group: t('顺序') },
                            ...[
                              ['desc', t('降序')],
                              ['asc', t('升序')],
                            ].map(([value, text]) => ({
                              text,
                              selected: filters.direction === value,
                              run: () => changeFilter('direction', value),
                            })),
                          ]
                        : []),
                    ]}
                  >
                    <${Lucide} name="arrow-down-up" /><span class="ss-select__value"
                      >${t(sorts.find(([value]) => value === filters[sortKey])?.[1] ?? sorts[0][1])}</span
                    >
                  <//>`
                }
                <span class="ss-toolbar__spacer"></span>
                ${
                  graphView
                    ? graphStatus && html`<span class="ss-muted kb-status">${graphStatus}</span>`
                    : status && html`<span class="ss-muted kb-status">${status}</span>`
                }
                ${
                  !scopeId &&
                  html`<div class="ss-seg ss-seg--sm" role="group" aria-label=${t('看法')}>
                    <button
                      type="button"
                      aria-pressed=${String(!graphView)}
                      data-kb-view="table"
                      onClick=${() => graphView && changeView('table')}
                    >
                      <${Lucide} name="table-2" />${t('表格')}
                    </button>
                    <button
                      type="button"
                      aria-pressed=${String(graphView)}
                      data-kb-view="graph"
                      onClick=${() => !graphView && changeView('graph')}
                    >
                      <${Lucide} name="waypoints" />${t('图')}
                    </button>
                  </div>`
                }
              </form>
              ${
                graphView
                  ? html`<${KnowledgeGraph}
                      selection=${selection}
                      onSelect=${setSelection}
                      onStatus=${setGraphStatus}
                      query=${query}
                      searchNonce=${refresh}
                    />`
                  : html`<div class="ss-content kb-content">
                      ${imports.length > 0 && html`<div class="kb-imports" data-rb-import-progress role="status">${imports.map((entry) => html`<p>${entry.name} · ${entry.status === 'importing' ? t('正在导入…') : entry.status === 'queued' ? t('等待导入') : entry.status === 'parsed' ? t('已解析') : entry.status === 'partial' ? t('部分解析') : t('解析失败')}${entry.error && html`<span role="alert"> · ${entry.error}</span>`}</p>`)}</div>`}
                      ${error && html`<p role="alert">${error}</p>`}${loading && empty && html`<p class="ss-muted" role="status">${t('正在读取…')}</p>`}
                      ${list}
                      ${
                        (page.remaining > 0 || offset > 0) &&
                        html`<div class="kb-pagination">
                          <button
                            type="button"
                            class="ss-btn ss-btn--ghost ss-btn--sm"
                            disabled=${offset === 0}
                            onClick=${() => setOffset(Math.max(0, offset - PAGE))}
                          >
                            ${t('上一页')}
                          </button>
                          <span class="ss-muted"
                            >${offset + 1}–${offset + shown}${tab === 'sources' || tab === 'entities' || page.hits ? ` / ${page.total}` : ''}</span
                          >
                          <button
                            type="button"
                            class="ss-btn ss-btn--ghost ss-btn--sm"
                            disabled=${!page.remaining}
                            onClick=${() => setOffset(offset + PAGE)}
                          >
                            ${t('下一页')}
                          </button>
                        </div>`
                      }
                      ${
                        empty &&
                        !loading &&
                        html`<div class="ss-empty kb-empty">
                          <p>
                            ${
                              query || filters !== defaultFilters
                                ? t('暂无记录')
                                : tab === 'sources'
                                  ? t('还没有资料。导入文献、数据或笔记后会出现在这里。')
                                  : tab === 'entities'
                                    ? t(
                                        '还没有实体。整理论文或专家按原文写入后会出现在这里，也可以手动新建。',
                                      )
                                    : t('暂无记录')
                            }
                          </p>
                          ${
                            !query &&
                            filters === defaultFilters &&
                            tab === 'sources' &&
                            html`<button
                              type="button"
                              class="ss-btn"
                              onClick=${() => fileInput.current.click()}
                            >
                              <${Lucide} name="import" />${t('导入')}
                            </button>`
                          }
                        </div>`
                      }
                    </div>`
              }`
      }
    </main>
    ${
      selection &&
      (!memoryTab || graphView) &&
      html`<${KnowledgePanel}
        selection=${selection}
        projectId=${scopeId}
        onSelect=${setSelection}
        onClose=${() => setSelection(null)}
        sourceMenu=${sourceMenu}
        itemMenu=${itemMenu}
        entityMenu=${entityMenu}
        onEditEntity=${editEntity}
        onEditItem=${(item) => itemAction('edit', item)}
      />`
    }`;
}
