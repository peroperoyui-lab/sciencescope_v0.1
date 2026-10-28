import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { findMarkRange, markHighlight } from '../mark-ranges.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';

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
  const drafts = useAppState((state) => state.researchDrafts);
  useEffect(() => {
    const root = surface.current;
    const refresh = () => {
      const selected = target.owner
        ? [drafts[target.owner] ?? { marks: [] }]
        : Object.values(drafts);
      const marks = selected
        .flatMap((draft) => draft.marks ?? [])
        .filter((mark) => mark.sourceId && mark.sourceId === doc.source?.id);
      markHighlight(
        'research-marks',
        marks.map((mark) => findMarkRange(root, mark.text)).filter(Boolean),
      );
    };
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true });
    refresh();
    return () => {
      observer.disconnect();
      markHighlight('research-marks', []);
    };
  }, [drafts, doc]);
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
  const modes =
    doc.format === 'latex'
      ? [
          ['formulas', t('公式')],
          ['source', t('源码')],
        ]
      : doc.format === 'docx'
        ? [
            ['readable', t('正文')],
            ['layout', t('原始版式')],
          ]
        : [
            ['readable', t('正文')],
            ['source', t('源码')],
          ];
  return html`<div
    class="ss-reader"
    data-reader-format=${doc.format}
    data-source-id=${doc.source?.id}
  >
    ${
      (doc.format === 'pdf' || ['markdown', 'latex', 'docx'].includes(doc.format)) &&
      html`<div class="ss-reader__bar">
        ${
          doc.format === 'pdf' &&
          html`<button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('上一页')}
              data-tip=${t('上一页')}
              onClick=${() => go(page - 1)}
            >
              <${Lucide} name="chevron-left" />
            </button>
            <span class="ss-input ss-input--sm ss-reader__page">
              <input
                data-reader-page
                type="number"
                min="1"
                max=${total}
                value=${page}
                aria-label=${t('页码')}
                onChange=${(event) => go(Number(event.currentTarget.value))}
              />
            </span>
            <span class="ss-muted">/ ${total}</span>
            <button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('下一页')}
              data-tip=${t('下一页')}
              onClick=${() => go(page + 1)}
            >
              <${Lucide} name="chevron-right" />
            </button>
            <span class="ss-toolbar__spacer"></span>
            <button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('缩小')}
              data-tip=${t('缩小')}
              onClick=${() => reader.current?.zoom(1 / 1.2)}
            >
              <${Lucide} name="zoom-out" />
            </button>
            <button
              type="button"
              class="ss-icon-btn ss-icon-btn--sm"
              aria-label=${t('放大')}
              data-tip=${t('放大')}
              onClick=${() => reader.current?.zoom(1.2)}
            >
              <${Lucide} name="zoom-in" />
            </button>`
        }
        ${
          doc.format !== 'pdf' &&
          html`<div class="ss-seg ss-seg--sm" role="group" aria-label=${t('显示方式')}>
            ${modes.map(
              ([value, text]) =>
                html`<button
                  type="button"
                  key=${value}
                  aria-pressed=${String(mode === value || (value === modes[0][0] && !modes.some(([other]) => other === mode)))}
                  onClick=${() => setMode(value)}
                >
                  ${text}
                </button>`,
            )}
          </div>`
        }
      </div>`
    }
    ${
      rows &&
      html`<p class="ss-muted ss-reader__note">
        ${t('共 {total} 行，显示前 {shown} 行', { total: rows.rows, shown: rows.shown })}
      </p>`
    }
    <div
      class="reader-host"
      ref=${surface}
      data-preview-doc
      data-resource-id=${doc.source?.id}
    ></div>
    ${error && html`<p class="ss-status ss-status--fail" role="alert">${error}</p>`}
  </div>`;
}
