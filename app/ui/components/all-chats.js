// 全部对话: every chat, archived ones included, as a two-line list grouped by
// 今天 / 本周 / 更早. Tabs filter pinned and archived chats; the toolbar
// searches, filters by project and sorts. Rows share the sidebar's chat menu.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Illustration } from '../illustrations.js';
import { navigate } from '../route.js';
import { ChatRow, stamp } from './chat-row.js';
import { ChoiceMenu } from './popover.js';

const TABS = [
  ['all', '全部'],
  ['pinned', '置顶'],
  ['archived', '已归档'],
];
const SORTS = [
  ['recent', '最近活动'],
  ['created', '创建时间'],
  ['name', '名称'],
];
// A group longer than this shows its first few rows and 再显示 N 个.
const LONG = 5;
const FIRST = 3;

/** 今天, 本周 (the last seven days) or 更早. @param {string} iso */
function period(iso) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = new Date(iso).getTime();
  if (at >= today) return '今天';
  if (at >= today - 6 * 86400000) return '本周';
  return '更早';
}

/** @param {{ title: string, rows: any[], render: (meeting: any) => any }} props */
function Group({ title, rows, render }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const shown = all || rows.length <= LONG ? rows : rows.slice(0, FIRST);
  return html`<button
      type="button"
      class="ss-list__group"
      aria-expanded=${String(open)}
      onClick=${() => setOpen(!open)}
    >
      <${Lucide} name="chevron-down" />${t(title)}<span class="ss-count">${rows.length}</span>
    </button>
    ${
      open &&
      html`<div class="ss-list">
        ${shown.map(render)}
        ${
          shown.length < rows.length &&
          html`<button
            type="button"
            class="ss-tree-more ss-all-chats__more"
            onClick=${() => setAll(true)}
          >
            ${t('再显示 {n} 个', { n: rows.length - shown.length })}
          </button>`
        }
      </div>`
    }`;
}

