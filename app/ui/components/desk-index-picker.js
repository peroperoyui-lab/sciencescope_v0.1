// The desk's index dialog (EDITING_DESK.md §6.3, scene 5): link the selected
// words to project files, library sources or items, or chat messages, with a
// sentence on what they are. Every link is a schema 1 reference, the format
// the journal and version notes already open.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Dialog } from './dialog.js';

const SCRIPT = /\.(py|r|do|jl|sh|ps1|ipynb|m|sas|sps)$/iu;
const NUMBER = /^[\d\s.,%‰+\-−–~]+$/u;

/** What a reference is, in two words, and its icon. @param {any} reference */
export function referenceKind(reference) {
  if (reference.kind === 'script') return { label: t('脚本'), icon: 'file-code' };
  if (reference.kind === 'project-file') return { label: t('文件'), icon: 'file' };
  if (reference.kind === 'source' || reference.kind === 'chunk')
    return { label: t('资料'), icon: 'book-open' };
  if (reference.kind === 'item') return { label: t('条目'), icon: 'book-marked' };
  if (reference.kind === 'message') return { label: t('消息'), icon: 'message-square' };
  return { label: t('来源'), icon: 'link' };
}

/** @param {any} reference */
const keyOf = (reference) =>
  `${reference.kind}:${reference.path ?? reference.id ?? ''}:${reference.meetingId ?? ''}`;

/** @param {{ projectId: string, query: string, picked: Map<string, any>, onToggle: (reference: any) => void }} props */
function FilesTab({ projectId, query, picked, onToggle }) {
  const actions = useActions();
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState(/** @type {any[] | null} */ (null));
  useEffect(() => {
    let current = true;
    setEntries(null);
    actions
      .projectFiles(projectId, folder)
      .then((listing) => current && setEntries(listing.entries ?? []))
      .catch(() => current && setEntries([]));
    return () => {
      current = false;
    };
  }, [projectId, folder]);
  const parts = folder ? folder.split('/') : [];
  const needle = query.trim().toLowerCase();
  const shown = (entries ?? []).filter(
    (entry) => !needle || entry.name.toLowerCase().includes(needle),
  );
  return html`<nav class="ss-desk-picker__crumbs" aria-label=${t('文件夹')}>
      <button type="button" class="ss-linkbtn" onClick=${() => setFolder('')}>
        ${t('项目文件夹')}
      </button>
      ${parts.map(
        (part, index) =>
          html`<span class="ss-muted">/</span
            ><button
              type="button"
              class="ss-linkbtn"
              onClick=${() => setFolder(parts.slice(0, index + 1).join('/'))}
            >
              ${part}
            </button>`,
      )}
    </nav>
    <div class="ss-list ss-desk-picker__list" role="listbox" aria-label=${t('项目文件')}>
      ${
        entries == null
          ? html`<div class="ss-desk-picker__note">
              <span class="ss-spin"></span>${t('正在读取…')}
            </div>`
          : shown.length
            ? shown.map((entry) => {
                if (entry.kind === 'folder')
                  return html`<button
                    type="button"
                    key=${entry.path}
                    class="ss-list-row ss-desk-picker__row"
                    onClick=${() => setFolder(entry.path)}
                  >
                    <${Lucide} name="folder" class="ss-list-row__icon" />
                    <span class="ss-list-row__main"
                      ><span class="ss-list-row__title">${entry.name}</span></span
                    >
                    <${Lucide} name="chevron-right" small />
                  </button>`;
                const reference = {
                  schema: 1,
                  kind: SCRIPT.test(entry.name) ? 'script' : 'project-file',
                  projectId,
                  path: entry.path,
                  label: entry.path,
                };
                return html`<label
                  key=${entry.path}
                  class="ss-list-row ss-desk-picker__row"
                  role="option"
                  aria-selected=${String(picked.has(keyOf(reference)))}
                >
                  <span class="ss-check"
                    ><input
                      type="checkbox"
                      checked=${picked.has(keyOf(reference))}
                      onChange=${() => onToggle(reference)}
                  /></span>
                  <${Lucide} name=${referenceKind(reference).icon} class="ss-list-row__icon" />
                  <span class="ss-list-row__main"
                    ><span class="ss-list-row__title">${entry.name}</span></span
                  >
                </label>`;
              })
            : html`<div class="ss-desk-picker__note">
                ${needle ? t('这个文件夹里没有对得上的文件') : t('这个文件夹是空的')}
              </div>`
      }
    </div>`;
}

