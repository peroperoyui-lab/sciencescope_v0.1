// Left sidebar (design system Sidebar): navigation, search, pinned items, the
// project tree, standalone chats, 全部对话 and the user bar. A row ends in its
// chat's status or last activity; standalone chats can be dragged into a project.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { knowledgeRoute, navigate } from '../route.js';
import { ACTIVITY_LABELS, meetingActivity } from '../activity.js';
import { FieldForm } from './overlays.js';
import { ProjectSummary } from './project-summary.js';
import { ProfileForm } from './shell.js';
import { Splitter } from './splitter.js';
import { deskEnabled, openDesk } from '../desk-window.js';

const DEFAULT_WIDTH = 248;
const MIN_WIDTH = 200;
const MAX_WIDTH = 360;
/** Chats a project lists before 还有 N 个. */
const SHOWN = 5;
const DRAG_TYPE = 'application/x-sciencescope-chat';

const byRecent = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
/** Meetings shown in the tree: not archived, not attached to another meeting. */
const listed = (meeting) =>
  !meeting.archived &&
  !meeting.temporary &&
  !meeting.attachedToMeetingId &&
  meeting.policy?.respondent !== 'agent_assistant';

/** 今天, 昨天, 3 天, 2 周, 4 个月. @param {string} iso */
function since(iso) {
  const start = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(iso))) / 86400000);
  if (days <= 0) return t('今天');
  if (days === 1) return t('昨天');
  if (days < 7) return t('{n} 天', { n: days });
  if (days < 30) return t('{n} 周', { n: Math.floor(days / 7) });
  return t('{n} 个月', { n: Math.floor(days / 30) });
}

const STATES = {
  approval: { icon: 'shield-question-mark', tone: 'warn', tip: '等你批准' },
  failed: { icon: 'circle-alert', tone: 'danger', tip: '上次回答失败，点开查看' },
  queued: { icon: 'clock', tone: '', tip: '排在当前回答之后' },
  paused: { icon: 'clock', tone: '', tip: '队列已暂停' },
};

/** Spinner, a status mark, or the last activity. @param {{ meeting: any }} props */
function RowEnd({ meeting }) {
  const activity = useAppState((state) => meetingActivity(state, meeting.id));
  if (activity?.status === 'running')
    return html`<span class="ss-spin" aria-label=${t('运行中')}></span>`;
  const shown = activity && STATES[activity.status];
  if (shown)
    return html`<span
      class=${`ss-tree-row__state ${shown.tone ? `ss-tree-row__state--${shown.tone}` : ''}`}
      data-tip=${t(shown.tip)}
      data-tip-place="right"
      ><${Lucide} name=${shown.icon} small />${t(ACTIVITY_LABELS[activity.status])}</span
    >`;
  return since(meeting.updatedAt);
}

/** Running chats keep their place: archiving or moving one waits until it ends. */
export function useBusy(meetingId) {
  return useAppState((state) =>
    Object.values(state.running).some((turn) => turn.meetingId === meetingId),
  );
}

/** @param {any} actions @param {any} meeting @param {any[]} projects */
function moveTo(actions, meeting, projectId, projects) {
  const from = meeting.projectId;
  const target = projects.find((project) => project.id === projectId);
  return actions.attempt(async () => {
    await actions.moveMeeting(meeting.id, projectId);
    actions.toast(
      target
        ? t('已把「{chat}」移到「{project}」', { chat: meeting.title, project: target.name })
        : t('「{chat}」已移出项目', { chat: meeting.title }),
      { label: t('撤销'), run: () => actions.attempt(() => actions.moveMeeting(meeting.id, from)) },
    );
  });
}

/** @param {any} actions @param {any} meeting */
export function renameChat(actions, meeting) {
  actions.openModal(
    t('重命名对话'),
    html`<${FieldForm}
      label=${t('名称')}
      value=${meeting.title}
      submitText=${t('保存')}
      onSubmit=${(title) => actions.updateMeeting(meeting.id, { title })}
    />`,
  );
}

/** @param {any} actions @param {any} project */
function renameProject(actions, project) {
  actions.openModal(
    t('重命名项目'),
    html`<${FieldForm}
      label=${t('名称')}
      value=${project.name}
      submitText=${t('保存')}
      onSubmit=${(name) => actions.updateProject(project.id, { name })}
    />`,
  );
}

