// A project's workbench: plans (project and global), research log, research
// map and the change history. Every edit here is a workspace edit, recorded
// as a revision that anyone (people or AIs) can undo.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { InlineInput } from './common.js';

const TASK = /^(\s*)- \[( |x|X)\] (.*)$/;

/**
 * Read a resource and re-read it whenever the workspace changes.
 * @param {string} resource @param {string} key
 */
function useResource(resource, key) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [result, setResult] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    actions
      .readResource(resource, key)
      .then((value) => current && (setResult(value), setError('')))
      .catch((failure) => current && setError(failure.message));
    return () => {
      current = false;
    };
  }, [resource, key, version]);
  return { result, error };
}

/** @param {{ title: string, planKey: string }} props */
function Plans({ title, planKey }) {
  const actions = useActions();
  const { result, error } = useResource('plans', planKey);
  const [adding, setAdding] = useState(false);
  const text = result?.text ?? '';
  const lines = text.split('\n');

  function toggle(index) {
    const match = TASK.exec(lines[index]);
    const done = match[2] === ' ' ? 'x' : ' ';
    const next = lines.slice();
    next[index] = `${match[1]}- [${done}] ${match[3]}`;
    actions.editResource('plans', planKey, 'write', { text: next.join('\n') });
  }

  const tasks = lines
    .map((line, index) => ({ match: TASK.exec(line), index }))
    .filter((entry) => entry.match);
  const other = lines.filter((line) => line.trim() && !TASK.test(line)).join('\n');

  return html`<section class="wbsection">
    <div class="between">
      <h3>${title}</h3>
      <button class="btn tiny" onClick=${() => setAdding(true)}>
        <${Icon} name="plus" />${t('添加计划')}
      </button>
    </div>
    ${error && html`<div class="notice failed">${error}</div>`}
    <div class="plancards">
      ${tasks.map(
        ({ match, index }) =>
          html`<label class=${`plancard ${match[2] === ' ' ? '' : 'done'}`} key=${index}>
            <input type="checkbox" checked=${match[2] !== ' '} onChange=${() => toggle(index)} />
            <span>${match[3]}</span>
          </label>`,
      )}
      ${
        adding &&
        html`<div class="plancard">
          <${InlineInput}
            placeholder=${t('计划内容')}
            onCommit=${(task) => {
              setAdding(false);
              actions.editResource('plans', planKey, 'append', { text: `- [ ] ${task}\n` });
            }}
            onCancel=${() => setAdding(false)}
          />
        </div>`
      }
      ${!tasks.length && !adding && html`<div class="empty small">${t('还没有计划。')}</div>`}
    </div>
    ${
      other &&
      html`<div
        class="markdown note"
        dangerouslySetInnerHTML=${{ __html: renderMarkdown(other) }}
      />`
    }
  </section>`;
}

/** Split the log into entries, one per second-level heading. @param {string} text */
function logEntries(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) entries.push({ title: line.slice(3).trim(), body: [] });
    else if (entries.length) entries.at(-1).body.push(line);
  }
  return entries.map((entry) => ({ ...entry, body: entry.body.join('\n').trim() })).reverse();
}

/** @param {{ projectId: string }} props */
function Log({ projectId }) {
  const actions = useActions();
  const { result, error } = useResource('log', projectId);
  const [adding, setAdding] = useState(false);
  const entries = logEntries(result?.text ?? '');
  return html`<section class="wbsection">
    <div class="between">
      <h3>${t('项目日志')}</h3>
      <button class="btn tiny" onClick=${() => setAdding(true)}>
        <${Icon} name="plus" />${t('添加日志')}
      </button>
    </div>
    ${error && html`<div class="notice failed">${error}</div>`}
    <div class="logcards">
      ${
        adding &&
        html`<div class="logcard">
          <${InlineInput}
            placeholder=${t('日志标题')}
            onCommit=${(title) => {
              setAdding(false);
              const date = new Date().toISOString().slice(0, 10);
              actions.editResource('log', projectId, 'append', { text: `\n## ${date} ${title}\n` });
            }}
            onCancel=${() => setAdding(false)}
          />
        </div>`
      }
      ${entries.map(
        (entry, index) =>
          html`<details class="logcard" key=${index}>
            <summary>${entry.title}</summary>
            ${
              entry.body
                ? html`<div
                    class="markdown"
                    dangerouslySetInnerHTML=${{
                      __html: renderMarkdown(entry.body),
                    }}
                  />`
                : html`<small>${t('没有详细内容。')}</small>`
            }
          </details>`,
      )}
      ${!entries.length && !adding && html`<div class="empty small">${t('还没有日志。')}</div>`}
    </div>
  </section>`;
}

/** @param {{ node: any, nodes: any[], projectId: string }} props */
function MapNode({ node, nodes, projectId }) {
  const actions = useActions();
  const [mode, setMode] = useState(/** @type {'' | 'rename' | 'add'} */ (''));
  const children = nodes.filter((child) => child.parent === node.id);
  const edit = (op, args) => actions.editResource('map', projectId, op, args);
  return html`<li>
    <div class="mapnode">
      ${
        mode === 'rename'
          ? html`<${InlineInput}
              value=${node.text}
              placeholder=${t('节点内容')}
              onCommit=${(text) => {
                setMode('');
                edit('updateNode', { id: node.id, changes: { text } });
              }}
              onCancel=${() => setMode('')}
            />`
          : html`<span class="grow" onDblClick=${() => setMode('rename')}>${node.text}</span>`
      }
      <button class="iconbtn small" title=${t('添加子节点')} onClick=${() => setMode('add')}>
        <${Icon} name="plus" />
      </button>
      <button
        class="iconbtn small"
        title=${t('删除节点')}
        onClick=${() => edit('removeNode', { id: node.id })}
      >
        <${Icon} name="x" />
      </button>
    </div>
    ${
      (children.length > 0 || mode === 'add') &&
      html`<ul>
        ${children.map(
          (child) =>
            html`<${MapNode}
              key=${child.id}
              node=${child}
              nodes=${nodes}
              projectId=${projectId}
            />`,
        )}
        ${
          mode === 'add' &&
          html`<li>
            <${InlineInput}
              placeholder=${t('节点内容')}
              onCommit=${(text) => {
                setMode('');
                edit('addNode', { node: { parent: node.id, text } });
              }}
              onCancel=${() => setMode('')}
            />
          </li>`
        }
      </ul>`
    }
  </li>`;
}