export function AllChats() {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const participants = useAppState((state) => state.participants);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all');
  const [projectId, setProjectId] = useState(/** @type {string | null | undefined} */ (undefined));
  const [sort, setSort] = useState('recent');
  // Archived chats are not loaded with the rest; fetch them once for the count.
  useEffect(() => void actions.attempt(actions.loadArchived), []);

  const projectName = (id) => projects.find((project) => project.id === id)?.name ?? t('独立对话');
  const chats = meetings.filter(
    (meeting) =>
      !meeting.temporary &&
      !meeting.attachedToMeetingId &&
      meeting.policy?.respondent !== 'agent_assistant',
  );
  const counts = {
    all: chats.filter((meeting) => !meeting.archived).length,
    pinned: chats.filter((meeting) => !meeting.archived && meeting.pinned).length,
    archived: chats.filter((meeting) => meeting.archived).length,
  };
  const lower = query.trim().toLowerCase();
  const time = (meeting) => (sort === 'created' ? meeting.createdAt : meeting.updatedAt);
  const rows = chats
    .filter((meeting) => (tab === 'archived') === meeting.archived)
    .filter((meeting) => tab !== 'pinned' || meeting.pinned)
    .filter((meeting) => projectId === undefined || meeting.projectId === projectId)
    .filter(
      (meeting) =>
        !lower ||
        `${meeting.title} ${projectName(meeting.projectId)}`.toLowerCase().includes(lower),
    )
    .sort((a, b) =>
      sort === 'name' ? a.title.localeCompare(b.title, 'zh') : time(b).localeCompare(time(a)),
    );
  const branches = rows.filter((meeting) => meeting.parentMeetingId).length;
  const titleOf = (id) => meetings.find((meeting) => meeting.id === id)?.title;
  const experts = (meeting) =>
    (meeting.members ?? [])
      .map((member) => participants.find((person) => person.id === member.participantId))
      .filter((person) => person && !person.id.startsWith('person_'))
      .map((person) => person.name);

  const render = (meeting) => {
    const names = experts(meeting);
    const parent = meeting.parentMeetingId && titleOf(meeting.parentMeetingId);
    const sub = [
      projectName(meeting.projectId),
      meeting.parentMeetingId
        ? parent
          ? t('分支自「{name}」', { name: parent })
          : t('分支对话')
        : names.join(t('、')),
    ]
      .filter(Boolean)
      .join(' · ');
    return html`<${ChatRow}
      key=${meeting.id}
      meeting=${meeting}
      projects=${projects}
      sub=${sub}
      icon=${meeting.parentMeetingId ? 'git-branch' : names.length > 1 ? 'users' : 'message-square'}
      time=${sort === 'created' ? stamp(meeting.createdAt) : undefined}
    >
      ${
        meeting.archived &&
        html`<button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${(event) => {
            event.stopPropagation();
            actions.attempt(() => actions.updateMeeting(meeting.id, { archived: false }));
          }}
        >
          ${t('取消归档')}
        </button>`
      }
    <//>`;
  };
  /** @type {[string, any[]][]} */
  const groups =
    sort === 'name'
      ? [['', rows]]
      : ['今天', '本周', '更早']
          .map(
            (name) =>
              /** @type {[string, any[]]} */ ([
                name,
                rows.filter((meeting) => period(time(meeting)) === name),
              ]),
          )
          .filter(([, entries]) => entries.length);

  return html`<main class="ss-main">
    <div class="ss-header">
      <div class="ss-header__title"><span>${t('全部对话')}</span></div>
      <span class="ss-header__sep"></span>
      <nav class="ss-tabs" role="tablist" aria-label=${t('筛选')}>
        ${TABS.map(
          ([value, label]) =>
            html`<button
              key=${value}
              type="button"
              class="ss-tab"
              role="tab"
              aria-selected=${String(tab === value)}
              onClick=${() => setTab(value)}
            >
              ${t(label)}<span class="ss-tab__count">${counts[value]}</span>
            </button>`,
        )}
      </nav>
      <div class="ss-header__actions">
        <button type="button" class="ss-btn" onClick=${() => navigate({ view: 'home' })}>
          <${Lucide} name="square-pen" />${t('新对话')}
        </button>
      </div>
    </div>
    <div class="ss-toolbar">
      <span class="ss-input">
        <${Lucide} name="search" />
        <input
          placeholder=${t('搜索对话名称或项目…')}
          aria-label=${t('搜索全部对话')}
          value=${query}
          onInput=${(event) => setQuery(event.currentTarget.value)}
        />
      </span>
      <${ChoiceMenu}
        label=${t('项目')}
        triggerClass="ss-select ss-select--ghost"
        placement="bottom-start"
        items=${[
          {
            text: t('所有项目'),
            selected: projectId === undefined,
            run: () => setProjectId(undefined),
          },
          { sep: true },
          ...projects.map((project) => ({
            text: project.name,
            selected: projectId === project.id,
            run: () => setProjectId(project.id),
          })),
          { text: t('独立对话'), selected: projectId === null, run: () => setProjectId(null) },
        ]}
      >
        <${Lucide} name="folder" />
        <span class="ss-select__value ss-truncate"
          >${projectId === undefined ? t('所有项目') : projectName(projectId)}</span
        >
      <//>
      <${ChoiceMenu}
        label=${t('排序')}
        triggerClass="ss-select ss-select--ghost"
        placement="bottom-start"
        items=${SORTS.map(([value, label]) => ({
          text: t(label),
          selected: sort === value,
          run: () => setSort(value),
        }))}
      >
        <${Lucide} name="arrow-down-up" />
        <span class="ss-select__value">${t(SORTS.find(([value]) => value === sort)[1])}</span>
      <//>
      <span class="ss-toolbar__spacer"></span>
      <span class="ss-muted ss-all-chats__total">
        ${
          branches
            ? t('{n} 个对话，含 {m} 个分支对话', { n: rows.length, m: branches })
            : t('{n} 个对话', { n: rows.length })
        }
      </span>
    </div>
    <div class="ss-content">
      <div class="ss-all-chats">
        ${
          rows.length
            ? groups.map(([name, entries]) =>
                name
                  ? html`<${Group} key=${name} title=${name} rows=${entries} render=${render} />`
                  : html`<div class="ss-list" key="all">${entries.map(render)}</div>`,
              )
            : html`<div class="ss-empty">
                ${
                  lower || projectId !== undefined
                    ? html`<div class="ss-empty__icon"><${Lucide} name="message-square" /></div>`
                    : html`<${Illustration} name="chat" />`
                }
                <div class="ss-empty__title">
                  ${lower || projectId !== undefined ? t('没有匹配的对话') : t('这里还没有对话')}
                </div>
              </div>`
        }
      </div>
    </div>
  </main>`;
}