/** F2 on a focused row renames it, as the menus promise. */
const onRenameKey = (rename) => (event) => {
  if (event.key !== 'F2' || event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  rename();
};

/**
 * One chat's menu, shared by the sidebar and 全部对话.
 * @param {any} actions @param {any} meeting
 * @param {{ busy: boolean, projects: any[], row: Element }} options
 */
export function chatMenuItems(actions, meeting, { busy, projects, row }) {
  const moveMenu = () => {
    const anchor = { type: 'click', currentTarget: row, preventDefault() {}, stopPropagation() {} };
    actions.openMenu(
      /** @type {any} */ (anchor),
      [
        ...projects
          .filter((project) => project.id !== meeting.projectId)
          .map((project) => ({
            text: project.name,
            icon: 'folder',
            run: () => moveTo(actions, meeting, project.id, projects),
          })),
        ...(meeting.projectId
          ? [
              { sep: true },
              {
                text: t('移出项目，变成独立对话'),
                icon: 'message-square',
                run: () => moveTo(actions, meeting, null, projects),
              },
            ]
          : []),
      ],
      t('移到项目'),
    );
  };
  return [
    {
      text: t('重命名'),
      icon: 'pencil',
      key: 'F2',
      run: () => renameChat(actions, meeting),
    },
    {
      text: meeting.pinned ? t('取消置顶') : t('置顶'),
      icon: 'pin',
      run: () =>
        actions.attempt(() => actions.updateMeeting(meeting.id, { pinned: !meeting.pinned })),
    },
    {
      text: busy ? t('移到项目（运行中不能移动）') : t('移到项目…'),
      icon: 'folder',
      disabled: busy || (!meeting.projectId && !projects.length),
      run: moveMenu,
    },
    { sep: true },
    meeting.archived
      ? {
          text: t('取消归档'),
          icon: 'archive',
          run: () => actions.attempt(() => actions.updateMeeting(meeting.id, { archived: false })),
        }
      : {
          text: busy ? t('归档（运行中不能归档）') : t('归档'),
          icon: 'archive',
          disabled: busy,
          run: () => actions.attempt(() => actions.updateMeeting(meeting.id, { archived: true })),
        },
  ];
}

/**
 * @param {{ meeting: any, active: boolean, variant: 'child' | 'leaf', projects: any[] }} props
 */
function ChatRow({ meeting, active, variant, projects }) {
  const actions = useActions();
  const busy = useBusy(meeting.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const openMenu = (event) => {
    const row = event.currentTarget.closest('.ss-tree-row');
    setMenuOpen(true);
    actions.openMenu(
      event,
      chatMenuItems(actions, meeting, { busy, projects, row }),
      meeting.title,
    );
  };
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = () => setMenuOpen(false);
    addEventListener('pointerdown', close, { once: true });
    return () => removeEventListener('pointerdown', close);
  }, [menuOpen]);
  return html`<div
    class=${`ss-tree-row ss-tree-row--${variant}`}
    aria-selected=${active ? 'true' : undefined}
    data-object="chat"
    data-object-id=${meeting.id}
    data-menu-open=${menuOpen ? '' : undefined}
    draggable=${busy ? 'false' : 'true'}
    onDragStart=${(event) => {
      event.dataTransfer.setData(DRAG_TYPE, meeting.id);
      event.dataTransfer.effectAllowed = 'move';
      event.currentTarget.setAttribute('data-dragging', '');
    }}
    onDragEnd=${(event) => event.currentTarget.removeAttribute('data-dragging')}
    onClick=${() => navigate({ view: 'meeting', id: meeting.id })}
    onContextMenu=${openMenu}
    onKeyDown=${onRenameKey(() => renameChat(actions, meeting))}
  >
    <button
      type="button"
      class="ss-tree-row__label ss-tree-row__open"
      title=${meeting.title}
      onClick=${(event) => {
        event.stopPropagation();
        navigate({ view: 'meeting', id: meeting.id });
      }}
    >
      ${meeting.title}
    </button>
    <span class="ss-tree-row__end"><${RowEnd} meeting=${meeting} /></span>
    <span class="ss-tree-row__actions">
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('对话菜单')}
        data-tip=${t('更多')}
        onClick=${openMenu}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </span>
  </div>`;
}

