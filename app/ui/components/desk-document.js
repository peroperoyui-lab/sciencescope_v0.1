// The editing desk's page area. A project's docx, Markdown and TeX open in a
// desk session and are edited in place (U2): docx as a page, Markdown and TeX
// as source. Typing is synced to the session; Save writes the project file.
// Versions, PDF and the Markdown rendered view stay read-only for now
// (docs/architecture/EDITING_DESK.md §10).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { countWords } from '../desk-blocks.js';
import { createDeskSession } from '../desk-session.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

export { countWords };

const PAGE_HEADINGS = 'h1, h2, h3, h4';
const TEX_HEADING =
  /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{(.+)\}/u;
const TEX_LEVELS = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3 };
const EDITABLE = new Set(['docx', 'md', 'tex']);

/**
 * Headings of a source file, with their 1-based line.
 * @param {string} text @param {'latex' | 'markdown'} format
 */
function sourceOutline(text, format) {
  const outline = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    if (format === 'latex') {
      const match = TEX_HEADING.exec(line);
      if (match) outline.push({ level: TEX_LEVELS[match[1]], text: match[2], line: index + 1 });
    } else {
      const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/u.exec(line);
      if (match) outline.push({ level: match[1].length - 1, text: match[2], line: index + 1 });
    }
  });
  const top = Math.min(...outline.map((entry) => entry.level));
  return outline.map((entry) => ({ ...entry, level: entry.level - top }));
}

/** @param {Element} root */
function pageOutline(root) {
  const headings = [...root.querySelectorAll(PAGE_HEADINGS)].filter((node) =>
    node.textContent?.trim(),
  );
  const top = Math.min(...headings.map((node) => Number(node.tagName[1])));
  return headings.map((node, index) => {
    node.setAttribute('data-outline', String(index));
    return { level: Number(node.tagName[1]) - top, text: node.textContent.trim(), index };
  });
}

// The last page's final sync, so the next view of the same file includes it.
let leaving = Promise.resolve();

/** True when this tab opens in a desk session and can be edited. */
export const editableTab = (tab) => tab?.kind === 'project' && EDITABLE.has(tab.format);

/**
 * Open the tab's desk session. A file changed outside while this side has
 * unsaved changes asks which text to keep.
 * @param {any} actions @param {any} tab @param {(question: any) => Promise<string|null>} ask
 */
async function openSession(actions, tab, ask) {
  const group = await actions.registerDeskDocument({ projectId: tab.projectId, path: tab.path });
  try {
    return { opened: await actions.openDeskSession({ groupId: group.id }) };
  } catch (failure) {
    if (failure.code !== 'DESK_EXTERNAL_CHANGE' || !failure.details?.sessionId) throw failure;
    const choice = await ask(externalQuestion(tab.name));
    const sessionId = failure.details.sessionId;
    if (choice === 'mine') {
      const version = await actions.saveDesk(sessionId, { to: 'version' });
      return { opened: await actions.deskSession(sessionId), kept: version.version };
    }
    if (choice !== 'external')
      throw Object.assign(new Error(t('没有打开这份文稿。')), { quiet: true });
    const closed = await actions.closeDesk(sessionId);
    return { opened: await actions.openDeskSession({ groupId: group.id }), kept: closed.version };
  }
}

/** @param {string} name */
export const externalQuestion = (name) => ({
  title: t('{name} 在编辑台外被改过', { name }),
  text: t(
    '项目文件夹里的这份文稿被其他程序改过，编辑台里还有没写回的修改。两边的内容都会留在版本里。',
  ),
  options: [
    { value: 'external', label: t('以外部版本为准重新打开'), primary: true },
    { value: 'mine', label: t('保留我的修改另存为分支') },
  ],
});

/**
 * @param {{ tab: any, view: string, jump: any, onInfo: (info: any) => void, pdf: any,
 *   editing: any, onEdit: (state: any) => void, ask: (question: any) => Promise<string|null>,
 *   onSession: (sessionId: string | null) => void, onSelection?: () => void,
 *   onReady?: () => void, onRemoved?: (items: {id:string,type:string}[]) => void }} props
 * `jump` is the outline entry to scroll to; `pdf` receives the PDF reader's controls;
 * `editing` receives the editor's commands, and `onEdit` its state for the ribbon.
 */