/** @param {{ rows: any[] | null, empty: string, picked: Map<string, any>, onToggle: (reference: any) => void }} props */
function ReferenceList({ rows, empty, picked, onToggle }) {
  return html`<div class="ss-list ss-desk-picker__list" role="listbox">
    ${
      rows == null
        ? html`<div class="ss-desk-picker__note">
            <span class="ss-spin"></span>${t('正在读取…')}
          </div>`
        : rows.length
          ? rows.map(
              ({ reference, title, sub }) =>
                html`<label
                  key=${keyOf(reference)}
                  class=${`ss-list-row ss-desk-picker__row${sub ? ' ss-list-row--2' : ''}`}
                  role="option"
                  aria-selected=${String(picked.has(keyOf(reference)))}
                >
                  <span class="ss-check"
                    ><input
                      type="checkbox"
                      checked=${picked.has(keyOf(reference))}
                      onChange=${() => onToggle(reference)}
                  /></span>
                  <${Lucide} name=${referenceKind(reference).icon} class="ss-list-row__icon" />
                  <span class="ss-list-row__main">
                    <span class="ss-list-row__title" title=${title}>${title}</span>
                    ${sub && html`<span class="ss-list-row__sub">${sub}</span>`}
                  </span>
                </label>`,
            )
          : html`<div class="ss-desk-picker__note">${empty}</div>`
    }
  </div>`;
}

/** @param {{ projectId: string, query: string, picked: Map<string, any>, onToggle: (reference: any) => void }} props */
function LibraryTab({ projectId, query, picked, onToggle }) {
  const actions = useActions();
  const [rows, setRows] = useState(/** @type {any[] | null} */ (null));
  useEffect(() => {
    let current = true;
    Promise.all([
      actions.previewSources(projectId).catch(() => []),
      actions.researchItems({ projectId }).catch(() => []),
    ]).then(([sources, items]) => {
      if (!current) return;
      setRows([
        ...(Array.isArray(sources) ? sources : []).map((source) => ({
          title: source.title ?? source.name ?? source.id,
          reference: {
            schema: 1,
            kind: 'source',
            id: source.id,
            sourceId: source.id,
            projectId,
            label: source.title ?? source.name ?? source.id,
          },
        })),
        ...(Array.isArray(items) ? items : []).map((item) => ({
          title: item.title ?? item.id,
          sub: t('条目'),
          reference: { schema: 1, kind: 'item', id: item.id, label: item.title ?? item.id },
        })),
      ]);
    });
    return () => {
      current = false;
    };
  }, [projectId]);
  const needle = query.trim().toLowerCase();
  return html`<${ReferenceList}
    rows=${rows && rows.filter((row) => !needle || row.title.toLowerCase().includes(needle))}
    empty=${needle ? t('资料库里没有对得上的资料或条目') : t('这个项目的资料库还是空的')}
    picked=${picked}
    onToggle=${onToggle}
  />`;
}

