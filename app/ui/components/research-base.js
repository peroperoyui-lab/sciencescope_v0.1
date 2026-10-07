import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { navigate } from '../route.js';
import { Sites } from './home.js';
import { InfoTip } from './info-tip.js';
import { MainHead } from './mainhead.js';
import { ResearchCard, ResearchHistory } from './research-card.js';
import { researchTabs, researchSubtypes } from './research-fields.js';
import { ResearchItemForm, ResearchSourceForm } from './research-forms.js';
import { ResearchFilters, ResearchSources, ResearchSearchResults } from './research-list.js';
import { MemoryViews } from './memory-views.js';
import { MemoryHistory } from './memory-history.js';
import { researchLabel } from './research-fields.js';
import { ResearchSourceDetail } from './research-source-detail.js';

const defaultFilters = {
  kind: '',
  readStatus: '',
  tag: '',
  sort: 'addedAt',
  direction: 'desc',
  subtype: '',
  status: 'active',
  pinned: '',
};
/** @param {{view:string,projectId?:string|null}} props */
export function ResearchBase({ view, projectId = null }) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const version = useAppState((state) => state.researchVersion);
  const project = projects.find((candidate) => candidate.id === projectId);
  const targetProject = projectId ?? projects.find((candidate) => !candidate.archived)?.id;
  const inboxRequest = useAppState((state) => state.memoryInboxRequest);
  const [tab, setTab] = useState('sources');
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [imports, setImports] = useState([]);
  const fileInput = useRef(null);
  const reload = () => setRefresh((value) => value + 1);
  useEffect(() => {
    if (view === 'sources' || ['inbox', 'brief'].includes(tab)) return;
    let current = true;
    setLoading(true);
    setError('');
    const options = {
      projectId: projectId ?? '',
      includePersonal: 0,
      limit: 50,
      pageSize: 50,
      offset,
      ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '')),
    };
    const work = query.trim()
      ? actions.researchSearch(query, options)
      : tab === 'sources'
        ? actions.researchSources(options)
        : actions.researchItems({ ...options, type: tab });
    work
      .then((result) => {
        if (!current) return;
        const rows = Array.isArray(result) ? result : (result.sources ?? result.items ?? []);
        setPage({
          rows,
          hits: query.trim() ? result.hits : null,
          total: result.total ?? offset + rows.length,
          mode: result.mode ?? 'keyword',
          remaining: result.remaining ?? (rows.length === 50 ? 1 : 0),
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
  }, [view, projectId, version, tab, filters, query, offset, refresh]);
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
  function newItem() {
    const item = {
      type: tab,
      subtype: researchSubtypes[tab][0],
      title: '',
      body: '',
      payload: {},
      projectId,
      scope: projectId ? 'project' : 'personal',
      visibility: 'shared',
    };
    actions.openModal(t('新建条目'), html`<${ResearchItemForm} item=${item} onSaved=${reload} />`);
  }
  async function sourceAction(action, source) {
    await actions.attempt(async () => {
      if (action === 'detail')
        actions.openModal(t('材料详情'), html`<${ResearchSourceDetail} sourceId=${source.id} />`);
      else if (action === 'edit-source') {
        const detail = await actions.researchSource(source.id);
        actions.openModal(
          t('编辑元数据'),
          html`<${ResearchSourceForm} source=${detail.source} onSaved=${reload} />`,
        );
      } else if (action === 'open') await actions.openResearchSource(source.id);
      else {
        await actions.reparseResearchSource(source.id);
        reload();
      }
    });
  }
  function openHit(hit) {
    if (hit.type === 'item') {
      itemAction('detail', { id: hit.id });
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
          projectId,
        });
        update(index, { status: source.contentStatus, error: source.parseError ?? '' });
      } catch (caught) {
        update(index, { status: 'failed', error: caught.message });
      }
    }
    reload();
  }
  const empty = page.hits ? page.hits.length === 0 : page.rows.length === 0;
  const cards =
    tab === 'memory'
      ? html`${researchSubtypes.memory.map((subtype) => {
          const rows = page.rows.filter((item) => item.subtype === subtype);
          return (
            rows.length &&
            html`<section>
              <h3>${researchLabel(subtype)}</h3>
              <div class="rb-cards">
                ${rows.map((item) => html`<${ResearchCard} key=${item.id} item=${item} onAction=${itemAction} />`)}
              </div>
            </section>`
          );
        })}`
      : html`<div class="rb-cards">
          ${page.rows.map((item) => html`<${ResearchCard} key=${item.id} item=${item} onAction=${itemAction} />`)}
        </div>`;
  return html`<main class="main">
    <${MainHead}
      crumb=${project?.name ?? t('我的资料')}
      section=${t('数据库')}
      title=${view === 'sources' ? t('外部资源') : t('研究资料库')}
    />
    <div class="mainbody">
      <div class="content research-base">
        <div class="between">
          <h1>
            ${view === 'sources' ? t('外部资源') : t('研究资料库')}
            <${InfoTip}
              text=${t('原件、知识、模型与主张保存在资料库中；解析段落与检索索引可以重建。')}
            />
          </h1>
          ${view !== 'sources' && html`<div class="row"><button class="btn tiny" onClick=${() => fileInput.current.click()}>${t('导入材料')}</button>${researchSubtypes[tab] && html`<button class="btn tiny" onClick=${newItem}>${t('新建条目')}</button>`}<input ref=${fileInput} type="file" multiple hidden onChange=${importFiles} /></div>`}
        </div>
        <div class="tabs">
          ${[
            ['database', '当前项目材料'],
            ['library', '我的资料'],
            ['sources', '外部资源'],
          ].map(
            ([route, title]) =>
              html`<button
                class=${`tab ${view === route ? 'active' : ''}`}
                disabled=${route === 'database' && !targetProject}
                onClick=${() => navigate(route === 'database' ? { view: 'database', id: targetProject } : { view: /** @type {'library' | 'sources'} */ (route) })}
              >
                ${t(title)}
              </button>`,
          )}
        </div>
        ${
          view === 'sources'
            ? html`<${Sites} />`
            : html`
                <div class="tabs rb-tabs">
                  ${Object.entries(researchTabs).map(([key, title]) => html`<button class=${`tab ${tab === key ? 'active' : ''}`} data-rb-tab=${key} onClick=${() => changeTab(key)}>${t(title)}</button>`)}
                </div>
                ${
                  ['inbox', 'brief'].includes(tab)
                    ? html`<${MemoryViews}
                        key=${tab}
                        projectId=${projectId}
                        tab=${tab}
                        onEdit=${(item) => itemAction('edit', item)}
                      />`
                    : html`
                        <form
                          class="rb-search"
                          onSubmit=${(event) => {
                            event.preventDefault();
                            setQuery(draft);
                            setOffset(0);
                            reload();
                          }}
                        >
                          <input
                            value=${draft}
                            aria-label=${t('统一检索资料与条目')}
                            placeholder=${t('统一检索资料与条目')}
                            onInput=${(event) => setDraft(event.currentTarget.value)}
                          /><button class="btn tiny" type="submit">${t('搜索')}</button>${
                            query &&
                            html`<button
                              type="button"
                              class="btn tiny"
                              onClick=${() => {
                                setQuery('');
                                setDraft('');
                                setOffset(0);
                              }}
                            >
                              ${t('清除搜索')}
                            </button>`
                          }<button type="button" class="btn tiny" onClick=${reload}>
                            ${t('刷新')}
                          </button>
                        </form>
                        ${!query && html`<${ResearchFilters} tab=${tab} filters=${filters} onFilter=${changeFilter} />`}
                        ${imports.length > 0 && html`<div data-rb-import-progress role="status">${imports.map((entry) => html`<p>${entry.name} · ${entry.status === 'importing' ? t('正在导入…') : entry.status === 'queued' ? t('等待导入') : entry.status === 'parsed' ? t('已解析') : entry.status === 'partial' ? t('部分解析') : t('解析失败')}${entry.error && html`<span role="alert"> · ${entry.error}</span>`}</p>`)}</div>`}
                        ${error && html`<p role="alert">${error}</p>`}${loading && html`<p role="status">${t('正在读取…')}</p>`}
                        ${
                          page.hits
                            ? html`<${ResearchSearchResults}
                                hits=${page.hits}
                                query=${query}
                                mode=${page.mode}
                                onHit=${openHit}
                              />`
                            : tab === 'sources'
                              ? html`<${ResearchSources}
                                  sources=${page.rows}
                                  onAction=${sourceAction}
                                />`
                              : filters.status === 'superseded'
                                ? html`<details>
                                    <summary>${t('已取代的记录')}</summary>
                                    ${cards}
                                  </details>`
                                : cards
                        }
                        ${(!empty || offset > 0) && html`<div class="rb-pagination"><button class="btn tiny" disabled=${offset === 0} onClick=${() => setOffset(Math.max(0, offset - 50))}>${t('上一页')}</button><span>${offset + 1}–${offset + (page.hits?.length ?? page.rows.length)}${tab === 'sources' || page.hits ? ` / ${page.total}` : ''}</span><button class="btn tiny" disabled=${!page.remaining} onClick=${() => setOffset(offset + 50)}>${t('下一页')}</button></div>`}
                        ${empty && !loading && html`<div class="empty">${t('暂无记录')}</div>`}
                      `
                }
              `
        }
      </div>
    </div>
  </main>`;
}
