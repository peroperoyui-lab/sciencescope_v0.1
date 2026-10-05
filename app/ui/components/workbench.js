// A project's workbench in the old interface's markup: plan cards across all
// projects, this project's log, and the bottom row with the change history,
// the research map and the project folder. Every edit is a workspace edit,
// recorded as a revision that anyone (people or AIs) can undo.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { fitView, layoutMap, mapConnections } from '../map-layout.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import {
  appendPlan,
  logEntryText,
  parseLog,
  parsePlans,
  removeLogEntry,
  replacePlan,
} from '../workbench-text.js';
import { MainHead } from './mainhead.js';
import { OP_LABELS, RESOURCE_LABELS, useProjectRevisions } from '../project-changes.js';
import { FieldForm } from './overlays.js';

/**
 * Read resources and re-read them whenever the workspace changes.
 * @param {Array<[string, string]>} targets [resource, key] pairs
 */
function useResources(targets) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [results, setResults] = useState(/** @type {any[]} */ ([]));
  const signature = JSON.stringify(targets);
  useEffect(() => {
    let current = true;
    Promise.all(
      targets.map(([resource, key]) => actions.readResource(resource, key).catch(() => null)),
    ).then((values) => current && setResults(values));
    return () => {
      current = false;
    };
  }, [signature, version]);
  return results;
}

/** @param {{ projectId: string, projects: any[] }} props */
function PlanForm({ projectId, projects }) {
  const actions = useActions();
  const [text, setText] = useState('');
  const [key, setKey] = useState(projectId);
  async function submit(event) {
    event.preventDefault();
    actions.closeModal();
    await actions.attempt(async () => {
      const current = (await actions.readResource('plans', key)).text ?? '';
      await actions.editResource('plans', key, 'write', { text: appendPlan(current, text.trim()) });
    });
  }
  return html`<form onSubmit=${submit}>
    <div class="field">
      <label class="label">${t('计划内容')}</label>
      <input autofocus value=${text} onInput=${(event) => setText(event.currentTarget.value)} />
    </div>
    <div class="field">
      <label class="label">${t('归属')}</label>
      <select value=${key} onChange=${(event) => setKey(event.currentTarget.value)}>
        ${projects.map((p) => html`<option key=${p.id} value=${p.id}>${p.name}</option>`)}
        <option value="global">${t('全局计划')}</option>
      </select>
    </div>
    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn" onClick=${actions.closeModal}>${t('取消')}</button>
      <button type="submit" class="btn primary" disabled=${!text.trim()}>${t('添加')}</button>
    </div>
  </form>`;
}

/** Plans of every project plus the global plans. @param {{ project: any, projects: any[] }} props */
function PlanStrip({ project, projects }) {
  const actions = useActions();
  const keys = ['global', ...projects.map((p) => p.id)];
  const files = useResources(keys.map((key) => ['plans', key]));
  const scopeName = (key) =>
    key === 'global' ? t('全局计划') : (projects.find((p) => p.id === key)?.name ?? key);

  const cards = keys.flatMap((key, index) =>
    parsePlans(files[index]?.text ?? '').map((item) => ({ ...item, key, file: files[index] })),
  );
  // This project's plans first, then the rest.
  cards.sort((a, b) => Number(b.key === project.id) - Number(a.key === project.id));

  const save = (card, item) =>
    actions.attempt(() =>
      actions.editResource('plans', card.key, 'write', {
        text: replacePlan(card.file.text, card.line, item),
      }),
    );
  const edit = (card) =>
    actions.openModal(
      t('编辑计划'),
      html`<${FieldForm}
        label=${t('计划内容')}
        value=${card.text}
        submitText=${t('保存')}
        onSubmit=${(text) => save(card, { done: card.done, text })}
      />`,
    );
  const menu = (event, card) =>
    actions.openMenu(
      event,
      [
        { text: t('编辑'), icon: 'edit', run: () => edit(card) },
        {
          text: t('切换完成状态'),
          icon: 'check',
          run: () => save(card, { done: !card.done, text: card.text }),
        },
        { sep: true },
        { text: t('删除'), icon: 'trash', danger: true, run: () => save(card, null) },
      ],
      card.text,
    );

  return html`<section class="wb-top">
    <div class="sectionline">
      ${t('全局计划')} <span class="spacer"></span>
      <button
        class="btn tiny"
        onClick=${() =>
          actions.openModal(
            t('添加计划'),
            html`<${PlanForm} projectId=${project.id} projects=${projects} />`,
          )}
      >
        + ${t('添加计划')}
      </button>
    </div>
    <div class="planstrip">
      ${cards.map(
        (card) =>
          html`<article
            key=${`${card.key}:${card.line}`}
            tabindex="0"
            role="button"
            class=${`plancard ${card.done ? 'done' : ''}`}
            onClick=${() => edit(card)}
            onContextMenu=${(event) => menu(event, card)}
          >
            <button
              class="iconbtn"
              title=${t('计划菜单')}
              aria-label=${t('计划菜单')}
              onClick=${(event) => menu(event, card)}
            >
              <${Icon} name="more" />
            </button>
            <div class="row">
              <${Icon} name=${card.done ? 'check' : 'clock'} /><strong>${card.text}</strong>
            </div>
            <small>${scopeName(card.key)}</small>
          </article>`,
      )}
      ${!cards.length && html`<div class="inline-empty">${t('暂无计划')}</div>`}
    </div>
  </section>`;
}

