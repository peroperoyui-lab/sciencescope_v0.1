// A project's workbench in the old interface's markup: plan cards across all
// projects, this project's log, and the bottom row with history versions,
// the research map and the project folder. Every edit is a workspace edit,
// retained in resource snapshots when an editing page is left.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { openResourceHistory, ResourceHistory } from './resource-history.js';
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
import { MapCanvas } from './map-canvas.js';
import { ProjectFolder } from './project-folder.js';
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

/**
 * Plans of every project plus the global plans: a strip on the workbench, or
 * the full page (`full`, 查看全部).
 * @param {{ project: any, projects: any[], full?: boolean }} props
 */
export function PlanStrip({ project, projects, full = false }) {
  const actions = useActions();
  const keys = ['global', ...projects.map((p) => p.id)];
  const files = useResources(keys.map((key) => ['plans', key]));
  useSnapshotCapture(keys.map((key) => ['plans', key]));
  const history = () => openResourceHistory(actions, { projectId: project.id, resource: 'plans' });
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

  const add = () =>
    actions.openModal(
      t('添加计划'),
      html`<${PlanForm} projectId=${project.id} projects=${projects} />`,
    );
  const cardList = html`${cards.map(
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
  )}`;

  if (full) {
    return html`<div class="content">
      <div class="pageintro between">
        <h1 style="margin:0">${t('全局计划')}</h1>
        <div class="row">
          <button class="btn" onClick=${history}>${t('历史版本')}</button>
          <button class="btn primary" onClick=${add}>+ ${t('添加计划')}</button>
        </div>
      </div>
      <div class="wb-plan-grid">
        ${cardList}${!cards.length && html`<div class="empty">${t('暂无计划')}</div>`}
      </div>
    </div>`;
  }
  return html`<section class="wb-top">
    <div class="sectionline">
      ${t('全局计划')} <span class="spacer"></span>
      <button class="btn tiny" onClick=${history}>${t('历史版本')}</button>
      <button class="btn tiny" onClick=${add}>+ ${t('添加计划')}</button>
      <button class="btn tiny" onClick=${() => navigate({ view: 'plans', id: project.id })}>
        ${t('查看全部')}
      </button>
    </div>
    <div class="planstrip">
      ${cardList}${!cards.length && html`<div class="inline-empty">${t('暂无计划')}</div>`}
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

/**
 * This project's log: cards on the workbench, or the full page (`full`).
 * @param {{ project: any, full?: boolean }} props
 */
export function JournalStrip({ project, full = false }) {
  const actions = useActions();
  const [file] = useResources([['log', project.id]]);
  useSnapshotCapture([['log', project.id]]);
  const history = () => openResourceHistory(actions, { projectId: project.id, resource: 'log' });
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

  const add = () => actions.openModal(t('添加日志'), html`<${LogForm} projectId=${project.id} />`);
  const brief = (entry) =>
    actions.openModal(
      entry.title,
      html`<p>${entry.body.split(/\n\s*\n/)[0] || t('没有详细内容。')}</p>`,
    );

  if (full) {
    return html`<div class="content">
      <div class="pageintro between">
        <h1 style="margin:0">${t('项目日志')}</h1>
        <div class="row">
          <button class="btn" onClick=${history}>${t('历史版本')}</button
          ><button class="btn primary" onClick=${add}>${t('添加日志')}</button>
        </div>
      </div>
      <div class="stack">
        ${entries.map(
          (entry) =>
            html`<article
              class="card"
              key=${entry.start}
              onContextMenu=${(event) => menu(event, entry)}
            >
              <div class="between">
                <h2 style="margin:0">${entry.title}</h2>
                <div class="row">
                  <small>${entry.date}</small>
                  <button
                    class="iconbtn"
                    title=${t('日志菜单')}
                    aria-label=${t('日志菜单')}
                    onClick=${(event) => menu(event, entry)}
                  >
                    <${Icon} name="more" />
                  </button>
                </div>
              </div>
              <div
                class="rendered-markdown"
                dangerouslySetInnerHTML=${{ __html: renderMarkdown(entry.body || t('没有详细内容。')) }}
              ></div>
            </article>`,
        )}
      </div>
      ${!entries.length && html`<div class="empty">${t('暂无项目日志')}</div>`}
    </div>`;
  }
  return html`<section class="wb-top">
    <div class="sectionline">
      ${t('本项目日志')} <small>${project.name}</small>
      <span class="spacer"></span>
      <button class="btn tiny" onClick=${history}>${t('历史版本')}</button>
      <button class="btn tiny" onClick=${add}>+ ${t('添加日志')}</button>
      <button class="btn tiny" onClick=${() => navigate({ view: 'journal', id: project.id })}>
        ${t('查看全部')}
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
            <button
              class="iconbtn"
              title=${t('日志菜单')}
              aria-label=${t('日志菜单')}
              onClick=${(event) => menu(event, entry)}
            >
              <${Icon} name="more" />
            </button>
            <h3>${entry.title}</h3>
            <button onClick=${() => brief(entry)}>${t('简述')} ›</button>
            <button onClick=${() => details(entry)}>${t('日志详情')} ›</button>
            <span class="stamp">${entry.date}</span>
          </article>`,
      )}
      ${!entries.length && html`<div class="inline-empty">${t('暂无项目日志')}</div>`}
    </div>
  </section>`;
}

/** History versions of this project's resources. @param {{ project: any }} props */
function Changes({ project }) {
  return html`<div class="wb-left">
    <div class="wb-title"><span class="grow">${t('历史版本')}</span></div>
    <${ResourceHistory} query=${{ projectId: project.id }} compact />
  </div>`;
}

/** The workbench's map preview; the editor opens from its corner. @param {{ project: any }} props */
function ResearchMap({ project }) {
  const actions = useActions();
  const [file] = useResources([['map', project.id]]);
  useSnapshotCapture([['map', project.id]]);
  const [selected, setSelected] = useState(/** @type {string | null} */ (null));
  const nodes = file?.value?.nodes ?? [];
  const edit = (op, args) =>
    actions.attempt(() => actions.editResource('map', project.id, op, args));
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
  const editNode = (node) =>
    nodeForm(t('编辑节点'), node.text, (text) =>
      edit('updateNode', { id: node.id, changes: { text } }),
    );
  const nodeMenu = (event, node) =>
    actions.openMenu(
      event,
      [
        { text: t('添加子节点'), icon: 'plus', run: () => addChild(node.id) },
        { text: t('编辑'), icon: 'edit', run: () => editNode(node) },
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
      <button
        class="iconbtn"
        title=${t('打开研究导图编辑窗口')}
        aria-label=${t('打开研究导图编辑窗口')}
        onClick=${() => navigate({ view: 'map', id: project.id })}
      >
        <${Icon} name="expand" />
      </button>
      <span class="grow">${t('研究框架与进展')}</span>
      <span class="tag">${t('预览')}</span>
    </div>
    <${MapCanvas}
      nodes=${nodes}
      selected=${selected}
      onSelect=${setSelected}
      onAddChild=${addChild}
      onEditNode=${editNode}
      onNodeMenu=${nodeMenu}
    />
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
