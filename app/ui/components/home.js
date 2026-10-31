// The home page, which is also 新对话: a new chat that is not started yet. The
// header picks the project it goes into; the first message creates it there and
// opens it. Above the composer, on one screen: where the chosen project stands,
// starting questions, the drafts last worked on and the user's academic sites.
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { openDesk } from '../desk-window.js';
import { html } from '../html.js';
import { latestDrafts, starters } from '../home-next.js';
import { formatTime, t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { navigate } from '../route.js';
import { parsePlans } from '../workbench-text.js';
import { Composer } from './composer.js';
import { FileType, deskKind } from './desk-nav.js';
import { Dialog } from './dialog.js';
import { Illustration } from '../illustrations.js';
import { ChoiceMenu } from './popover.js';
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

/**
 * The version groups of these projects, re-read when versions change.
 * @param {any[]} projects
 * @returns {Array<{ project: any, groups: any[] }>}
 */
function useVersionGroups(projects) {
  const actions = useActions();
  const version = useAppState((state) => state.versionsVersion);
  const [lists, setLists] = useState(/** @type {Array<{ project: any, groups: any[] }>} */ ([]));
  const ids = projects.map((project) => project.id).join(',');
  useEffect(() => {
    let current = true;
    Promise.all(
      projects.map((project) =>
        actions
          .versionGroups(project.id)
          .then((groups) => ({ project, groups }))
          .catch(() => ({ project, groups: [] })),
      ),
    ).then((next) => current && setLists(next));
    return () => {
      current = false;
    };
  }, [ids, version]);
  return lists;
}

/** The project's plans file, re-read when the workspace changes. @param {string | null} projectId */
function usePlans(projectId) {
  const actions = useActions();
  const version = useAppState((state) => state.workspaceVersion);
  const [text, setText] = useState('');
  useEffect(() => {
    let current = true;
    if (!projectId) setText('');
    else
      actions
        .readResource('plans', projectId)
        .then((file) => current && setText(file?.text ?? ''))
        .catch(() => current && setText(''));
    return () => {
      current = false;
    };
  }, [projectId, version]);
  return parsePlans(text).filter((plan) => !plan.done);
}

/** Open a draft in the desk: its file when it has one, otherwise its latest version. @param {any} draft */
const openDraft = ({ project, group, version }) =>
  openDesk(
    group.sourcePath
      ? { projectId: project.id, path: group.sourcePath }
      : { projectId: project.id, versionId: version.id, name: version.name, group: group.name },
  );

/** A project-relative path's folder. @param {string} relative */
const folderOf = (relative) => relative.split('/').slice(0, -1).join('/');

/** @param {{ projectId?: string | null }} props */
export function Welcome({ projectId = null }) {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const projects = useAppState((state) => state.projects);
  const participants = useAppState((state) => state.participants);
  const userName = useAppState((state) => state.settings?.profile?.name) || t('用户');
  const project = projects.find((candidate) => candidate.id === projectId);
  const input = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  const live = projects.filter((entry) => !entry.archived);
  const drafts = latestDrafts(useVersionGroups(project ? [project] : live));
  const plans = usePlans(project?.id ?? null);
  const lastChat = project
    ? meetings
        .filter((meeting) => listed(meeting) && meeting.projectId === project.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    : null;
  const latest = drafts[0] ?? null;
  const owner = `new:${projectId ?? 'global'}`;
  const offers = starters({
    project: project ?? null,
    draft: latest && { name: latest.version.name, number: latest.version.number },
    plan: plans[0]?.text ?? null,
    participants,
  });
  /**
   * 继续写作: the desk, the folder, or the program the system opens it with. A
   * draft with a project file opens that file; one without opens its latest version.
   * @param {Event} event @param {any} draft
   */
  const draftMenu = (event, draft) => {
    const { project: place, group, version } = draft;
    const path = group.sourcePath;
    const file = (body) => actions.attempt(() => actions.fileOp(place.id, body));
    actions.openMenu(
      event,
      [
        {
          text: t('在编辑台打开'),
          icon: 'app-window',
          run: () => actions.attempt(() => openDraft(draft)),
        },
        {
          text: t('在资源管理器中显示'),
          icon: 'folder-open',
          run: () =>
            path
              ? file({ op: 'open', path: folderOf(path) })
              : actions.attempt(() => actions.openVersion(version.id, true)),
        },
        {
          text: t('用默认程序打开'),
          icon: 'external-link',
          run: () =>
            path
              ? file({ op: 'open', path })
              : actions.attempt(() => actions.openVersion(version.id)),
        },
      ],
      version.name,
    );
  };
  /** Put a starting question into the composer, caret at the end. @param {string} text */
  const fill = (text) => {
    actions.composerDraft(owner, text);
    requestAnimationFrame(() => {
      const box = input.current;
      if (!box) return;
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
  };
  const where = [
    ...live.map((entry) => ({
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
  const facts = [
    latest && t('《{name}》改到第 {n} 版', { name: latest.version.name, n: latest.version.number }),
    plans.length > 0 && t('计划里还有 {n} 件事没做完', { n: plans.length }),
  ].filter(Boolean);

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
    <div class="ss-content ss-content--center">
      <div class="ss-home">
        <div class="ss-home__hello">
          <${Illustration} name="welcome" />
          <h1 class="ss-home__title">${t('今天想研究什么？')}</h1>
          <p class="ss-muted ss-home__greeting">
            ${t('{name}，从一个问题开始，和你的研究小组一起推进。', { name: userName })}
          </p>
        </div>
        ${
          project &&
          (facts.length > 0 || lastChat) &&
          html`<div class="ss-home__progress" data-home-progress>
            <p class="ss-home__progress-text">
              <b>${project.name}</b>${
                facts.length
                  ? t('：{facts}。', { facts: facts.join(t('，')) })
                  : t('：还没有稿件和计划。')
              }
            </p>
            <div class="ss-home__progress-actions">
              ${
                lastChat &&
                html`<button
                  type="button"
                  class="ss-btn ss-btn--sm"
                  data-tip=${t('打开这个对话')}
                  onClick=${() => navigate({ view: 'meeting', id: lastChat.id })}
                >
                  <${Lucide} name="history" /><span class="ss-truncate"
                    >${t('继续：{title}', { title: lastChat.title })}</span
                  >
                </button>`
              }
              ${
                plans.length > 0 &&
                html`<button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  data-tip=${t('打开工作站的计划')}
                  onClick=${() => navigate({ view: 'plans', id: project.id })}
                >
                  <${Lucide} name="list-checks" />${t('看计划')}
                </button>`
              }
            </div>
          </div>`
        }
        <section>
          <div class="ss-block-head">
            <span class="ss-block-head__title">${t('从这里开始')}</span>
            <span class="ss-block-head__end"
              ><span class="ss-muted ss-home__hint"
                >${t('点一下填进输入框，改几个字再发')}</span
              ></span
            >
          </div>
          <div class="ss-starters">
            ${offers.map(
              (offer) =>
                html`<button
                  key=${offer.title}
                  type="button"
                  class="ss-starter"
                  data-starter
                  onClick=${() => fill(offer.text)}
                >
                  <${Lucide} name=${offer.icon} class="ss-starter__icon" />
                  <span class="ss-starter__main">
                    <span class="ss-starter__title" title=${offer.title}>${offer.title}</span>
                    <span class="ss-starter__sub">${offer.sub}</span>
                  </span>
                </button>`,
            )}
          </div>
        </section>
        ${
          drafts.length > 0 &&
          html`<section data-home-drafts>
            <div class="ss-block-head">
              <span class="ss-block-head__title">${t('继续上次的工作')}</span>
              <span class="ss-block-head__end">
                <button
                  type="button"
                  class="ss-btn ss-btn--ghost ss-btn--sm"
                  data-tip=${t('在独立窗口打开编辑台')}
                  onClick=${() =>
                    actions.attempt(() => openDesk(project ? { projectId: project.id } : {}))}
                >
                  ${t('编辑台')}<${Lucide} name="app-window" />
                </button>
              </span>
            </div>
            <div class="ss-list">
              ${drafts.map(
                (draft) =>
                  html`<div class="ss-list-row ss-list-row--2" key=${draft.group.id}>
                    <${FileType} kind=${deskKind(draft.version.name) ?? 'group'} />
                    <div class="ss-list-row__main">
                      <span class="ss-list-row__title">${draft.version.name}</span>
                      <span class="ss-list-row__sub"
                        >${t('{project} · 第 {n} 版', { project: draft.project.name, n: draft.version.number })}</span
                      >
                    </div>
                    <span class="ss-list-row__meta ss-list-row__meta--time"
                      >${formatTime(draft.version.createdAt)}</span
                    >
                    <button
                      type="button"
                      class="ss-btn ss-btn--sm"
                      aria-haspopup="menu"
                      data-tip=${t('选择打开方式')}
                      onClick=${(event) => draftMenu(event, draft)}
                    >
                      ${t('继续写作')}<${Lucide} name="chevron-down" />
                    </button>
                  </div>`,
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
      inputRef=${input}
      onSend=${(text, research, approval, model) =>
        actions.startMeeting(text, projectId, research, approval, model)}
    />
  </main>`;
}
