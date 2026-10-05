// 项目置顶摘要: the flyout from a project meeting's header (old
// `.project-flyout`): recent changes with undo, the workbench and the latest
// log entries.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { OP_LABELS, RESOURCE_LABELS, useProjectRevisions } from '../project-changes.js';
import { navigate } from '../route.js';
import { parseLog } from '../workbench-text.js';

/** @param {{ project: any, onClose: () => void }} props */
export function ProjectSummary({ project, onClose }) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const revisions = useProjectRevisions(project.id, 20);
  const [showChanges, setShowChanges] = useState(true);
  const [log, setLog] = useState([]);
  useEffect(() => {
    actions
      .readResource('log', project.id)
      .then((file) => setLog(parseLog(file.text ?? '').slice(0, 2)))
      .catch(() => {});
  }, [project.id, version]);
  useEffect(() => {
    const close = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, []);
  const open = (route) => {
    onClose();
    navigate(route);
  };

  return html`<section class="project-flyout" role="dialog" aria-label=${t('项目置顶摘要')}>
    <div class="flyhead">
      <span>${t('项目摘要')}</span>
      <button
        class="iconbtn"
        title=${t('关闭项目摘要')}
        aria-label=${t('关闭项目摘要')}
        onClick=${onClose}
      >
        <${Icon} name="close" />
      </button>
    </div>
    <div class="flyrow">
      <${Icon} name="folder" /><strong class="grow ellipsis">${project.name}</strong>
    </div>
    <button class="flyrow" onClick=${() => setShowChanges(!showChanges)}>
      <${Icon} name="file" /><span class="grow">${t('变更')}</span>
      <span class="change-count">${t('{n} 项', { n: revisions.length })}</span>
      <${Icon} name=${showChanges ? 'down' : 'right'} />
    </button>
    ${
      showChanges &&
      html`<div>
        ${revisions.slice(0, 5).map(
          (revision) =>
            html`<div class="flyfile" key=${revision.id}>
              <${Icon} name="file" />
              <span class="grow ellipsis"
                >${t(RESOURCE_LABELS[revision.resource] ?? revision.resource)}</span
              >
              <span
                class=${`tag ${revision.op === 'delete' || revision.op === 'removeNode' ? 'warn' : 'fill'}`}
              >
                ${OP_LABELS[revision.op] ? t(OP_LABELS[revision.op]) : revision.op}
              </span>
              ${
                !revision.undoneBy &&
                html`<button
                  class="iconbtn"
                  title=${t('撤销')}
                  aria-label=${t('撤销')}
                  onClick=${() => actions.attempt(() => actions.undo(revision.id))}
                >
                  <${Icon} name="undo" />
                </button>`
              }
            </div>`,
        )}
        ${!revisions.length && html`<small>${t('暂无修改')}</small>`}
      </div>`
    }
    <button class="flyrow" onClick=${() => open({ view: 'workbench', id: project.id })}>
      <${Icon} name="cube" /><span class="grow">${t('研究框架与进展')}</span
      ><${Icon} name="right" />
    </button>
    <div class="flygroup">
      <small>${t('最近节点')}</small>
      ${log.map(
        (entry) =>
          html`<button
            class="flyfile"
            key=${entry.start}
            onClick=${() => open({ view: 'journal', id: project.id })}
          >
            <span class="grow ellipsis">${entry.title}</span><small>${entry.date}</small>
          </button>`,
      )}
      ${!log.length && html`<small>${t('暂无项目日志')}</small>`}
    </div>
    <div class="flyfooter">
      <button class="btn tiny" onClick=${() => open({ view: 'workbench', id: project.id })}>
        ${t('工作站')}
      </button>
    </div>
  </section>`;
}
