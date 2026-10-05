// The welcome page in the old interface's markup: a new meeting that is not
// started yet. The first message creates the meeting (inside the project when
// opened from one) and opens it.
import { useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';
import { Composer } from './composer.js';
import { MainHead } from './mainhead.js';

/** "09-17 10:42" @param {string} iso */
function shortStamp(iso) {
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function SiteForm() {
  const actions = useActions();
  const sites = useAppState((state) => state.settings?.sites ?? []);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  async function submit(event) {
    event.preventDefault();
    actions.closeModal();
    await actions.attempt(() =>
      actions.updateSettings({ sites: [...sites, { name: name.trim(), url: url.trim() }] }),
    );
  }
  return html`<form onSubmit=${submit}>
    <div class="field">
      <label class="label">${t('名称')}</label>
      <input autofocus value=${name} onInput=${(event) => setName(event.currentTarget.value)} />
    </div>
    <div class="field">
      <label class="label">${t('网址')}</label>
      <input value=${url} onInput=${(event) => setUrl(event.currentTarget.value)} />
    </div>
    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn" onClick=${actions.closeModal}>${t('取消')}</button>
      <button type="submit" class="btn primary" disabled=${!name.trim() || !url.trim()}>
        ${t('添加')}
      </button>
    </div>
  </form>`;
}

function Sites() {
  const actions = useActions();
  const sites = useAppState((state) => state.settings?.sites ?? []);
  const remove = (site) =>
    actions.attempt(() =>
      actions.updateSettings({ sites: sites.filter((candidate) => candidate !== site) }),
    );
  return html`<div>
    <div class="between"><small>${t('常用学术站点')}</small></div>
    <div class="sites">
      ${sites.map(
        (site) =>
          html`<button
            key=${site.name}
            class="site"
            title=${site.url}
            onClick=${() => open(site.url, '_blank', 'noopener')}
            onContextMenu=${(event) =>
              actions.openMenu(
                event,
                [{ text: t('移除站点'), icon: 'trash', danger: true, run: () => remove(site) }],
                site.name,
              )}
          >
            ${site.name}
          </button>`,
      )}
      <button
        class="iconbtn"
        title=${t('新增站点')}
        aria-label=${t('新增站点')}
        onClick=${() => actions.openModal(t('新增站点'), html`<${SiteForm} />`)}
      >
        <${Icon} name="plus" />
      </button>
    </div>
  </div>`;
}

/** @param {{ projectId?: string | null }} props */
export function Welcome({ projectId = null }) {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const projects = useAppState((state) => state.projects);
  const userName = useAppState((state) => state.settings?.profile?.name) || t('用户');
  const project = projects.find((candidate) => candidate.id === projectId);
  const projectName = (id) => projects.find((candidate) => candidate.id === id)?.name;
  const recent = meetings
    .filter((meeting) => !meeting.archived && !meeting.attachedToMeetingId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  return html`<main class="main">
    <${MainHead} crumb=${project?.name ?? t('独立对话')} title=${t('新对话')} />
    <div class="mainbody">
      <div class="chatlayout">
        <div class="chatcol new-chat-home">
          <div class="home">
            <div class="homehero">
              <img src="/assets/logo.png" alt="" />
              <h1>${t('今天想研究什么？')}</h1>
              <p class="profile-greeting">
                ${t('{name}，从一个问题开始，和你的研究小组一起推进。', { name: userName })}
              </p>
            </div>
            <div class="card recent">
              <div class="between tight">
                <h3 style="margin:0">${t('最近工作')}</h3>
                <button class="linklike" onClick=${() => navigate({ view: 'all' })}>
                  ${t('浏览全部')} ›
                </button>
              </div>
              ${
                recent.length
                  ? recent.map(
                      (meeting) =>
                        html`<button
                          key=${meeting.id}
                          class="listrow"
                          style="width:100%;text-align:left"
                          onClick=${() => navigate({ view: 'meeting', id: meeting.id })}
                        >
                          <${Icon} name="chat" />
                          <span class="grow ellipsis">
                            ${projectName(meeting.projectId) ?? t('独立对话')}
                            <span class="muted"> / </span>${meeting.title}
                          </span>
                          <small>${shortStamp(meeting.updatedAt)}</small>
                        </button>`,
                    )
                  : html`<div class="inline-empty">
                      ${t('还没有最近工作，发送第一条消息开始。')}
                    </div>`
              }
            </div>
            <${Sites} />
            <div class="spacer"></div>
            <${Composer}
              key=${projectId ?? 'standalone'}
              onSend=${(text) => actions.startMeeting(text, projectId)}
            />
          </div>
        </div>
      </div>
    </div>
  </main>`;
}
