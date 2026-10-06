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

/** Add a site, or edit `site`. @param {{ site?: { name: string, url: string } }} props */
function SiteForm({ site }) {
  const actions = useActions();
  const sites = useAppState((state) => state.settings?.sites ?? []);
  const [name, setName] = useState(site?.name ?? '');
  const [url, setUrl] = useState(site?.url ?? 'https://');
  async function submit(event) {
    event.preventDefault();
    actions.closeModal();
    const entry = { name: name.trim(), url: url.trim() };
    const next = site
      ? sites.map((candidate) => (candidate === site ? entry : candidate))
      : [...sites, entry];
    await actions.attempt(() => actions.updateSettings({ sites: next }));
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
        ${site ? t('保存') : t('添加')}
      </button>
    </div>
  </form>`;
}

function Sites() {
  const actions = useActions();
  const sites = useAppState((state) => state.settings?.sites ?? []);
  const store = (next) => actions.attempt(() => actions.updateSettings({ sites: next }));
  const moveSite = (index, step) => {
    const next = sites.slice();
    [next[index], next[index + step]] = [next[index + step], next[index]];
    store(next);
  };
  const addSite = () => actions.openModal(t('新增站点'), html`<${SiteForm} />`);
  const openSite = (url) =>
    globalThis.__TAURI__?.core?.invoke
      ? actions.attempt(() => globalThis.__TAURI__.core.invoke('plugin:opener|open_url', { url }))
      : open(url, '_blank', 'noopener');
  const siteMenu = (event, site, index) =>
    actions.openMenu(
      event,
      [
        { text: t('打开站点'), icon: 'browser', run: () => openSite(site.url) },
        {
          text: t('编辑站点'),
          icon: 'edit',
          run: () => actions.openModal(t('编辑站点'), html`<${SiteForm} site=${site} />`),
        },
        ...(index > 0 ? [{ text: t('上移'), icon: 'up', run: () => moveSite(index, -1) }] : []),
        ...(index < sites.length - 1
          ? [{ text: t('下移'), icon: 'down', run: () => moveSite(index, 1) }]
          : []),
        { sep: true },
        {
          text: t('移除站点'),
          icon: 'trash',
          danger: true,
          run: () => store(sites.filter((candidate) => candidate !== site)),
        },
      ],
      site.name,
    );
  return html`<div>
    <div class="between">
      <small>${t('常用学术站点')}</small>
      <button
        class="iconbtn"
        title=${t('站点菜单')}
        aria-label=${t('站点菜单')}
        onClick=${(event) =>
          actions.openMenu(
            event,
            [
              { text: t('添加站点'), icon: 'plus', run: addSite },
              ...sites.map((site, index) => ({
                text: site.name,
                icon: 'edit',
                run: () =>
                  actions.openModal(t('编辑站点'), html`<${SiteForm} site=${sites[index]} />`),
              })),
            ],
            t('管理站点'),
          )}
      >
        <${Icon} name="more" />
      </button>
    </div>
    <div class="sites">
      ${sites.map(
        (site, index) =>
          html`<button
            key=${site.name}
            class="site"
            title=${site.url}
            onClick=${() => openSite(site.url)}
            onContextMenu=${(event) => siteMenu(event, site, index)}
          >
            ${site.name}
          </button>`,
      )}
      <button class="iconbtn" title=${t('新增站点')} aria-label=${t('新增站点')} onClick=${addSite}>
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
