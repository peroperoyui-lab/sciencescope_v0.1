// The editing desk's page area. A project's docx, Markdown and TeX open in a
// desk session and are edited in place (U2): docx as a page, Markdown as
// source, TeX as source beside its live page (U6), where a click on a formula
// opens the formula editor and a compiled PDF can take the page's place.
// Typing is synced to the session; Save writes the project file. Versions,
// PDF and the Markdown rendered view stay read-only for now
// (docs/architecture/EDITING_DESK.md §10).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { countWords } from '../desk-blocks.js';
import { createDeskSession } from '../desk-session.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { formulaSource } from '../tex-render.js';
import { DeskFormula } from './desk-formula.js';

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

/** Outline levels counted from the shallowest heading. @param {{level:number}[]} outline */
function levelled(outline) {
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
 *   onReady?: () => void, onRemoved?: (items: {id:string,type:string}[]) => void,
 *   onView?: (view: string) => void }} props
 * `jump` is the outline entry to scroll to; `pdf` receives the PDF reader's controls;
 * `editing` receives the editor's commands, and `onEdit` its state for the ribbon.
 * A TeX page switches between source, split and rendered without reopening.
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
  onView,
}) {
  const actions = useActions();
  // The tex page: its split view, render pane and compiled PDF (see mountEditor).
  const tex = useRef(/** @type {any} */ (null));
  const viewRef = useRef(view);
  viewRef.current = view;
  const [formula, setFormula] = useState(/** @type {any} */ (null));
  const [compileErrors, setCompileErrors] = useState(/** @type {any} */ (null));
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
      const docx = tab.format === 'docx';
      const latex = tab.format === 'tex';
      const format = latex ? 'latex' : 'markdown';
      // tex: source | rule | render pane, with the compiled PDF over the pane.
      const split = document.createElement('div');
      const pane = document.createElement('div');
      const page = document.createElement('article');
      const pdfHost = document.createElement('div');
      if (latex) {
        split.className = 'ss-split ss-desk-split';
        split.dataset.view = viewRef.current;
        const rule = document.createElement('div');
        rule.className = 'ss-split__rule';
        pane.className = 'ss-split__render';
        page.className = 'ss-page ss-page--tex';
        pdfHost.className = 'ss-desk-pdf reader-pdf';
        pdfHost.hidden = true;
        pane.append(page);
        split.append(surface, rule, pane, pdfHost);
        root.replaceChildren(split);
      } else root.replaceChildren(surface);
      let editor;
      let texRender = null;
      let texOutline = [];
      let pdfReader = null;
      let state = { marks: [], undo: false, redo: false };
      let status = { state: 'saved' };
      let compiling = { compiling: false, pdf: false, showing: false, result: null };
      const publish = () =>
        active &&
        onEdit({ format: tab.format, ...state, status, ...(latex ? { tex: compiling } : {}) });
      const info = () => {
        clearTimeout(infoTimer);
        infoTimer = setTimeout(() => {
          if (!active) return;
          onInfo({
            outline: docx
              ? editor.outline()
              : latex
                ? texOutline
                : sourceOutline(editor.text(), format),
            words: editor.words(),
          });
        }, 300);
      };
      let cursorFrame = 0;
      const handlers = {
        onChange: () => {
          session.current?.changed();
          info();
        },
        onState: (next) => {
          state = next;
          publish();
        },
        onSelection: () => {
          onSelection?.();
          if (docx) return;
          cancelAnimationFrame(cursorFrame);
          cursorFrame = requestAnimationFrame(
            () => active && onInfo({ cursor: editor.lineColumn() }),
          );
        },
        onDoc: () => texRender?.changed(),
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
      if (latex) {
        const { mountTexRender } = await import('../readers/tex-split.js');
        if (!active) {
          editor.dispose();
          return;
        }
        texRender = mountTexRender(pane, page, editor, {
          visible: () => ({
            source: split.dataset.view !== 'rendered',
            render: split.dataset.view !== 'source' && !compiling.showing,
          }),
          onRender: (outline) => {
            texOutline = levelled(
              outline.map((entry) => ({ ...entry, line: editor.lineAt(entry.from) })),
            );
            if (active) onInfo({ outline: texOutline });
          },
          onFormula: (found) => {
            if (found.rows) {
              if (split.dataset.view !== 'rendered') editor.revealAt(found.from);
              else actions.toast(t('多行公式请在源码里改，切到「并排」可以看到它'));
              return;
            }
            found.box.setAttribute('data-active', '');
            setFormula({
              ...found,
              source: editor.plain().slice(found.from, found.to),
              rect: found.box.getBoundingClientRect(),
            });
          },
        });
      }
      const setCompile = (next) => {
        compiling = { ...compiling, ...next };
        publish();
      };
      // The compiled PDF takes the render pane's place until switched back.
      const showPdf = (show) => {
        setCompile({ showing: show });
        pdfHost.hidden = !show;
        split.toggleAttribute('data-pdf', show);
        if (!show) texRender?.refresh();
      };
      // The main file chosen when several include this one, kept for the session.
      let texRoot;
      const compileOnce = async () => {
        try {
          return await actions.compileDesk(opened.session.id, texRoot ? { root: texRoot } : {});
        } catch (failure) {
          const candidates = failure.details?.candidates;
          if (failure.code !== 'DESK_TEX_ROOT' || !candidates) throw failure;
          if (!candidates.length)
            throw new Error(
              t(
                '没找到包含这份文稿的主文件（写了 {command} 的 .tex），请先建一个，或在文稿开头写 {root}',
                {
                  command: '\\documentclass',
                  root: '% !TEX root = main.tex',
                },
              ),
            );
          const choice = await ask({
            title: t('用哪个主文件编译？'),
            text: t('有几份主文件都包含这份文稿。选一个，这次打开期间都用它。'),
            options: candidates.map((file, index) => ({
              value: file,
              label: file,
              primary: index === 0,
            })),
          });
          if (!choice) return null;
          texRoot = choice;
          return actions.compileDesk(opened.session.id, { root: texRoot });
        }
      };
      const compile = async () => {
        if (compiling.compiling) return;
        setCompile({ compiling: true });
        setCompileErrors(null);
        try {
          const result = await compileOnce();
          if (!result) return;
          if (!active) return;
          setCompile({ result });
          if (result.status === 'ok' && result.pdf) {
            const bytes = await actions.deskPdf(opened.session.id);
            if (!active) return;
            pdfReader?.dispose();
            const { mountPdf } = await import('../readers/pdf.js');
            if (!active) return;
            // Shown first, so the PDF is laid out at the pane's width.
            if (split.dataset.view === 'source') onView?.('split');
            setCompile({ pdf: true });
            showPdf(true);
            pdfReader = await mountPdf(pdfHost, bytes, { onPage: () => {} });
          } else setCompileErrors(result);
        } catch (failure) {
          if (active) actions.toast(failure.message);
        } finally {
          if (active) setCompile({ compiling: false });
        }
      };
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
        ...(latex
          ? {
              compile,
              togglePdf: () => compiling.pdf && showPdf(!compiling.showing),
              /** The ribbon's 公式: a new formula at the cursor. @param {DOMRect} rect */
              newFormula: (rect) =>
                setFormula({
                  insert: true,
                  source: '',
                  number: '',
                  line: editor.lineColumn().line,
                  rect,
                }),
            }
          : {}),
      };
      tex.current = latex
        ? {
            editor,
            setView(next) {
              split.dataset.view = next;
              /** @type {any} */ (editor).view.requestMeasure();
              if (next !== 'source') requestAnimationFrame(() => texRender?.refresh());
            },
          }
        : null;
      setSessionId(opened.session.id);
      onSession(opened.session.id);
      onInfo({
        outline: docx
          ? editor.outline()
          : latex
            ? texOutline
            : sourceOutline(editor.text(), format),
        words: editor.words(),
        ...(docx ? {} : { cursor: editor.lineColumn() }),
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
              texRender?.dispose();
              pdfReader?.dispose();
              editor.dispose();
              for (const url of pictures.values()) url.then(URL.revokeObjectURL, () => {});
            });
        },
        scrollToLine(number) {
          if (!texRender) return editor.scrollToLine(number);
          if (split.dataset.view === 'rendered') return texRender.scrollToLine(number);
          editor.scrollToLine(number);
          texRender.sync();
        },
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
      tex.current = null;
      setFormula(null);
      setCompileErrors(null);
      setSessionId(null);
      onEdit(null);
    };
    // A tex page changes its view in place; Markdown's rendered view is another reader.
  }, [tab.key, tab.format === 'md' ? view : '', reload]);

  useEffect(() => tex.current?.setView(view), [view]);

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

  const closeFormula = () => {
    formula?.box?.removeAttribute('data-active');
    setFormula(null);
  };
  /** Write the edited formula back as one change, unless its source moved meanwhile. */
  const applyFormula = (latex) => {
    const editor = tex.current?.editor;
    if (!editor) return closeFormula();
    if (formula.insert) {
      const { line } = editor.lineColumn();
      const text = editor.plain();
      const lines = text.split('\n');
      const start = lines.slice(0, line - 1).reduce((sum, item) => sum + item.length + 1, 0);
      const cursor = editor.view.state.selection.main;
      if (!lines[line - 1].trim())
        editor.replaceRange(
          start,
          start + lines[line - 1].length,
          `\\begin{equation}\n  ${latex}\n\\end{equation}`,
        );
      else editor.replaceRange(cursor.from, cursor.to, `$${latex}$`);
    } else if (editor.plain().slice(formula.from, formula.to) !== formula.source)
      actions.toast(t('这个公式在源码里变过，请重新点开它'));
    else editor.replaceRange(formula.from, formula.to, formulaSource(formula.source, latex));
    closeFormula();
  };
  /** @param {{file:string,line:number|null}} problem */
  const goToError = (problem) => {
    const editor = tex.current?.editor;
    if (!editor || problem.line == null) return;
    if (problem.file !== tab.path) {
      actions.toast(t('这处错误在 {file}', { file: problem.file }));
      return;
    }
    if (viewRef.current === 'rendered') onView?.('split');
    const lines = editor.plain().split('\n');
    editor.revealAt(
      lines.slice(0, problem.line - 1).reduce((sum, item) => sum + item.length + 1, 0),
    );
  };

  return html`<div class="ss-desk-doc" ref=${host}></div>
    ${
      formula &&
      html`<${DeskFormula}
        key=${`${formula.from}:${formula.insert ? 'new' : ''}`}
        formula=${formula}
        onApply=${applyFormula}
        onClose=${closeFormula}
      />`
    }
    ${
      compileErrors &&
      html`<div class="ss-callout ss-callout--danger ss-desk-compile" role="alert">
        <${Lucide} name="circle-alert" />
        <div class="ss-callout__body">
          <div class="ss-callout__title">
            ${compileErrors.status === 'timeout' ? t('编译超时') : t('编译没有成功')}
          </div>
          <ul class="ss-callout__details">
            ${compileErrors.errors.slice(0, 6).map(
              (problem, index) =>
                html`<li key=${index}>
                  <button
                    type="button"
                    class="ss-desk-compile__line"
                    disabled=${problem.line == null}
                    onClick=${() => goToError(problem)}
                  >
                    ${
                      problem.line == null
                        ? problem.file
                        : t('{file} 第 {n} 行', { file: problem.file, n: problem.line })
                    }
                  </button>
                  <span>${problem.message}</span>
                </li>`,
            )}
          </ul>
        </div>
        <button
          type="button"
          class="ss-icon-btn ss-icon-btn--sm"
          aria-label=${t('关闭')}
          data-tip=${t('关闭')}
          onClick=${() => setCompileErrors(null)}
        >
          <${Lucide} name="x" />
        </button>
      </div>`
    }
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
