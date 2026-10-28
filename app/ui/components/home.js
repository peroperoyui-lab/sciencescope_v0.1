// The home page, which is also 新对话: a new chat that is not started yet. The
// header picks the project it goes into; the first message creates it there and
// opens it. Recent work and the user's academic sites sit above the composer.
import { useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { Composer } from './composer.js';
import { Dialog } from './dialog.js';
import { Illustration } from '../illustrations.js';
import { ChoiceMenu } from './popover.js';
import { ChatRow } from './chat-row.js';
import { listed } from './sidebar.js';

/** @param {{name:string,url:string}} left @param {{name:string,url:string}} right */
const sameSite = (left, right) => left.name === right.name && left.url === right.url;

/** Add a site, or edit `site`. @param {{ site?: { name: string, url: string } | null, onClose: () => void }} props */
function SiteDialog({ site, onClose }) {
  const actions = useActions();
  const sites = useAppState((state) => state.settings?.sites ?? []);
  const [name, setName] = useState(site?.name ?? '');
  const [url, setUrl] = useState(site?.url ?? 'https://');
  const submit = () => {
    if (!name.trim() || !url.trim()) return;
    onClose();
    const entry = { name: name.trim(), url: url.trim() };
    // Settings refreshes replace the site objects; match the edited one by value.
    const at = site ? sites.findIndex((candidate) => sameSite(candidate, site)) : -1;
    const next = site
      ? sites.map((candidate, index) => (index === at ? entry : candidate))
      : [...sites, entry];
    void actions.attempt(() => actions.updateSettings({ sites: next }));
  };
  return html`<${Dialog}
    title=${site ? t('编辑站点') : t('添加站点')}
    size="sm"
    onClose=${onClose}
    onSubmit=${submit}
    foot=${html`<button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!name.trim() || !url.trim()}>
        ${site ? t('保存') : t('添加')}
      </button>`}
  >
    <label class="ss-field">
      <span class="ss-field__label">${t('名称')}</span>
      <span class="ss-input">
        <input value=${name} onInput=${(event) => setName(event.currentTarget.value)} />
      </span>
    </label>
    <label class="ss-field">
      <span class="ss-field__label">${t('网址')}</span>
      <span class="ss-input">
        <input type="url" value=${url} onInput=${(event) => setUrl(event.currentTarget.value)} />
      </span>
    </label>
  <//>`;
}

/** 常用学术站点: one button per site, opened in the system browser. */
export function Sites() {
  const actions = useActions();
  const sites = useAppState((state) => state.settings?.sites ?? []);
  const [editing, setEditing] = useState(/** @type {{ site: any } | null} */ (null));
  const store = (next) => actions.attempt(() => actions.updateSettings({ sites: next }));
  const moveSite = (index, step) => {
    const next = sites.slice();
    [next[index], next[index + step]] = [next[index + step], next[index]];
    store(next);
  };
  const addSite = () => setEditing({ site: null });
  const openSite = (url) =>
    globalThis.__TAURI__?.core?.invoke
      ? actions.attempt(() => globalThis.__TAURI__.core.invoke('plugin:opener|open_url', { url }))
      : open(url, '_blank', 'noopener');
  const siteMenu = (event, site, index) =>
    actions.openMenu(
      event,
      [
        { text: t('打开站点'), icon: 'external-link', run: () => openSite(site.url) },
        { text: t('编辑站点'), icon: 'pencil', run: () => setEditing({ site }) },
        ...(index > 0
          ? [{ text: t('上移'), icon: 'chevron-up', run: () => moveSite(index, -1) }]
          : []),
        ...(index < sites.length - 1
          ? [{ text: t('下移'), icon: 'chevron-down', run: () => moveSite(index, 1) }]
          : []),
        { sep: true },
        {
          text: t('移除站点'),
          icon: 'trash-2',
          danger: true,
          run: () => {
            const at = sites.findIndex((candidate) => sameSite(candidate, site));
            store(sites.filter((_, position) => position !== at));
          },
        },
      ],
      site.name,
    );
  const manage = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('添加站点'), icon: 'plus', run: addSite },
        ...(sites.length ? [{ sep: true }] : []),
        ...sites.map((site) => ({
          text: site.name,
          icon: 'pencil',
          run: () => setEditing({ site }),
        })),
      ],
      t('管理站点'),
    );
  return html`<section>
    <div class="ss-block-head">
      <span class="ss-block-head__title">${t('常用学术站点')}</span>
      <span class="ss-block-head__end">
        <button
          type="button"
          class="ss-icon-btn ss-icon-btn--sm"
          aria-label=${t('管理站点')}
          aria-haspopup="menu"
          data-tip=${t('管理站点')}
          onClick=${manage}
        >
          <${Lucide} name="settings" />
        </button>
      </span>
    </div>
    <div class="ss-home__sites">
      ${sites.map(
        (site, index) =>
          html`<button
            key=${site.name}
            type="button"
            class="ss-btn ss-btn--sm"
            data-site
            data-tip=${site.url}
            onClick=${() => openSite(site.url)}
            onContextMenu=${(event) => siteMenu(event, site, index)}
          >
            <${Lucide} name="globe" />${site.name}
          </button>`,
      )}
      <button type="button" class="ss-btn ss-btn--ghost ss-btn--sm" onClick=${addSite}>
        <${Lucide} name="plus" />${t('添加站点')}
      </button>
    </div>
    ${editing && html`<${SiteDialog} site=${editing.site} onClose=${() => setEditing(null)} />`}
  </section>`;
}