export function DeskDocument({
  tab,
  view,
  jump,
  onInfo,
  pdf,
  editing,
  onEdit,
  ask,
  onSession,
  onSelection,
  onReady,
  onRemoved,
}) {
  const actions = useActions();
  const host = useRef(/** @type {HTMLElement | null} */ (null));
  const reader = useRef(/** @type {any} */ (null));
  const session = useRef(/** @type {any} */ (null));
  const [sessionId, setSessionId] = useState(/** @type {string | null} */ (null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const remoteSeq = useAppState((state) => (sessionId ? state.deskSeqs[sessionId] : undefined));
  const notice = useAppState((state) => (sessionId ? state.deskSessions[sessionId] : undefined));
  const target =
    tab.kind === 'version'
      ? { kind: 'version', id: tab.id }
      : { kind: 'project', projectId: tab.projectId, path: tab.path };
  const editable = editableTab(tab) && !(tab.format === 'md' && view === 'rendered');

  useEffect(() => {
    let active = true;
    const root = host.current;
    setError('');
    setLoading(true);
    onInfo({ outline: [], words: null, page: null, pages: null });
    onEdit(null);
    /** @type {any} */
    let infoTimer = 0;
    const mountEditor = async () => {
      await leaving;
      const { opened, kept } = await openSession(actions, tab, ask);
      if (!active) return;
      if (kept) actions.toast(t('另一边的内容已留作 v{n}', { n: kept.number }));
      const surface = document.createElement('div');
      root.replaceChildren(surface);
      const docx = tab.format === 'docx';
      const format = tab.format === 'tex' ? 'latex' : 'markdown';
      let editor;
      let state = { marks: [], undo: false, redo: false };
      let status = { state: 'saved' };
      const publish = () => active && onEdit({ format: tab.format, ...state, status });
      const info = () => {
        clearTimeout(infoTimer);
        infoTimer = setTimeout(() => {
          if (!active) return;
          onInfo({
            outline: docx ? editor.outline() : sourceOutline(editor.text(), format),
            words: editor.words(),
          });
        }, 300);
      };
      const handlers = {
        onChange: () => {
          session.current?.changed();
          info();
        },
        onState: (next) => {
          state = next;
          publish();
        },
        onSelection: () => onSelection?.(),
      };
      const pictures = new Map();
      if (docx) {
        surface.className = 'ss-page ss-page--edit';
        const { mountDeskDocx } = await import('../readers/desk-editor.js');
        if (!active) return;
        editor = mountDeskDocx(surface, {
          blocks: opened.blocks,
          media: (ref) => {
            if (!pictures.has(ref)) pictures.set(ref, actions.deskMedia(opened.session.id, ref));
            return pictures.get(ref);
          },
          ...handlers,
        });
      } else {
        surface.className = 'ss-desk-source reader-surface';
        const { mountDeskText } = await import('../readers/desk-editor.js');
        if (!active) return;
        editor = mountDeskText(surface, { text: opened.text, format, ...handlers });
      }
      session.current = createDeskSession({
        actions,
        opened,
        editor,
        onStatus: (next) => {
          status = next;
          publish();
        },
        onError: (message) => actions.toast(message),
        onRemoved: (items) => onRemoved?.(items),
      });
      editing.current = {
        ...editor,
        session: session.current,
        // After choosing the outside version: mount the page again.
        reopen: () => setReload((value) => value + 1),
      };
      setSessionId(opened.session.id);
      onSession(opened.session.id);
      onInfo({
        outline: docx ? editor.outline() : sourceOutline(editor.text(), format),
        words: editor.words(),
      });
      publish();
      onReady?.();
      reader.current = {
        dispose() {
          const current = session.current;
          session.current = null;
          // Send what was typed before the page goes; the session stays open.
          leaving = current
            .flush()
            .catch(() => {})
            .finally(() => {
              current.detach();
              editor.dispose();
              for (const url of pictures.values()) url.then(URL.revokeObjectURL, () => {});
            });
        },
        scrollToLine: editor.scrollToLine,
      };
    };
    const mountReader = async () => {
      await leaving;
      const doc =
        editableTab(tab) && tab.format === 'md'
          ? await openSession(actions, tab, ask).then(({ opened }) => ({
              format: 'markdown',
              text: opened.text,
            }))
          : await actions.previewDocument(target);
      if (!active) return;
      const surface = document.createElement('div');
      root.replaceChildren(surface);
      const bytes = () => actions.previewBytes(target);
      let mounted;
      if (doc.format === 'pdf') {
        surface.className = 'ss-desk-pdf reader-pdf';
        const { mountPdf } = await import('../readers/pdf.js');
        if (!active) return;
        mounted = await mountPdf(surface, await bytes(), {
          onPage: (page, count) => active && onInfo({ page, pages: count }),
        });
        pdf.current = mounted;
      } else {
        const page = doc.format === 'docx' || (doc.format === 'markdown' && view === 'rendered');
        surface.className = page
          ? `ss-page${doc.format === 'markdown' ? ' ss-page--md' : ''}`
          : 'ss-desk-source reader-surface';
        const { mountDocument } = await import('../readers/document.js');
        if (!active) return;
        mounted = await mountDocument(surface, doc, page ? 'readable' : 'source', bytes);
        onInfo({
          outline: page ? pageOutline(surface) : sourceOutline(doc.text ?? '', doc.format),
          words: countWords(page ? (surface.textContent ?? '') : (doc.text ?? '')),
        });
      }
      if (!active) mounted.dispose();
      else reader.current = mounted;
    };
    (editable ? mountEditor() : mountReader())
      .catch((failure) => active && setError(failure.message))
      .finally(() => active && setLoading(false));
    const flushNow = () => session.current?.flush().catch(() => {});
    addEventListener('pagehide', flushNow);
    addEventListener('blur', flushNow);
    return () => {
      active = false;
      clearTimeout(infoTimer);
      removeEventListener('pagehide', flushNow);
      removeEventListener('blur', flushNow);
      reader.current?.dispose();
      reader.current = null;
      pdf.current = null;
      editing.current = null;
      setSessionId(null);
      onEdit(null);
    };
  }, [tab.key, view, reload]);

  useEffect(() => {
    if (remoteSeq != null) session.current?.remoteSeq(remoteSeq);
  }, [remoteSeq]);
  useEffect(() => {
    if (notice?.state === 'save-error') actions.toast(notice.message);
  }, [notice?.at]);
  useEffect(() => {
    if (!jump) return;
    if (jump.line) reader.current?.scrollToLine?.(jump.line);
    else
      host.current
        ?.querySelector(`[data-outline="${jump.index}"]`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [jump]);

  return html`<div class="ss-desk-doc" ref=${host}></div>
    ${
      (loading || error) &&
      html`<div class="ss-empty ss-desk-canvas__state">
        <div class="ss-empty__icon">
          ${error ? html`<${Lucide} name="circle-alert" />` : html`<span class="ss-spin"></span>`}
        </div>
        <div class="ss-empty__title">${error ? t('这份文稿打不开') : t('正在打开…')}</div>
        ${error && html`<div class="ss-empty__text">${error}</div>`}
      </div>`
    }`;
}
