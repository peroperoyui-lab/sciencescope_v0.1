// "Browse all" (全部对话) in the old interface's markup: every meeting in a
// table with a filter for name and project, pinned and archived meetings.
import { useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { MainHead } from './mainhead.js';

const FILTERS = [
  ['all', '全部'],
  ['pinned', '置顶'],
  ['archived', '已归档'],
];

export function AllChats() {
  const actions = useActions();
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  function choose(next) {
    setFilter(next);
    if (next === 'archived') actions.attempt(actions.loadArchived);
  }

  const projectName = (id) => projects.find((project) => project.id === id)?.name ?? t('独立对话');
  const lower = query.trim().toLowerCase();
  const rows = meetings
    .filter((meeting) => !meeting.attachedToMeetingId)
    .filter((meeting) => (filter === 'archived') === meeting.archived)
    .filter((meeting) => filter !== 'pinned' || meeting.pinned)
    .filter(
      (meeting) =>
        !lower ||
        `${meeting.title} ${projectName(meeting.projectId)}`.toLowerCase().includes(lower),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return html`<main class="main">
    <${MainHead} crumb="ScienceScope" section=${t('浏览全部')} title=${t('全部对话')} />
    <div class="mainbody">
      <div class="content">
        <div class="pageintro between">
          <div>
            <h1>${t('全部对话')}</h1>
            <p></p>
          </div>
          <div class="row">
            <button class="btn" onClick=${() => navigate({ view: 'home' })}>
              + ${t('新聊天')}
            </button>
          </div>
        </div>
        <div class="allchat-filters">
          <input
            placeholder=${t('搜索对话名称或项目…')}
            aria-label=${t('搜索全部对话')}
            value=${query}
            onInput=${(event) => setQuery(event.currentTarget.value)}
          />
          ${FILTERS.map(
            ([value, label]) =>
              html`<button
                key=${value}
                class=${`allchat-filter ${filter === value ? 'active' : ''}`}
                onClick=${() => choose(value)}
              >
                ${t(label)}
              </button>`,
          )}
          <span class="spacer"></span>
          <small>${t('{n} 个对话', { n: rows.length })}</small>
        </div>
        <table class="chat-table">
          <thead>
            <tr>
              <th>${t('对话')}</th>
              <th>${t('项目')}</th>
              <th class="hide-small">${t('最近活动')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(
              (meeting) =>
                html`<tr
                  key=${meeting.id}
                  onClick=${() => navigate({ view: 'meeting', id: meeting.id })}
                >
                  <td>
                    <div class="table-title">
                      <${Icon} name="chat" /><strong style="font-weight:500"
                        >${meeting.title}</strong
                      >
                    </div>
                    ${meeting.parentMeetingId && html`<small>${t('分支对话')}</small>`}
                  </td>
                  <td>${projectName(meeting.projectId)}</td>
                  <td class="hide-small">${meeting.updatedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    ${
                      meeting.archived &&
                      html`<button
                        class="btn tiny"
                        onClick=${(event) => {
                          event.stopPropagation();
                          actions.attempt(() =>
                            actions.updateMeeting(meeting.id, { archived: false }),
                          );
                        }}
                      >
                        ${t('取消归档')}
                      </button>`
                    }
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
        ${!rows.length && html`<div class="empty">${t('没有匹配的对话')}</div>`}
      </div>
    </div>
  </main>`;
}