function LogForm({ projectId }) {
  const actions = useActions();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  async function submit(event) {
    event.preventDefault();
    actions.closeModal();
    const date = new Date().toISOString().slice(0, 10);
    await actions.attempt(() =>
      actions.editResource('log', projectId, 'append', {
        text: logEntryText(title.trim(), body.trim(), date),
      }),
    );
  }
  return html`<form onSubmit=${submit}>
    <div class="field">
      <label class="label">${t('标题')}</label>
      <input autofocus value=${title} onInput=${(event) => setTitle(event.currentTarget.value)} />
    </div>
    <div class="field">
      <label class="label">${t('日志详情')}</label>
      <textarea value=${body} onInput=${(event) => setBody(event.currentTarget.value)}></textarea>
    </div>
    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn" onClick=${actions.closeModal}>${t('取消')}</button>
      <button type="submit" class="btn primary" disabled=${!title.trim()}>${t('添加')}</button>
    </div>
  </form>`;
}

/** @param {{ project: any }} props */
function JournalStrip({ project }) {
  const actions = useActions();
  const [file] = useResources([['log', project.id]]);
  const entries = parseLog(file?.text ?? '');
  const details = (entry) =>
    actions.openModal(
      entry.title,
      html`<div>
        <small>${entry.date}</small>
        <div
          class="rendered-markdown"
          dangerouslySetInnerHTML=${{ __html: renderMarkdown(entry.body || t('没有详细内容。')) }}
        ></div>
      </div>`,
    );
  const menu = (event, entry) =>
    actions.openMenu(
      event,
      [
        { text: t('查看详情'), icon: 'file', run: () => details(entry) },
        { sep: true },
        {
          text: t('删除'),
          icon: 'trash',
          danger: true,
          run: () =>
            actions.attempt(() =>
              actions.editResource('log', project.id, 'write', {
                text: removeLogEntry(file.text, entry),
              }),
            ),
        },
      ],
      entry.title,
    );

  return html`<section class="wb-top">
    <div class="sectionline">
      ${t('本项目日志')} <small>${project.name}</small>
      <span class="spacer"></span>
      <button
        class="btn tiny"
        onClick=${() =>
          actions.openModal(t('添加日志'), html`<${LogForm} projectId=${project.id} />`)}
      >
        + ${t('添加日志')}
      </button>
    </div>
    <div class="journalstrip">
      ${entries.map(
        (entry) =>
          html`<article
            key=${entry.start}
            class="journalcard"
            onContextMenu=${(event) => menu(event, entry)}
          >
            <h3>${entry.title}</h3>
            <button onClick=${() => details(entry)}>${t('日志详情')} ›</button>
            <span class="stamp">${entry.date}</span>
          </article>`,
      )}
      ${!entries.length && html`<div class="inline-empty">${t('暂无项目日志')}</div>`}
    </div>
  </section>`;
}

/** Recent changes to this project's workbench, each undoable. @param {{ project: any }} props */
function Changes({ project }) {
  const actions = useActions();
  const participants = useAppState((state) => state.participants);
  const revisions = useProjectRevisions(project.id, 30);
  const author = (revision) =>
    revision.op === 'external'
      ? t('文件')
      : (participants.find((p) => p.id === revision.actorId)?.name ?? revision.actorId ?? '');

  return html`<div class="wb-left">
    <div class="wb-title"><span class="grow">${t('更改记录')}</span></div>
    <div class="versionlist">
      ${revisions.map(
        (revision) =>
          html`<div class="listrow" key=${revision.id}>
            <span class="grow">
              <strong>${author(revision)}</strong>
              ${' '}${t(RESOURCE_LABELS[revision.resource] ?? revision.resource)}${
                revision.key === 'global' ? `（${t('全局')}）` : ''
              }
              · ${OP_LABELS[revision.op] ? t(OP_LABELS[revision.op]) : revision.op}
              <small style="display:block">${formatTime(revision.createdAt)}</small>
            </span>
            ${
              revision.undoneBy
                ? html`<small>${t('已撤销')}</small>`
                : html`<button
                    class="btn tiny"
                    onClick=${() => actions.attempt(() => actions.undo(revision.id))}
                  >
                    ${t('撤销')}
                  </button>`
            }
          </div>`,
      )}
      ${!revisions.length && html`<div class="inline-empty">${t('还没有更改。')}</div>`}
    </div>
  </div>`;
}