/** @param {{ projectId: string }} props */
function ResearchMap({ projectId }) {
  const actions = useActions();
  const { result, error } = useResource('map', projectId);
  const [adding, setAdding] = useState(false);
  const nodes = result?.value?.nodes ?? [];
  const known = new Set(nodes.map((node) => node.id));
  const roots = nodes.filter((node) => !node.parent || !known.has(node.parent));
  return html`<section class="wbsection mapsection">
    <div class="between">
      <h3>${t('研究框架与进展')}</h3>
      <button class="btn tiny" onClick=${() => setAdding(true)}>
        <${Icon} name="plus" />${t('添加节点')}
      </button>
    </div>
    ${error && html`<div class="notice failed">${error}</div>`}
    <ul class="maptree">
      ${roots.map(
        (node) =>
          html`<${MapNode} key=${node.id} node=${node} nodes=${nodes} projectId=${projectId} />`,
      )}
      ${
        adding &&
        html`<li>
          <${InlineInput}
            placeholder=${t('节点内容')}
            onCommit=${(text) => {
              setAdding(false);
              actions.editResource('map', projectId, 'addNode', { node: { text } });
            }}
            onCancel=${() => setAdding(false)}
          />
        </li>`
      }
    </ul>
    ${!roots.length && !adding && html`<div class="empty small">${t('导图还是空的。')}</div>`}
  </section>`;
}

const RESOURCE_LABELS = { plans: '计划', log: '日志', map: '导图' };
const OP_LABELS = {
  write: '改写',
  append: '追加',
  replace: '替换',
  delete: '删除',
  addNode: '添加了节点',
  updateNode: '修改节点',
  removeNode: '删除了节点',
  addEdge: '添加连线',
  removeEdge: '删除连线',
  undo: '撤销了修改',
  external: '程序外编辑',
};

/** Recent changes to this project's workbench, each undoable. @param {{ projectId: string }} props */
function Changes({ projectId }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const participants = useAppState((state) => state.participants);
  const [revisions, setRevisions] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    const queries = [
      { resource: 'plans', key: projectId },
      { resource: 'log', key: projectId },
      { resource: 'map', key: projectId },
      { resource: 'plans', key: 'global' },
    ];
    Promise.all(queries.map((query) => actions.history({ ...query, limit: 20 })))
      .then((lists) =>
        setRevisions(
          lists
            .flat()
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 30),
        ),
      )
      .catch((failure) => setError(failure.message));
  }, [projectId, version]);
  const nameOf = (revision) =>
    revision.op === 'external'
      ? t('文件')
      : (participants.find((p) => p.id === revision.actorId)?.name ??
        revision.actorId ??
        t('未知'));

  async function undo(revision) {
    setError('');
    try {
      await actions.undo(revision.id);
    } catch (failure) {
      setError(failure.message);
    }
  }

  return html`<section class="wbsection changes">
    <h3>${t('更改记录')}</h3>
    ${error && html`<div class="notice failed">${error}</div>`}
    ${revisions.map(
      (revision) =>
        html`<div class="listrow" key=${revision.id}>
          <${Icon} name="clock" />
          <span class="grow">
            <strong>${nameOf(revision)}</strong>
            ${' '}${t(RESOURCE_LABELS[revision.resource] ?? revision.resource)}${
              revision.key === 'global' ? ` (${t('全局')})` : ''
            }
            · ${OP_LABELS[revision.op] ? t(OP_LABELS[revision.op]) : revision.op}
          </span>
          <small>${formatTime(revision.createdAt)}</small>
          ${
            revision.undoneBy
              ? html`<small>${t('已撤销')}</small>`
              : html`<button class="btn tiny" onClick=${() => undo(revision)}>
                  <${Icon} name="undo" />${t('撤销')}
                </button>`
          }
        </div>`,
    )}
    ${!revisions.length && html`<div class="empty small">${t('还没有更改。')}</div>`}
  </section>`;
}

/** @param {{ projectId: string }} props */
export function Workbench({ projectId }) {
  const project = useAppState((state) => state.projects.find((p) => p.id === projectId));
  if (!project) return html`<div class="empty">${t('找不到这个项目。')}</div>`;
  return html`<section class="main">
    <header class="mainhead">
      <div class="grow">
        <div class="crumb">${project.name}</div>
        <strong class="head-title">${t('工作站')}</strong>
      </div>
    </header>
    <div class="mainbody">
      <div class="workbench">
        <${Plans} title=${t('全局计划')} planKey="global" />
        <${Plans} title=${t('项目计划')} planKey=${projectId} />
        <${Log} projectId=${projectId} />
        <div class="wbgrid">
          <${ResearchMap} projectId=${projectId} />
          <${Changes} projectId=${projectId} />
        </div>
      </div>
    </div>
  </section>`;
}