/** @param {{ projectId?: string | null }} props */
export function Welcome({ projectId = null }) {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const projects = useAppState((state) => state.projects);
  const userName = useAppState((state) => state.settings?.profile?.name) || t('用户');
  const project = projects.find((candidate) => candidate.id === projectId);
  const recent = meetings
    .filter(listed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);
  const where = [
    ...projects
      .filter((entry) => !entry.archived)
      .map((entry) => ({
        text: entry.name,
        icon: entry.id === projectId ? 'folder-open' : 'folder',
        selected: entry.id === projectId,
        run: () => navigate({ view: 'new', id: entry.id }),
      })),
    { sep: true },
    {
      text: t('独立对话（不放进项目）'),
      icon: 'message-square',
      selected: !project,
      run: () => navigate({ view: 'home' }),
    },
  ];

  return html`<main class="ss-main">
    <div class="ss-header">
      <div class="ss-header__title"><span>${t('新对话')}</span></div>
      <${ChoiceMenu}
        label=${t('新对话放在')}
        triggerClass="ss-select ss-select--ghost"
        placement="bottom-start"
        items=${where}
      >
        <${Lucide} name=${project ? 'folder-open' : 'message-square'} />
        <span class="ss-select__value ss-truncate">${project?.name ?? t('独立对话')}</span>
      <//>
      <div class="ss-header__actions"></div>
    </div>
    <div class="ss-content">
      <div class="ss-home">
        <div class="ss-home__hello">
          <${Illustration} name="welcome" />
          <h1 class="ss-home__title">${t('今天想研究什么？')}</h1>
          <p class="ss-muted ss-home__greeting">
            ${t('{name}，从一个问题开始，和你的研究小组一起推进。', { name: userName })}
          </p>
        </div>
        ${
          recent.length > 0 &&
          html`<section>
            <div class="ss-block-head">
              <span class="ss-block-head__title">${t('最近工作')}</span>
              <span class="ss-block-head__end">
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  onClick=${() => navigate({ view: 'all' })}
                >
                  ${t('全部对话')}<${Lucide} name="chevron-right" />
                </button>
              </span>
            </div>
            <div class="ss-list">
              ${recent.map(
                (meeting) =>
                  html`<${ChatRow}
                    key=${meeting.id}
                    meeting=${meeting}
                    projects=${projects}
                    sub=${projects.find((entry) => entry.id === meeting.projectId)?.name ?? t('独立对话')}
                  />`,
              )}
            </div>
          </section>`
        }
        <${Sites} />
      </div>
    </div>
    <${Composer}
      key=${projectId ?? 'standalone'}
      projectId=${projectId}
      onSend=${(text, input, approval, model) =>
        actions.startMeeting(text, projectId, input, approval, model)}
    />
  </main>`;
}