/** @param {{ project: any }} props */
function ResearchMap({ project }) {
  const actions = useActions();
  const [file] = useResources([['map', project.id]]);
  const [collapsed, setCollapsed] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const [view, setView] = useState({ x: 18, y: 18, scale: 1 });
  const viewport = useRef(null);
  const drag = useRef(null);
  const fitted = useRef(false);
  const nodes = file?.value?.nodes ?? [];
  const positions = layoutMap(nodes, collapsed);
  const edit = (op, args) =>
    actions.attempt(() => actions.editResource('map', project.id, op, args));

  useLayoutEffect(() => {
    if (fitted.current || !file || !viewport.current) return;
    fitted.current = true;
    const { clientWidth, clientHeight } = viewport.current;
    setView(fitView(positions, clientWidth, clientHeight));
  }, [file]);

  const fit = () => {
    const { clientWidth, clientHeight } = viewport.current;
    setView(fitView(positions, clientWidth, clientHeight));
  };
  const zoom = (factor) =>
    setView({ ...view, scale: Math.min(2, Math.max(0.2, view.scale * factor)) });

  const nodeForm = (title, value, save) =>
    actions.openModal(
      title,
      html`<${FieldForm}
        label=${t('节点内容')}
        value=${value}
        submitText=${t('保存')}
        onSubmit=${save}
      />`,
    );
  const addChild = (parent) =>
    nodeForm(t('添加节点'), '', (text) => edit('addNode', { node: { parent, text } }));
  const nodeMenu = (event, node) =>
    actions.openMenu(
      event,
      [
        { text: t('添加子节点'), icon: 'plus', run: () => addChild(node.id) },
        {
          text: t('编辑'),
          icon: 'edit',
          run: () =>
            nodeForm(t('编辑节点'), node.text, (text) =>
              edit('updateNode', { id: node.id, changes: { text } }),
            ),
        },
        { sep: true },
        {
          text: t('删除节点'),
          icon: 'trash',
          danger: true,
          run: () => edit('removeNode', { id: node.id }),
        },
      ],
      node.text,
    );

  return html`<div class="wb-map">
    <div class="wb-title">
      <span class="grow">${t('研究框架与进展')}</span>
      <button
        class="iconbtn"
        title=${t('添加节点')}
        aria-label=${t('添加节点')}
        onClick=${() => addChild(null)}
      >
        <${Icon} name="plus" />
      </button>
    </div>
    <div
      class="mapviewport"
      data-edit="false"
      ref=${viewport}
      onPointerDown=${(event) => {
        if (event.target.closest('.mapnode')) return;
        drag.current = { x: event.clientX - view.x, y: event.clientY - view.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove=${(event) => {
        if (!drag.current) return;
        setView({ ...view, x: event.clientX - drag.current.x, y: event.clientY - drag.current.y });
      }}
      onPointerUp=${() => {
        drag.current = null;
      }}
    >
      <span class="readbadge">${t('缩放 / 拖动 / 右键编辑')}</span>
      <div
        class="mapscene"
        style=${{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        <svg class="connections">
          <g fill="none" stroke="#9bac8f" stroke-width="1.5">
            ${mapConnections(positions).map((d, index) => html`<path key=${index} d=${d} />`)}
          </g>
        </svg>
        ${positions.map((p) => {
          const hasChildren = nodes.some((node) => node.parent === p.node.id);
          const open = hasChildren && !collapsed[p.node.id];
          return html`<div
            key=${p.node.id}
            class=${`mapnode ${p.root ? 'root' : 'secondary'} ${selected === p.node.id ? 'selected' : ''}`}
            style=${{ left: `${p.x}px`, top: `${p.y}px`, width: `${p.w}px`, minHeight: `${p.h}px` }}
            tabindex="0"
            onClick=${() => setSelected(p.node.id)}
            onDblClick=${() =>
              nodeForm(t('编辑节点'), p.node.text, (text) =>
                edit('updateNode', { id: p.node.id, changes: { text } }),
              )}
            onContextMenu=${(event) => nodeMenu(event, p.node)}
          >
            <div
              class="nodetext"
              dangerouslySetInnerHTML=${{ __html: renderMarkdown(p.node.text) }}
            ></div>
            <button
              class="nodeplus"
              aria-label=${open ? t('收起分支') : hasChildren ? t('展开分支') : t('新增分支')}
              onClick=${(event) => {
                event.stopPropagation();
                if (hasChildren) setCollapsed({ ...collapsed, [p.node.id]: open });
                else addChild(p.node.id);
              }}
            >
              ${open ? '−' : '+'}
            </button>
          </div>`;
        })}
      </div>
      ${
        !nodes.length &&
        html`<div
          class="inline-empty"
          style="position:absolute;inset:auto 0 45% 0;text-align:center"
        >
          <button class="btn tiny" onClick=${() => addChild(null)}>+ ${t('添加第一个节点')}</button>
        </div>`
      }
    </div>
    <div class="mapfoot">
      <button class="iconbtn" title=${t('适应画布')} aria-label=${t('适应画布')} onClick=${fit}>
        <${Icon} name="search" />
      </button>
      <span class="spacer"></span>
      <button aria-label=${t('缩小')} onClick=${() => zoom(1 / 1.15)}>−</button>
      <span>${Math.round(view.scale * 100)}%</span>
      <button aria-label=${t('放大')} onClick=${() => zoom(1.15)}>+</button>
      <button onClick=${fit}>${t('适应')}</button>
    </div>
  </div>`;
}

