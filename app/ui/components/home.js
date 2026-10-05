// Home: start a meeting with a first question, or return to recent work.
import { useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { formatTime, t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { routeHref } from '../route.js';

export function Home() {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const projects = useAppState((state) => state.projects);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const recent = meetings
    .filter((meeting) => !meeting.archived && !meeting.attachedToMeetingId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);
  const projectName = (id) => projects.find((project) => project.id === id)?.name;

  async function start() {
    const value = text.trim();
    if (!value) return;
    try {
      await actions.startMeeting(value);
    } catch (failure) {
      setError(failure.message);
    }
  }

  return html`<section class="main">
    <div class="mainbody">
      <div class="home">
        <div class="homehero">
          <img src="/assets/logo.png" alt="" />
          <h1>${t('今天想研究什么？')}</h1>
        </div>
        <div class="composer">
          <textarea
            value=${text}
            placeholder=${t('输入问题，开始一场新会议…')}
            onInput=${(event) => setText(event.currentTarget.value)}
            onKeyDown=${(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault();
                start();
              }
            }}
          ></textarea>
          <div class="composerbar">
            ${error && html`<span class="error">${error}</span>`}
            <span class="spacer"></span>
            <button
              class="sendbtn"
              aria-label=${t('发送')}
              disabled=${!text.trim()}
              onClick=${start}
            >
              <${Icon} name="send" />
            </button>
          </div>
        </div>
        ${
          recent.length > 0 &&
          html`<div class="recent">
            <h3>${t('最近的会议')}</h3>
            ${recent.map(
              (meeting) =>
                html`<a class="listrow" href=${routeHref({ view: 'meeting', id: meeting.id })}>
                  <${Icon} name="chat" />
                  <span class="grow ellipsis">${meeting.title}</span>
                  <small>${projectName(meeting.projectId) ?? t('独立会议')}</small>
                  <small>${formatTime(meeting.updatedAt)}</small>
                </a>`,
            )}
          </div>`
        }
      </div>
    </div>
  </section>`;
}
