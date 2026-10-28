// Workbench areas on their own pages (查看全部 / 项目资料): all plans, the
// project log and the project folder, each with a way back.
import { useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { ProjectFolderPage } from './project-folder.js';
import { JournalStrip, PlanStrip } from './workbench.js';

const TITLES = {
  plans: '全局计划',
  journal: '项目日志',
};

/** @param {{ view: 'plans' | 'journal' | 'files', projectId: string }} props */
export function WorkbenchPage({ view, projectId }) {
  const projects = useAppState((state) => state.projects);
  const project = projects.find((p) => p.id === projectId);
  if (!project)
    return html`<main class="main ss-main">
      <div class="ss-empty">${t('找不到这个项目。')}</div>
    </main>`;
  if (view === 'files') return html`<${ProjectFolderPage} project=${project} />`;
  let content;
  if (view === 'plans') {
    content = html`<${PlanStrip}
      project=${project}
      projects=${projects.filter((p) => !p.archived)}
      full
    />`;
  } else content = html`<${JournalStrip} project=${project} full />`;
  return html`<main class="main ss-main">
    <div class="ss-header">
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('返回工作站')}
        data-tip=${t('返回工作站')}
        onClick=${() => navigate({ view: 'workbench', id: project.id })}
      >
        <${Lucide} name="arrow-left" />
      </button>
      <div class="ss-header__title"><span>${t(TITLES[view])}</span></div>
      <span class="ss-tag ss-header__tag">${project.name}</span>
    </div>
    ${content}
  </main>`;
}