/** @param {{ projectId: string, path: string, depth: number }} props */
function FolderEntries({ projectId, path, depth }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [listing, setListing] = useState(/** @type {any} */ (null));
  const [open, setOpen] = useState(/** @type {Record<string, boolean>} */ ({}));
  useEffect(() => {
    actions
      .projectFiles(projectId, path)
      .then(setListing)
      .catch((error) => actions.toast(error.message));
  }, [projectId, path, version]);
  if (!listing) return null;
  return html`${listing.entries.map(
    (entry) =>
      html`<button
          key=${entry.path}
          class="wb-file-row"
          style=${{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick=${() => entry.kind === 'folder' && setOpen({ ...open, [entry.path]: !open[entry.path] })}
        >
          ${
            entry.kind === 'folder'
              ? html`<${Icon} name="folder" />`
              : html`<span class="wb-file-icon">${entry.name.split('.').pop().slice(0, 4)}</span>`
          }
          <span>${entry.name}</span>
        </button>
        ${
          open[entry.path] &&
          html`<${FolderEntries} projectId=${projectId} path=${entry.path} depth=${depth + 1} />`
        }`,
  )}`;
}

/** @param {{ project: any }} props */
function ProjectFolder({ project }) {
  const actions = useActions();
  const [root, setRoot] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    actions
      .projectFiles(project.id)
      .then((listing) => setRoot(listing.root))
      .catch(() => {});
  }, [project.id]);
  return html`<div class="wb-right">
    <div class="wb-title">
      <span class="grow">${t('项目文件夹')}</span>
      <button
        class="iconbtn"
        title=${t('刷新')}
        aria-label=${t('刷新')}
        onClick=${() => setRefresh(refresh + 1)}
      >
        <${Icon} name="refresh" />
      </button>
    </div>
    <div class="filetree">
      <div class="wb-path" title=${root}>${root}</div>
      <${FolderEntries} key=${refresh} projectId=${project.id} path="" depth=${0} />
    </div>
  </div>`;
}

/** @param {{ projectId: string }} props */
export function Workbench({ projectId }) {
  const projects = useAppState((state) => state.projects);
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return html`<main class="main"><div class="empty">${t('找不到这个项目。')}</div></main>`;
  }
  const active = projects.filter((p) => !p.archived);
  return html`<main class="main">
    <${MainHead} crumb=${project.name} section=${t('研究组织')} title=${t('工作站')}>
      <button
        class="iconbtn"
        title=${t('新建项目内聊天')}
        aria-label=${t('新建项目内聊天')}
        onClick=${() => navigate({ view: 'new', id: project.id })}
      >
        <${Icon} name="chat" />
      </button>
    <//>
    <div class="mainbody">
      <div class="workbench">
        <${PlanStrip} project=${project} projects=${active} />
        <${JournalStrip} project=${project} />
        <div class="wb-bottom">
          <${Changes} project=${project} />
          <${ResearchMap} project=${project} />
          <${ProjectFolder} project=${project} />
        </div>
      </div>
    </div>
  </main>`;
}
