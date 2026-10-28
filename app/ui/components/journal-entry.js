// One project log entry (design system PageJournal): its details as Markdown,
// turned into plain text by a click and saved when the box is left, and the
// files and manuscript versions linked to it, saved as soon as they change.
// The card on the right holds the entry's facts and the link form.
import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { useActions, useAppState } from '../context.js';
import { Lucide } from '../icons.js';
import { renderMarkdown } from '../markdown.js';
import { navigate } from '../route.js';
import { useSnapshotCapture } from '../resource-snapshots.js';
import { logEntryText, parseLog, removeLogEntry } from '../workbench-text.js';
import { FieldDialog, useQuestion } from './dialog.js';
import { ChoiceMenu } from './popover.js';
import { openResourceHistory } from './resource-history.js';

export const JOURNAL_TABS = ['文件列表', '日志详情'];

/**
 * The entry's details: rendered Markdown that turns into its plain text when
 * clicked, and is saved when it loses focus.
 * @param {{ body: string, onSave: (body: string) => void }} props
 */
function DetailsEditor({ body, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  const input = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
  useEffect(() => setText(body), [body]);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  if (editing)
    return html`<textarea
      ref=${input}
      class="journal-editor"
      aria-label=${t('编辑日志详情')}
      value=${text}
      onInput=${(event) => setText(event.currentTarget.value)}
      onBlur=${() => {
        setEditing(false);
        if (text !== body) onSave(text);
      }}
      onKeyDown=${(event) => {
        if (event.key !== 'Escape') return;
        setText(body);
        requestAnimationFrame(() => setEditing(false));
      }}
    />`;
  return html`<div
    class="ss-prose journal-details"
    role="button"
    tabindex="0"
    data-tip=${t('点一下编辑，离开自动保存')}
    aria-label=${t('编辑日志详情')}
    onClick=${(event) => !event.target.closest('a') && setEditing(true)}
    onKeyDown=${(event) => event.key === 'Enter' && setEditing(true)}
    dangerouslySetInnerHTML=${{ __html: renderMarkdown(body || t('没有详细内容，点击添加。')) }}
  />`;
}

/** A link's icon and name. @param {any} reference */
const linkName = (reference) => reference.label ?? reference.path ?? reference.id;
const linkIcon = (reference) => (reference.kind === 'version' ? 'git-fork' : 'file-text');

/**
 * @param {{projectId:string,entry:any,text:string,initial?:string,revisionId?:string,onSaved:()=>void}} props
 */
export function JournalEntry({
  projectId,
  entry,
  text,
  initial = '日志详情',
  revisionId,
  onSaved,
}) {
  const actions = useActions();
  useAppState((state) => state.settings?.appearance?.language);
  const project = useAppState((state) => state.projects.find((item) => item.id === projectId));
  const [tab, setTab] = useState(initial);
  const [versions, setVersions] = useState(/** @type {any[]} */ ([]));
  const [file, setFile] = useState('');
  const [dialog, setDialog] = useState(/** @type {'title' | 'date' | null} */ (null));
  const [question, ask] = useQuestion();
  useEffect(() => {
    actions
      .versionGroups(projectId)
      .then((groups) =>
        setVersions(
          groups.flatMap((group) =>
            group.versions.map((version) => ({ ...version, group: group.name })),
          ),
        ),
      )
      .catch((error) => actions.toast(error.message));
  }, [projectId]);

  /** Write the entry with some of its parts changed. */
  const save = (changes) =>
    actions.attempt(async () => {
      const next = { ...entry, ...changes };
      const lines = text.split('\n');
      lines.splice(
        entry.start,
        entry.end - entry.start,
        logEntryText(next.title, next.body, next.date, next.references).trimStart(),
      );
      const result = await actions.editResource(
        'log',
        projectId,
        'write',
        { text: lines.join('\n') },
        revisionId,
      );
      await actions.captureSnapshot('log', projectId);
      onSaved();
      return result;
    });
  const references = entry.references;
  const link = (reference) => save({ references: [...references, reference] });
  const unlink = (index) =>
    save({ references: references.filter((_, ordinal) => ordinal !== index) });
  const open = (reference) => actions.attempt(() => actions.openLogFile(projectId, reference));
  const addFile = () => {
    const path = file.trim();
    if (!path) return;
    setFile('');
    void link({ schema: 1, kind: 'project-file', projectId, path, label: path });
  };
  const remove = async () => {
    const choice = await ask({
      title: t('删除这条日志？'),
      text: t('「{title}」会从项目日志里删掉，日志的历史版本里还能找回。', { title: entry.title }),
      options: [{ value: 'delete', label: t('删除'), primary: true }],
    });
    if (choice !== 'delete') return;
    const result = await actions.attempt(() =>
      actions.editResource('log', projectId, 'write', { text: removeLogEntry(text, entry) }),
    );
    if (result) navigate({ view: 'workbench', id: projectId });
  };
  const more = (event) =>
    actions.openMenu(
      event,
      [
        { text: t('编辑标题'), icon: 'pencil', run: () => setDialog('title') },
        { text: t('改日期'), icon: 'calendar', run: () => setDialog('date') },
        { sep: true },
        { text: t('删除日志'), icon: 'trash-2', danger: true, run: remove },
      ],
      entry.title,
    );

  const linkRows = references.map(
    (reference, index) =>
      html`<div class="ss-list-row" key=${`${index}:${linkName(reference)}`}>
        <${Lucide} name=${linkIcon(reference)} class="ss-list-row__icon" />
        <div class="ss-list-row__main">
          <span class="ss-list-row__title ss-truncate" title=${linkName(reference)}
            >${linkName(reference)}</span
          >
        </div>
        <span class="ss-list-row__actions">
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('打开 {name}', { name: linkName(reference) })}
            data-tip=${t('打开')}
            onClick=${() => open(reference)}
          >
            <${Lucide} name="external-link" />
          </button>
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('移除关联')}
            data-tip=${t('移除关联')}
            onClick=${() => unlink(index)}
          >
            <${Lucide} name="x" />
          </button>
        </span>
      </div>`,
  );
  const header = html`<div class="ss-header">
    <button
      type="button"
      class="ss-icon-btn"
      aria-label=${t('返回工作站')}
      data-tip=${t('返回工作站')}
      data-kbd="Alt ←"
      onClick=${() => navigate({ view: 'workbench', id: projectId })}
    >
      <${Lucide} name="arrow-left" />
    </button>
    <div class="ss-header__title"><span>${entry.title}</span></div>
    ${entry.date && html`<span class="ss-tag ss-header__tag">${entry.date.slice(5)}</span>`}
    <span class="ss-header__sep"></span>
    <nav class="ss-tabs" role="tablist" aria-label=${t('日志')}>
      ${['日志详情', '文件列表'].map(
        (name) =>
          html`<button
            type="button"
            key=${name}
            class="ss-tab"
            role="tab"
            aria-selected=${String(tab === name)}
            onClick=${() => setTab(name)}
          >
            ${t(name)}${
              name === '文件列表' && html`<span class="ss-tab__count">${references.length}</span>`
            }
          </button>`,
      )}
    </nav>
    <div class="ss-header__actions">
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('历史版本')}
        data-tip=${t('历史版本')}
        onClick=${() => openResourceHistory(actions, { projectId, resource: 'log' })}
      >
        <${Lucide} name="history" />
      </button>
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t('更多')}
        aria-haspopup="menu"
        data-tip=${t('更多')}
        onClick=${more}
      >
        <${Lucide} name="ellipsis" />
      </button>
    </div>
  </div>`;

  return html`${header}
    <div class="ss-content" data-journal-entry>
      <div class="ss-doc ss-doc--aside">
        <article class="ss-journal__body">
          <div class="ss-doc__meta">
            <span><${Lucide} name="folder" small /> ${project?.name ?? ''}</span>
            ${entry.date && html`<span>${entry.date}</span>`}
            ${tab === '日志详情' && html`<span>${t('点正文直接编辑')}</span>`}
          </div>
          ${
            tab === '文件列表'
              ? html`<div class="ss-list">
                  ${linkRows}${!references.length && html`<p class="ss-muted">${t('暂无关联文件')}</p>`}
                </div>`
              : html`<${DetailsEditor} body=${entry.body} onSave=${(body) => save({ body })} />`
          }
        </article>
        <aside class="ss-box-card ss-journal__facts" aria-label=${t('节点信息')}>
          <div class="ss-box-card__head"><span>${t('节点信息')}</span></div>
          <div class="ss-journal__facts-body">
            <dl class="ss-props">
              <dt>${t('所属项目')}</dt>
              <dd>${project?.name ?? ''}</dd>
              <dt>${t('日期')}</dt>
              <dd>${entry.date || t('未写日期')}</dd>
            </dl>
            <div class="ss-field">
              <span class="ss-field__label">${t('关联稿件版本')}</span>
              <${ChoiceMenu}
                label=${t('关联稿件版本')}
                triggerClass="ss-select ss-select--sm"
                placement="bottom-start"
                disabled=${!versions.length}
                items=${versions.map((version) => ({
                  text: `${version.group} · v${version.number}`,
                  description: version.name,
                  run: () =>
                    link({
                      schema: 1,
                      kind: 'version',
                      projectId,
                      id: version.id,
                      label: `${version.name} · v${version.number}`,
                    }),
                }))}
              >
                <span class="ss-select__value">
                  ${versions.length ? t('选一个版本关联') : t('这个项目还没有文稿版本')}
                </span>
              <//>
            </div>
            <div class="ss-field">
              <span class="ss-field__label">${t('关联文件')}</span>
              ${references.length > 0 && html`<div class="ss-list">${linkRows}</div>`}
              <span class="ss-input ss-input--sm">
                <${Lucide} name="paperclip" small />
                <input
                  aria-label=${t('项目文件路径')}
                  placeholder=${t('项目文件夹里的相对路径，回车添加')}
                  value=${file}
                  onInput=${(event) => setFile(event.currentTarget.value)}
                  onKeyDown=${(event) => {
                    if (event.key === 'Enter' && !event.isComposing) {
                      event.preventDefault();
                      addFile();
                    }
                  }}
                />
              </span>
              <span class="ss-field__hint">${t('关联随日志的历史版本一起保留。')}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
    ${
      dialog &&
      html`<${FieldDialog}
        title=${dialog === 'title' ? t('编辑标题') : t('改日期')}
        label=${dialog === 'title' ? t('标题') : t('日期')}
        type=${dialog === 'title' ? 'text' : 'date'}
        value=${dialog === 'title' ? entry.title : entry.date}
        onClose=${() => setDialog(null)}
        onSave=${(value) => save(dialog === 'title' ? { title: value } : { date: value })}
      />`
    }
    ${question}`;
}

/**
 * @param {{projectId:string,line:number,initial:string}} props
 */
export function JournalEntryPage({ projectId, line, initial }) {
  const actions = useActions();
  const [document, setDocument] = useState(/** @type {any} */ (null));
  const [loads, setLoads] = useState(0);
  const workspace = useAppState((state) => state.workspaceVersion);
  useSnapshotCapture([['log', projectId]]);
  useEffect(() => {
    let active = true;
    actions
      .readResource('log', projectId)
      .then((value) => active && setDocument(value))
      .catch((error) => actions.toast(error.message));
    return () => {
      active = false;
    };
  }, [projectId, line, loads, workspace]);
  useEffect(() => {
    const key = (event) => {
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate({ view: 'workbench', id: projectId });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [projectId]);
  const entry = document && parseLog(document.text).find((item) => item.start === line);
  return html`<main class="main ss-main journal-page">
    ${
      entry
        ? html`<${JournalEntry}
            key=${entry.start}
            projectId=${projectId}
            entry=${entry}
            text=${document.text}
            revisionId=${document.revisionId}
            initial=${initial}
            onSaved=${() => setLoads(loads + 1)}
          />`
        : document &&
          html`<div class="ss-empty">
            <div class="ss-empty__title">${t('找不到这条日志')}</div>
            <div class="ss-empty__actions">
              <button
                type="button"
                class="ss-btn ss-btn--sm"
                onClick=${() => navigate({ view: 'workbench', id: projectId })}
              >
                ${t('返回工作站')}
              </button>
            </div>
          </div>`
    }
  </main>`;
}
