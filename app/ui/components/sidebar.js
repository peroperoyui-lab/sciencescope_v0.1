// Left sidebar in the old interface's markup: navigation, search, pinned
// items, the project tree with its meetings, standalone meetings, "browse
// all" and the user bar.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { FieldForm } from './overlays.js';
import { ProjectSummary } from './project-summary.js';
import { ProfileForm } from './shell.js';
import { ActivityBadge, BackgroundActivity } from './background-activity.js';

const byRecent = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
/** Meetings shown in the tree: not archived, not attached to another meeting. */
const listed = (meeting) =>
  !meeting.archived &&
  !meeting.attachedToMeetingId &&
  meeting.policy?.respondent !== 'agent_assistant';

function useRename() {
  const actions = useActions();
  return (title, value, save) =>
    actions.openModal(
      title,
      html`<${FieldForm}
        label=${t('名称')}
        value=${value}
        submitText=${t('保存')}
        onSubmit=${save}
      />`,
    );
}

/** @param {{ meeting: any, active: boolean, child?: boolean, pinnedRow?: boolean }} props */
function ChatRow({ meeting, active, child = false, pinnedRow = false }) {
  const actions = useActions();
  const rename = useRename();
  const items = [
    {
      text: t('打开对话'),
      icon: 'chat',
      run: () => navigate({ view: 'meeting', id: meeting.id }),
    },
    { sep: true },
    {
      text: meeting.pinned ? t('取消置顶') : t('置顶'),
      check: meeting.pinned,
      run: () =>
        actions.attempt(() => actions.updateMeeting(meeting.id, { pinned: !meeting.pinned })),
    },
    {
      text: t('重命名'),
      icon: 'edit',
      key: 'F2',
      run: () =>
        rename(t('重命名对话'), meeting.title, (title) =>
          actions.updateMeeting(meeting.id, { title }),
        ),
    },
    {
      text: t('归档'),
      icon: 'folder',
      run: () => actions.attempt(() => actions.updateMeeting(meeting.id, { archived: true })),
    },
  ];
  const openMenu = (event) => actions.openMenu(event, items, meeting.title);
  return html`<div
    class=${`tree-row ${child ? 'child' : ''} ${pinnedRow ? 'pinned-item' : ''} ${active ? 'active' : ''}`}
    data-object="chat"
    data-object-id=${meeting.id}
    onContextMenu=${openMenu}
  >
    <button
      class="tree-name"
      title=${meeting.title}
      onClick=${() => navigate({ view: 'meeting', id: meeting.id })}
    >
      <${Icon} name="chat" />
      <span class="ellipsis">${meeting.title}</span>
      <${ActivityBadge} meetingId=${meeting.id} />
    </button>
    <button class="iconbtn" title=${t('对话菜单')} aria-label=${t('对话菜单')} onClick=${openMenu}>
      <${Icon} name="more" />
    </button>
  </div>`;
}

/**
 * @param {{ project: any, active: boolean, pinnedRow?: boolean, expanded?: boolean,
 *   onToggle?: () => void }} props
 */
