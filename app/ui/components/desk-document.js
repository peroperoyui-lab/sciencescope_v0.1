// The editing desk's page area. U1 shows documents read-only through the
// existing readers; the ProseMirror editor replaces the docx and Markdown page
// in U2 (docs/architecture/EDITING_DESK.md §10).
import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

const PAGE_HEADINGS = 'h1, h2, h3, h4';
const TEX_HEADING =
  /^\s*\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{(.+)\}/u;
const TEX_LEVELS = { part: 0, chapter: 0, section: 1, subsection: 2, subsubsection: 3 };

/**
 * Characters for Chinese and Japanese text, words for the rest.
 * @param {string} text
 */
export function countWords(text) {
  const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const characters = text.match(wide)?.length ?? 0;
  const words = text.replace(wide, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return characters + (words?.length ?? 0);
}

/**
 * Headings of a source file, with their 1-based line.
 * @param {string} text @param {'latex' | 'markdown'} format
 */
function sourceOutline(text, format) {
  const outline = [];
  text.split('\n').forEach((line, index) => {
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

/**
 * @param {{ tab: any, view: string, jump: any, onInfo: (info: any) => void, pdf: any }} props
 * `jump` is the outline entry to scroll to; `pdf` receives the PDF reader's controls.
 */
export function DeskDocument({ tab, view, jump, onInfo, pdf }) {
  const actions = useActions();
  const host = useRef(/** @type {HTMLElement | null} */ (null));
  const reader = useRef(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const target =
    tab.kind === 'version'
      ? { kind: 'version', id: tab.id }
      : { kind: 'project', projectId: tab.projectId, path: tab.path };

  useEffect(() => {
    let active = true;
    const root = host.current;
    setError('');
    setLoading(true);
    onInfo({ outline: [], words: null, page: null, pages: null });
    const mount = async () => {
      const doc = await actions.previewDocument(target);
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
    mount()
      .catch((failure) => active && setError(failure.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
      reader.current?.dispose();
      reader.current = null;
      pdf.current = null;
    };
  }, [tab.key, view]);

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