/**
 * @param {{ project: any, chats: any[], active: boolean, pinnedRow?: boolean,
 *   expanded?: boolean, onToggle?: () => void, projects: any[] }} props
 */
function ProjectRow({ project, chats, active, pinnedRow = false, expanded, onToggle, projects }) {
  const actions = useActions();
  const [drop, setDrop] = useState(false);
  const meetings = useAppState((state) => state.meetings);
  const running = useAppState((state) =>
    chats.some((meeting) => meetingActivity(state, meeting.id)?.status === 'running'),
  );
  const newChat = () => navigate({ view: 'new', id: project.id });
  const openMenu = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('在项目中新对话'), icon: 'square-pen', run: newChat },
        {
          text: t('打开项目文件夹'),
          icon: 'folder-open',
          run: () => actions.attempt(() => actions.fileOp(project.id, { op: 'open', path: '' })),
        },
        {
          text: project.pinned ? t('取消置顶') : t('置顶'),
          icon: 'pin',
          run: () =>
            actions.attempt(() => actions.updateProject(project.id, { pinned: !project.pinned })),
        },
        {
          text: t('重命名'),
          icon: 'pencil',
          key: 'F2',
          run: () => renameProject(actions, project),
        },
        { sep: true },
        {
          text: t('归档项目'),
          icon: 'archive',
          run: () => actions.attempt(() => actions.updateProject(project.id, { archived: true })),
        },
      ],
      project.name,
    );
  const accepts = (event) => event.dataTransfer?.types.includes(DRAG_TYPE);
  return html`<div
    class="ss-tree-row"
    aria-selected=${active ? 'true' : undefined}
    aria-expanded=${pinnedRow ? undefined : String(Boolean(expanded))}
    data-object="project"
    data-object-id=${project.id}
    data-drop=${drop ? '' : undefined}
    onClick=${() => navigate({ view: 'workbench', id: project.id })}
    onContextMenu=${openMenu}
    onKeyDown=${onRenameKey(() => renameProject(actions, project))}
    onDragOver=${(event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      setDrop(true);
    }}
    onDragLeave=${() => setDrop(false)}
    onDrop=${(event) => {
      setDrop(false);
      const id = event.dataTransfer.getData(DRAG_TYPE);
      const meeting = meetings.find((item) => item.id === id);
      if (!meeting || meeting.projectId === project.id) return;
      event.preventDefault();
      void moveTo(actions, meeting, project.id, projects);
    }}
  >
    ${
      pinnedRow
        ? html`<span class="ss-tree-row__twisty" aria-hidden="true"></span>`
        : html`<button
            type="button"
            class="ss-tree-row__twisty"
            aria-label=${(expanded ? t('收起') : t('展开')) + ' ' + project.name}
            onClick=${(event) => {
              event.stopPropagation();
              onToggle?.();
            }}
          >
            <${Lucide} name="chevron-down" />
          </button>`
    }
    <${Lucide} name=${expanded ? 'folder-open' : 'folder'} />
    <button
      type="button"
      class="ss-tree-row__label ss-tree-row__open"
      title=${project.name}
      onClick=${(event) => {
        event.stopPropagation();
        navigate({ view: 'workbench', id: project.id });
      }}
    >
      ${project.name}
    </button>
    <span class="ss-tree-row__end">
      ${
        running &&
        !expanded &&
        html`<span
          class="ss-spin"
          aria-label=${t('里面有对话在运行')}
          data-tip=${t('里面有对话在运行')}
          data-tip-place="right"
        ></span>`
      }
    </span>
    <span class="ss-tree-row__actions">
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('新建项目内聊天')}
        data-tip=${t('在项目中新对话')}
        onClick=${(event) => {
          event.stopPropagation();
          newChat();
        }}
      >
        <${Lucide} name="square-pen" />
      </button>
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('项目菜单')}
        data-tip=${t('更多')}
        onClick=${openMenu}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </span>
  </div>`;
}

/** @param {{ title: string, head?: any, children: any }} props */
function Section({ title, head, children }) {
  return html`<div class="ss-side-section">
    <div class="ss-side-section__head"><span>${title}</span>${head}</div>
    <div class="ss-tree">${children}</div>
  </div>`;
}