function ProjectRow({ project, active, pinnedRow = false, expanded, onToggle }) {
  const actions = useActions();
  const rename = useRename();
  const items = [
    {
      text: t('打开项目'),
      icon: 'folder',
      run: () => navigate({ view: 'workbench', id: project.id }),
    },
    {
      text: t('新建项目内聊天'),
      icon: 'plus',
      run: () => navigate({ view: 'new', id: project.id }),
    },
    { sep: true },
    {
      text: project.pinned ? t('取消置顶') : t('置顶'),
      check: project.pinned,
      run: () =>
        actions.attempt(() => actions.updateProject(project.id, { pinned: !project.pinned })),
    },
    {
      text: t('重命名'),
      icon: 'edit',
      key: 'F2',
      run: () =>
        rename(t('重命名项目'), project.name, (name) =>
          actions.updateProject(project.id, { name }),
        ),
    },
    {
      text: t('归档'),
      icon: 'folder',
      run: () => actions.attempt(() => actions.updateProject(project.id, { archived: true })),
    },
  ];
  const openMenu = (event) => actions.openMenu(event, items, project.name);
  return html`<div
    class=${`tree-row ${pinnedRow ? 'pinned-item' : ''} ${active ? 'active' : ''}`}
    data-object="project"
    onContextMenu=${openMenu}
  >
    ${
      pinnedRow
        ? html`<span class="tree-arrow-spacer" aria-hidden="true"></span>`
        : html`<button
            class="tree-arrow"
            aria-expanded=${expanded}
            aria-label=${(expanded ? t('收起') : t('展开')) + ' ' + project.name}
            onClick=${onToggle}
          >
            <${Icon} name=${expanded ? 'down' : 'right'} />
          </button>`
    }
    <button class="tree-name" onClick=${() => navigate({ view: 'workbench', id: project.id })}>
      <${Icon} name="folder" />
      <span class="ellipsis">${project.name}</span>
    </button>
    <button class="iconbtn" title=${t('项目菜单')} aria-label=${t('项目菜单')} onClick=${openMenu}>
      <${Icon} name="more" />
    </button>
  </div>`;
}