/** @param {{ projectId: string, query: string, picked: Map<string, any>, onToggle: (reference: any) => void }} props */
function MessagesTab({ projectId, query, picked, onToggle }) {
  const actions = useActions();
  const meetings = useAppState((state) => state.meetings);
  const [rows, setRows] = useState(/** @type {any[] | null} */ ([]));
  useEffect(() => {
    const text = query.trim();
    if (!text) return setRows([]);
    let current = true;
    setRows(null);
    const timer = setTimeout(() => {
      actions
        .search(text)
        .then(({ messages }) => {
          if (!current) return;
          const inProject = new Set(
            meetings.filter((meeting) => meeting.projectId === projectId).map((item) => item.id),
          );
          setRows(
            messages
              .filter((message) => !inProject.size || inProject.has(message.meetingId))
              .map((message) => {
                const title =
                  meetings.find((meeting) => meeting.id === message.meetingId)?.title ?? '';
                return {
                  title: message.snippet,
                  sub: title,
                  reference: {
                    schema: 1,
                    kind: 'message',
                    id: message.id,
                    meetingId: message.meetingId,
                    projectId,
                    label: Array.from(message.snippet.replace(/^…/u, '')).slice(0, 40).join(''),
                  },
                };
              }),
          );
        })
        .catch(() => current && setRows([]));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);
  return html`<${ReferenceList}
    rows=${rows}
    empty=${query.trim() ? t('没有找到含这些字的消息') : t('输入关键词，查找对话里的消息')}
    picked=${picked}
    onToggle=${onToggle}
  />`;
}

/**
 * @param {{ projectId: string, quote: string, item?: any, note?: string,
 *   onClose: () => void, onSubmit: (value: any) => Promise<void> }} props
 * `item` is the index being edited; `note` starts the description (from a comment draft).
 */
export function DeskIndexPicker({ projectId, quote, item, note = '', onClose, onSubmit }) {
  const [tab, setTab] = useState('files');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(
    () => new Map((item?.sources ?? []).map((reference) => [keyOf(reference), reference])),
  );
  const [text, setText] = useState(item?.note ?? note);
  const [busy, setBusy] = useState(false);
  const toggle = (reference) => {
    const next = new Map(picked);
    if (next.has(keyOf(reference))) next.delete(keyOf(reference));
    else next.set(keyOf(reference), reference);
    setPicked(next);
  };
  const submit = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      const number = NUMBER.test(quote.trim());
      await onSubmit({
        sources: [...picked.values()],
        note: text.trim(),
        ...(item ? {} : { kind: number ? 'number' : 'text', value: number ? quote.trim() : '' }),
      });
    } finally {
      setBusy(false);
    }
  };
  const tabs = [
    ['files', t('项目文件')],
    ['library', t('资料库')],
    ['messages', t('对话消息')],
  ];
  const props = { projectId, query, picked, onToggle: toggle };
  return html`<${Dialog}
    title=${item ? t('修改索引') : t('添加索引')}
    size="md"
    onClose=${onClose}
    onSubmit=${submit}
    foot=${html`${
        !picked.size &&
        html`<span class="ss-muted ss-desk-picker__hint">${t('至少选一项来源')}</span>`
      }
      <button type="button" class="ss-btn" onClick=${onClose}>${t('取消')}</button>
      <button type="submit" class="ss-btn ss-btn--primary" disabled=${!picked.size || busy}>
        ${item ? t('保存索引') : t('添加索引')}
      </button>`}
  >
    <div class="ss-desk-picker">
      <p class="ss-desk-card__quote" title=${quote}>${quote}</p>
      <div class="ss-desk-picker__bar">
        <div class="ss-seg ss-seg--sm" role="group" aria-label=${t('来源类型')}>
          ${tabs.map(
            ([name, label]) =>
              html`<button
                type="button"
                key=${name}
                aria-pressed=${String(tab === name)}
                onClick=${() => setTab(name)}
              >
                ${label}
              </button>`,
          )}
        </div>
        <span class="ss-input ss-input--sm ss-desk-picker__search">
          <${Lucide} name="search" />
          <input
            type="search"
            aria-label=${t('查找来源')}
            placeholder=${tab === 'messages' ? t('消息里的关键词') : t('按名称筛选')}
            value=${query}
            onInput=${(event) => setQuery(event.currentTarget.value)}
            onKeyDown=${(event) => event.key === 'Enter' && event.preventDefault()}
          />
        </span>
      </div>
      ${
        tab === 'files'
          ? html`<${FilesTab} ...${props} />`
          : tab === 'library'
            ? html`<${LibraryTab} ...${props} />`
            : html`<${MessagesTab} ...${props} />`
      }
      ${
        picked.size > 0 &&
        html`<div class="ss-chips ss-chips--inline" aria-label=${t('已选来源')}>
          ${[...picked.values()].map(
            (reference) =>
              html`<span class="ss-chip" key=${keyOf(reference)} title=${reference.label}>
                <${Lucide} name=${referenceKind(reference).icon} small />
                <span class="ss-truncate"
                  >${reference.label ?? reference.path ?? reference.id}</span
                >
                <button
                  type="button"
                  aria-label=${t('移除 {name}', { name: reference.label ?? '' })}
                  onClick=${() => toggle(reference)}
                >
                  <${Lucide} name="x" small />
                </button>
              </span>`,
          )}
        </div>`
      }
      <label class="ss-field">
        <span class="ss-field__label">${t('说明')}</span>
        <textarea
          class="ss-textarea"
          rows="2"
          placeholder=${t('这段文字是什么、怎么得来的，例如「去重后进入分析的企业数」')}
          value=${text}
          onInput=${(event) => setText(event.currentTarget.value)}
        ></textarea>
      </label>
    </div>
  <//>`;
}
