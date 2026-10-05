// Left sidebar: new meeting, workbench, pinned meetings, projects with their
// meetings, meetings outside any project, and the user bar.
import { useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate, routeHref } from '../route.js';
import { Avatar, InlineInput, RowMenu } from './common.js';

const byRecent = (a, b) => b.updatedAt.localeCompare(a.updatedAt);
/** Meetings shown in the lists: not archived, not attached to another meeting. */
const listed = (meeting) => !meeting.archived && !meeting.attachedToMeetingId;

/** @param {{ meeting: any, active: boolean, nested?: boolean }} props */
function MeetingRow({ meeting, active, nested = false }) {
  const actions = useActions();
  const [renaming, setRenaming] = useState(false);
  const running = useAppState((state) =>
    Object.values(state.running).some((turn) => turn.meetingId === meeting.id),
  );
  if (renaming) {
    return html`<div class=${`chatnav ${nested ? 'nested' : ''}`}>
      <${InlineInput}
        value=${meeting.title}
        placeholder=${t('会议名称')}
        onCommit=${(title) => {
          setRenaming(false);
          actions.updateMeeting(meeting.id, { title });
        }}
        onCancel=${() => setRenaming(false)}
      />
    </div>`;
  }
  return html`<a
    class=${`chatnav ${nested ? 'nested' : ''} ${active ? 'active' : ''}`}
    href=${routeHref({ view: 'meeting', id: meeting.id })}
  >
    <${Icon} name="chat" />
    <span class="grow ellipsis">${meeting.title}</span>
    ${running && html`<span class="badge-dot" title=${t('正在回答')}></span>`}
    <${RowMenu}
      label=${t('会议操作')}
      items=${[
        {
          label: meeting.pinned ? t('取消置顶') : t('置顶此会议'),
          run: () => actions.updateMeeting(meeting.id, { pinned: !meeting.pinned }),
        },
        { label: t('重命名'), run: () => setRenaming(true) },
        { label: t('归档'), run: () => actions.updateMeeting(meeting.id, { archived: true }) },
      ]}
    />
  </a>`;
}

/** @param {{ project: any, meetings: any[], route: any }} props */
function ProjectGroup({ project, meetings, route }) {
  const actions = useActions();
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  return html`<div class="navgroup">
    <div class="navproject">
      <button
        class="iconbtn small"
        aria-label=${open ? t('收起') : t('展开')}
        onClick=${() => setOpen(!open)}
      >
        <${Icon} name=${open ? 'chevronDown' : 'chevronRight'} />
      </button>
      <${Icon} name="folder" />
      ${
        renaming
          ? html`<${InlineInput}
              value=${project.name}
              placeholder=${t('项目名称')}
              onCommit=${(name) => {
                setRenaming(false);
                actions.updateProject(project.id, { name });
              }}
              onCancel=${() => setRenaming(false)}
            />`
          : html`<span class="grow ellipsis">${project.name}</span>`
      }
      <${RowMenu}
        label=${t('项目操作')}
        items=${[
          { label: t('新会议'), run: () => actions.createMeeting({ projectId: project.id }) },
          { label: t('工作站'), run: () => navigate({ view: 'workbench', id: project.id }) },
          { label: t('重命名'), run: () => setRenaming(true) },
        ]}
      />
    </div>
    ${
      open &&
      meetings.map(
        (meeting) =>
          html`<${MeetingRow}
            key=${meeting.id}
            meeting=${meeting}
            nested
            active=${route.view === 'meeting' && route.id === meeting.id}
          />`,
      )
    }
  </div>`;
}

/** @param {{ route: import('../route.js').Route }} props */
export function Sidebar({ route }) {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const settings = useAppState((state) => state.settings);
  const [creatingProject, setCreatingProject] = useState(false);

  const visible = meetings.filter(listed).sort(byRecent);
  const pinned = visible.filter((meeting) => meeting.pinned);
  const standalone = visible.filter((meeting) => !meeting.projectId);
  const activeProjects = projects.filter((project) => !project.archived);
  const workbenchProject =
    route.view === 'workbench'
      ? route.id
      : (meetings.find((m) => route.view === 'meeting' && m.id === route.id)?.projectId ??
        activeProjects[0]?.id);
  const isActive = (meeting) => route.view === 'meeting' && route.id === meeting.id;

  return html`<aside class="sidebar">
    <button class="nav" onClick=${() => actions.createMeeting()}>
      <${Icon} name="chat" />${t('新会议')}
    </button>
    ${
      workbenchProject &&
      html`<a
        class=${`nav ${route.view === 'workbench' ? 'active' : ''}`}
        href=${routeHref({ view: 'workbench', id: workbenchProject })}
      >
        <${Icon} name="box" />${t('工作站')}
      </a>`
    }

    <div class="navscroll">
      ${
        pinned.length > 0 &&
        html`<div class="navsection">${t('置顶')}</div>
          ${pinned.map(
            (meeting) =>
              html`<${MeetingRow}
                key=${meeting.id}
                meeting=${meeting}
                active=${isActive(meeting)}
              />`,
          )}`
      }

      <div class="navsection">
        <span>${t('项目')}</span>
        <button
          class="iconbtn small"
          aria-label=${t('新建项目')}
          onClick=${() => setCreatingProject(true)}
        >
          <${Icon} name="plus" />
        </button>
      </div>
      ${
        creatingProject &&
        html`<div class="navproject">
          <${InlineInput}
            placeholder=${t('项目名称')}
            onCommit=${async (name) => {
              setCreatingProject(false);
              const project = await actions.createProject(name);
              navigate({ view: 'workbench', id: project.id });
            }}
            onCancel=${() => setCreatingProject(false)}
          />
        </div>`
      }
      ${activeProjects.map(
        (project) =>
          html`<${ProjectGroup}
            key=${project.id}
            project=${project}
            route=${route}
            meetings=${visible.filter((meeting) => meeting.projectId === project.id)}
          />`,
      )}
      ${
        activeProjects.length === 0 &&
        !creatingProject &&
        html`<div class="navempty">${t('还没有项目')}</div>`
      }
      ${
        standalone.length > 0 &&
        html`<div class="navsection">${t('独立会议')}</div>
          ${standalone.map(
            (meeting) =>
              html`<${MeetingRow}
                key=${meeting.id}
                meeting=${meeting}
                active=${isActive(meeting)}
              />`,
          )}`
      }
    </div>

    <div class="userbar">
      <${Avatar} name=${settings?.profile?.name || t('我')} />
      <span class="grow ellipsis">${settings?.profile?.name || t('我')}</span>
    </div>
  </aside>`;
}