/** @param {{ route: import('../route.js').Route, currentProjectId: string | null }} props */
export function Sidebar({ route, currentProjectId }) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const settings = useAppState((state) => state.settings);
  const assistantOpen = useAppState((state) => state.assistantOpen);
  const [collapsed, setCollapsed] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [peek, setPeek] = useState(false);
  const memoryVersion = useAppState((state) => state.researchVersion);
  const [inboxCount, setInboxCount] = useState(0);
  const inboxProject =
    currentProjectId ?? projects.find((project) => !project.archived)?.id ?? null;
  useEffect(() => {
    let current = true;
    actions
      .memoryInbox(inboxProject)
      .then((result) => current && setInboxCount(result.count))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [inboxProject, memoryVersion]);

  const visible = meetings.filter(listed).sort(byRecent);
  const activeProjects = projects.filter((project) => !project.archived);
  const pinnedProjects = activeProjects.filter((project) => project.pinned);
  const pinnedMeetings = visible.filter((meeting) => meeting.pinned);
  const standalone = visible.filter((meeting) => !meeting.projectId);
  const isActiveMeeting = (meeting) =>
    route.view === 'meeting' && route.id.split('/')[0] === meeting.id;
  const isActiveProject = (project) => route.view === 'workbench' && route.id === project.id;
  const userName = settings?.profile?.name || t('用户');
  const peekProject = activeProjects.find(
    (p) => p.id === (currentProjectId ?? activeProjects[0]?.id),
  );

  function openWorkbench() {
    const projectId = currentProjectId ?? activeProjects[0]?.id;
    if (projectId) navigate({ view: 'workbench', id: projectId });
    else actions.toast(t('先新建一个项目，工作站按项目整理计划、日志与导图。'));
  }

  function newProject() {
    navigate({ view: 'project-new' });
  }

  return html`<aside class="sidebar">
    <div>
      <button
        class=${`nav ${route.view === 'home' || route.view === 'new' ? 'active' : ''}`}
        onClick=${actions.newIndependent}
      >
        <${Icon} name="chat" /><span>${t('新对话')}</span>
      </button>
      <button
        class=${`nav ${['database', 'library', 'sources'].includes(route.view) ? 'active' : ''}`}
        data-route="database"
        onClick=${() => navigate(currentProjectId || activeProjects[0]?.id ? { view: 'database', id: currentProjectId ?? activeProjects[0].id } : { view: 'library' })}
      >
        <${Icon} name="book" /><span>${t('数据库')}</span>
        ${inboxCount > 0 && html`<span class="badge" data-rb-inbox-count>${inboxCount}</span>`}
      </button>
      <div class="row" style="gap:0">
        <button
          class=${`nav ${route.view === 'workbench' ? 'active' : ''}`}
          onClick=${openWorkbench}
        >
          <${Icon} name="cube" /><span>${t('工作站')}</span>
        </button>
        ${
          peekProject &&
          html`<button
            class="iconbtn"
            title=${t('工作站简略信息')}
            aria-label=${t('工作站简略信息')}
            aria-expanded=${peek}
            onClick=${() => setPeek(!peek)}
          >
            <${Icon} name="summary" />
          </button>`
        }
      </div>
      ${
        peek &&
        peekProject &&
        html`<${ProjectSummary} project=${peekProject} onClose=${() => setPeek(false)} />`
      }

      <button class="side-search" onClick=${actions.openPalette}>
        <${Icon} name="search" /><span>${t('搜索')}</span><kbd>Ctrl+K</kbd>
      </button>
    </div>

    <div class="navscroll">
      <${BackgroundActivity}
        currentMeetingId=${route.view === 'meeting' ? route.id.split('/')[0] : undefined}
      />
      <div class="navsection">${t('置顶')}</div>
      ${
        pinnedMeetings.length + pinnedProjects.length === 0 &&
        html`<div class="inline-empty">${t('暂无置顶')}</div>`
      }
      ${pinnedMeetings.map(
        (meeting) =>
          html`<${ChatRow}
            key=${meeting.id}
            meeting=${meeting}
            pinnedRow
            active=${isActiveMeeting(meeting)}
          />`,
      )}
      ${pinnedProjects.map(
        (project) =>
          html`<${ProjectRow}
            key=${project.id}
            project=${project}
            pinnedRow
            active=${isActiveProject(project)}
          />`,
      )}

      <div class="navsection">
        <span>${t('全部项目与聊天')}</span>
        <button
          class="iconbtn"
          title=${t('新建项目')}
          aria-label=${t('新建项目')}
          onClick=${newProject}
        >
          <${Icon} name="plus" />
        </button>
      </div>
      ${activeProjects.map((project) => {
        const expanded = !collapsed[project.id];
        return html`<${ProjectRow}
            key=${project.id}
            project=${project}
            expanded=${expanded}
            active=${isActiveProject(project)}
            onToggle=${() => setCollapsed({ ...collapsed, [project.id]: expanded })}
          />
          ${
            expanded &&
            visible
              .filter((meeting) => meeting.projectId === project.id)
              .map(
                (meeting) =>
                  html`<${ChatRow}
                    key=${meeting.id}
                    meeting=${meeting}
                    child
                    active=${isActiveMeeting(meeting)}
                  />`,
              )
          }`;
      })}

      <div class="navsection">${t('独立对话')}</div>
      ${standalone.map(
        (meeting) =>
          html`<${ChatRow}
            key=${meeting.id}
            meeting=${meeting}
            active=${isActiveMeeting(meeting)}
          />`,
      )}
    </div>

    <div class="sidebar-fixed">
      <button class="browse-all" onClick=${() => navigate({ view: 'all' })}>
        <${Icon} name="search" /><span>${t('浏览全部')}</span><kbd>Ctrl+Shift+K</kbd>
      </button>
    </div>
    <div class="userbar row">
      <span class="avatar">${userName.slice(0, 1).toUpperCase()}</span>
      <button
        class="grow profile-entry"
        title=${t('编辑个人资料')}
        onClick=${() => actions.openModal(t('个人资料'), html`<${ProfileForm} />`)}
      >
        ${userName}
      </button>
      <button
        class="iconbtn"
        title=${t('全局助手')}
        aria-label=${t('全局助手')}
        aria-expanded=${assistantOpen}
        onClick=${() => actions.showAssistant(!assistantOpen)}
      >
        <${Icon} name="users" />
      </button>
      <button
        class="iconbtn"
        title=${t('设置')}
        aria-label=${t('设置')}
        onClick=${() => navigate({ view: 'settings', id: 'general' })}
      >
        <${Icon} name="gear" />
      </button>
    </div>
  </aside>`;
}