/** @param {{ route: import('../route.js').Route, currentProjectId: string | null }} props */
export function Sidebar({ route, currentProjectId }) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const settings = useAppState((state) => state.settings);
  const assistantOpen = useAppState((state) => state.assistantOpen);
  const memoryVersion = useAppState((state) => state.researchVersion);
  const [collapsed, setCollapsed] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [more, setMore] = useState(/** @type {Record<string, boolean>} */ ({}));
  const [peek, setPeek] = useState(false);
  const [inboxCount, setInboxCount] = useState(0);
  const activeProjects = projects.filter((project) => !project.archived);
  const inboxProject = currentProjectId ?? activeProjects[0]?.id ?? null;
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
  const chatsOf = (projectId) => visible.filter((meeting) => meeting.projectId === projectId);
  const pinnedProjects = activeProjects.filter((project) => project.pinned);
  const pinnedMeetings = visible.filter((meeting) => meeting.pinned);
  const standalone = visible.filter((meeting) => !meeting.projectId);
  const activeMeeting = route.view === 'meeting' ? route.id.split('/')[0] : null;
  const isActiveProject = (project) => route.view === 'workbench' && route.id === project.id;
  const userName = settings?.profile?.name || t('用户');
  const peekProject = activeProjects.find(
    (project) => project.id === (currentProjectId ?? activeProjects[0]?.id),
  );
  const stored = settings?.appearance?.panels?.sidebar;
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stored ?? DEFAULT_WIDTH));

  function openWorkbench() {
    const projectId = currentProjectId ?? activeProjects[0]?.id;
    if (projectId) navigate({ view: 'workbench', id: projectId });
    else actions.toast(t('先新建一个项目，工作站按项目整理计划、日志与导图。'));
  }

  const chatRow = (meeting, variant) =>
    html`<${ChatRow}
      key=${meeting.id}
      meeting=${meeting}
      variant=${variant}
      active=${meeting.id === activeMeeting}
      projects=${activeProjects}
    />`;

  return html`<aside class="ss-sidebar" style=${{ width: `${width}px` }}>
    <div class="ss-sidebar__top">
      <button
        type="button"
        class="ss-nav-item"
        aria-current=${route.view === 'home' || route.view === 'new' ? 'page' : undefined}
        data-tip=${t('新对话')}
        data-kbd=${settings?.shortcuts?.newChat}
        data-tip-place="right"
        onClick=${actions.newIndependent}
      >
        <${Lucide} name="square-pen" /><span class="ss-nav-item__label">${t('新对话')}</span>
      </button>
      <button
        type="button"
        class="ss-nav-item"
        data-route="database"
        aria-current=${['database', 'library', 'sources'].includes(route.view) ? 'page' : undefined}
        data-tip=${inboxCount > 0 ? t('收件箱里有 {n} 条记忆等你确认', { n: inboxCount }) : undefined}
        data-tip-place="right"
        onClick=${() =>
          navigate(knowledgeRoute(settings?.appearance?.knowledgeScope, inboxProject))}
      >
        <${Lucide} name="book-open" /><span class="ss-nav-item__label">${t('知识库')}</span>
        ${inboxCount > 0 && html`<span class="ss-nav-item__end" data-rb-inbox-count>${inboxCount}</span>`}
      </button>
      <div class="ss-nav-row">
        <button
          type="button"
          class="ss-nav-item"
          aria-current=${route.view === 'workbench' ? 'page' : undefined}
          onClick=${openWorkbench}
        >
          <${Lucide} name="box" /><span class="ss-nav-item__label">${t('工作站')}</span>
        </button>
        ${
          peekProject &&
          html`<button
            type="button"
            class="ss-icon-btn"
            aria-label=${t('工作站简略信息')}
            data-tip=${t('工作站简报：最近历史版本、日志')}
            aria-expanded=${String(peek)}
            data-summary-trigger
            onClick=${() => setPeek(!peek)}
          >
            <${Lucide} name="clipboard-list" />
          </button>`
        }
      </div>
      ${
        peek &&
        peekProject &&
        html`<${ProjectSummary} project=${peekProject} onClose=${() => setPeek(false)} />`
      }
      ${
        deskEnabled(settings) &&
        html`<button
          type="button"
          class="ss-nav-item"
          data-tip=${t('在独立窗口打开编辑台')}
          data-tip-place="right"
          onClick=${() =>
            actions.attempt(() =>
              openDesk({ projectId: currentProjectId ?? activeProjects[0]?.id ?? null }),
            )}
        >
          <${Lucide} name="file-pen" /><span class="ss-nav-item__label">${t('编辑台')}</span
          ><span class="ss-nav-item__end"><${Lucide} name="app-window" small /></span>
        </button>`
      }
      <button type="button" class="ss-search-trigger" onClick=${actions.openPalette}>
        <${Lucide} name="search" /><span class="ss-search-trigger__label">${t('搜索与命令')}</span
        ><span class="ss-kbd">${settings?.shortcuts?.search ?? 'Ctrl+K'}</span>
      </button>
    </div>

    <div class="ss-sidebar__scroll">
      ${
        pinnedMeetings.length + pinnedProjects.length > 0 &&
        html`<${Section} title=${t('置顶')}>
          ${pinnedMeetings.map((meeting) => chatRow(meeting, 'leaf'))}
          ${pinnedProjects.map(
            (project) =>
              html`<${ProjectRow}
                key=${project.id}
                project=${project}
                chats=${chatsOf(project.id)}
                pinnedRow
                active=${isActiveProject(project)}
                projects=${activeProjects}
              />`,
          )}
        </${Section}>`
      }
      <${Section}
        title=${t('项目')}
        head=${html`<button
          type="button"
          class="ss-icon-btn ss-icon-btn--sm"
          aria-label=${t('新建项目')}
          data-tip=${t('新建项目')}
          onClick=${() => navigate({ view: 'project-new' })}
        >
          <${Lucide} name="plus" />
        </button>`}
      >
        ${activeProjects.map((project) => {
          const expanded = !collapsed[project.id];
          const chats = chatsOf(project.id);
          const open = more[project.id] || chats.length <= SHOWN;
          const shown = open
            ? chats
            : chats.filter((meeting, index) => index < SHOWN || meeting.id === activeMeeting);
          return html`<${ProjectRow}
              key=${project.id}
              project=${project}
              chats=${chats}
              expanded=${expanded}
              active=${isActiveProject(project)}
              onToggle=${() => setCollapsed({ ...collapsed, [project.id]: expanded })}
              projects=${activeProjects}
            />
            ${
              expanded &&
              html`<div class="ss-tree" key=${`${project.id}-chats`}>
                ${shown.map((meeting) => chatRow(meeting, 'child'))}
                ${
                  chats.length > SHOWN &&
                  html`<button
                    type="button"
                    class="ss-tree-more"
                    onClick=${() => setMore({ ...more, [project.id]: !open })}
                  >
                    ${open ? t('收起') : t('还有 {n} 个', { n: chats.length - shown.length })}
                  </button>`
                }
              </div>`
            }`;
        })}
      </${Section}>
      ${
        standalone.length > 0 &&
        html`<${Section} title=${t('独立对话')}>
          ${standalone.map((meeting) => chatRow(meeting, 'leaf'))}
        </${Section}>`
      }
      <button type="button" class="ss-side-all" onClick=${() => navigate({ view: 'all' })}>
        <${Lucide} name="layout-list" /><span>${t('全部对话')}</span
        ><span class="ss-kbd">${settings?.shortcuts?.browse ?? 'Ctrl+Shift+K'}</span>
      </button>
    </div>

    <div class="ss-sidebar__foot">
      <button
        type="button"
        class="ss-user"
        data-tip=${t('编辑个人资料')}
        onClick=${() => actions.openModal(t('个人资料'), html`<${ProfileForm} />`)}
      >
        <span class="ss-avatar ss-avatar--lg ss-avatar--user"
          >${userName.slice(0, 1).toUpperCase()}</span
        ><span class="ss-truncate">${userName}</span>
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('全局助手')}
        data-tip=${t('全局助手')}
        aria-expanded=${String(Boolean(assistantOpen))}
        onClick=${() => actions.showAssistant(!assistantOpen)}
      >
        <${Lucide} name="sparkle" />
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('设置')}
        data-tip=${t('设置')}
        onClick=${() => navigate({ view: 'settings', id: 'general' })}
      >
        <${Lucide} name="settings" />
      </button>
    </div>
    <${Splitter}
      side="end"
      width=${width}
      min=${MIN_WIDTH}
      max=${MAX_WIDTH}
      defaultWidth=${DEFAULT_WIDTH}
      onCommit=${(next) =>
        actions.attempt(() =>
          actions.updateSettings({ appearance: { panels: { sidebar: next } } }),
        )}
    />
  </aside>`;
}
