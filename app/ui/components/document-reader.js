import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';

/**
 * @param {{doc:any,target:any}} props
 */
export function DocumentReader({ doc, target }) {
  const actions = useActions();
  const surface = useRef(null);
  const reader = useRef(null);
  const [page, setPage] = useState(target.page ?? 1);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState('readable');
  useEffect(() => {
    let active = true;
    const host = surface.current;
    const detached = document.createElement('div');
    detached.className = 'reader-surface';
    host.replaceChildren(detached);
    if (doc.format === 'image') {
      const image = document.createElement('img');
      image.src = actions.previewContent(target);
      image.alt = doc.name;
      detached.append(image);
    }
    const bytes = () => actions.previewBytes(target);
    const mount = async () => {
      let mounted;
      if (doc.format === 'pdf') {
        const { mountPdf } = await import('../readers/pdf.js');
        if (!active) return;
        mounted = await mountPdf(detached, await bytes(), {
          ...target,
          onPage: (next, count) => {
            if (active) {
              setPage(next);
              setTotal(count);
            }
          },
        });
      } else {
        const { mountDocument } = await import('../readers/document.js');
        if (!active) return;
        mounted = await mountDocument(detached, doc, mode, bytes);
        if (mounted.rows != null && active) setRows(mounted);
      }
      if (!active) mounted.dispose();
      else {
        reader.current = mounted;
        if (target.highlight && doc.format !== 'pdf')
          actions.highlightPreview(detached, target.highlight);
      }
    };
    if (doc.format !== 'image')
      mount().catch((failure) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
      reader.current?.dispose();
      reader.current = null;
    };
  }, [doc, mode]);
  useEffect(() => {
    reader.current?.focus?.(target);
  }, [target.page, target.highlight]);
  function go(next) {
    reader.current?.focus({ page: next, highlight: target.highlight });
  }
  return html`<div
    class="document-reader"
    data-reader-format=${doc.format}
    data-source-id=${doc.source?.id}
  >
    <div class="reader-controls">
      ${doc.format === 'pdf' && html`<button class="btn tiny" onClick=${() => go(page - 1)}>${t('上一页')}</button><input data-reader-page type="number" min="1" max=${total} value=${page} aria-label=${t('页码')} onChange=${(event) => go(Number(event.currentTarget.value))} /><span>/ ${total}</span><button class="btn tiny" onClick=${() => go(page + 1)}>${t('下一页')}</button><button class="btn tiny" onClick=${() => reader.current?.zoom(1 / 1.2)}>${t('缩小')}</button><button class="btn tiny" onClick=${() => reader.current?.zoom(1.2)}>${t('放大')}</button>`}
      ${['markdown', 'latex', 'docx'].includes(doc.format) && html`<button class="btn tiny" onClick=${() => setMode(doc.format === 'latex' ? 'formulas' : 'readable')}>${t(doc.format === 'latex' ? '公式' : '正文')}</button><button class="btn tiny" onClick=${() => setMode(doc.format === 'docx' ? 'layout' : 'source')}>${t(doc.format === 'docx' ? '原始版式' : '源码')}</button>`}
    </div>
    ${rows && html`<p>${t('共 {total} 行，显示前 {shown} 行', { total: rows.rows, shown: rows.shown })}</p>`}
    <div
      class="reader-host"
      ref=${surface}
      data-preview-doc
      data-resource-id=${doc.source?.id}
    ></div>
    ${error && html`<p role="alert">${error}</p>`}
  </div>`;
}
