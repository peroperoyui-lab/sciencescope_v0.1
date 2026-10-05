// Workbench areas on their own pages (查看全部 / 展开文件视图): all plans,
// the project log and the project folder.
import { useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { MainHead } from './mainhead.js';
import { ProjectFolder } from './project-folder.js';
import { JournalStrip, PlanStrip } from './workbench.js';

const TITLES = {
  plans: '全局计划',
  journal: '项目日志 · 关键节点',
  files: '项目文件夹 · 文件资源管理',
};

/** @param {{ view: 'plans' | 'journal' | 'files', projectId: string }} props */
export function WorkbenchPage({ view, projectId }) {
  const projects = useAppState((state) => state.projects);
  const project = projects.find((p) => p.id === projectId);
  if (!project)
    return html`<main class="main"><div class="empty">${t('找不到这个项目。')}</div></main>`;
  let content;
  if (view === 'plans') {
    content = html`<${PlanStrip}
      project=${project}
      projects=${projects.filter((p) => !p.archived)}
      full
    />`;
  } else if (view === 'journal') content = html`<${JournalStrip} project=${project} full />`;
  else content = html`<${ProjectFolder} project=${project} full />`;
  return html`<main class="main">
    <${MainHead} crumb=${project.name} section=${t('研究组织')} title=${t(TITLES[view])} />
    <div class="mainbody">${content}</div>
  </main>`;
}
