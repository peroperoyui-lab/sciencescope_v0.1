import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { authorText, researchLabel } from './research-fields.js';

/** @param {{sourceId:string,focusChunkId?:string,ordinal?:number}} props */
export function ResearchSourceDetail({ sourceId, focusChunkId, ordinal = 0 }) {
  const actions = useActions();
  const version = useAppState((state) => state.researchVersion);
  const [offset, setOffset] = useState(Math.floor(ordinal / 20) * 20);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const body = useRef(null);
  useEffect(() => {
    let current = true;
    actions
      .researchSource(sourceId, { offset, limit: 20 })
      .then((result) => {
        if (current) {
          setDetail(result);
          setError('');
        }
      })
      .catch((caught) => {
        if (current) setError(caught.message);
      });
    return () => {
      current = false;
    };
  }, [sourceId, offset, version]);
  useEffect(() => {
    body.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'center' });
  }, [detail]);
  const source = detail?.source;
  const metadata = source?.metadata ?? {};
  return html`<div class="rb-dialog" ref=${body} data-rb-source-detail>
    ${error && html`<p role="alert">${error}</p>`}
    ${!source && !error && html`<p role="status">${t('正在读取…')}</p>`}
    ${
      source &&
      html`<h3>${source.title}</h3>
        <button
          class="btn tiny"
          onClick=${() => {
            actions.closeModal();
            actions.openPreview({ kind: 'source', id: source.id });
          }}
        >
          ${t('预览')}
        </button>
        <section class="card">
          <h4>${t('来源信息')}</h4>
          <dl class="rb-source-info">
            <dt>${t('标签')}</dt>
            <dd>${source.label}</dd>
            <dt>${t('作者')}</dt>
            <dd>${authorText(metadata.authors) || '—'}</dd>
            <dt>${t('年份')}</dt>
            <dd>${metadata.year ?? '—'}</dd>
            <dt>${t('期刊或来源')}</dt>
            <dd>${metadata.venue ?? '—'}</dd>
            <dt>${t('类型')}</dt>
            <dd>${researchLabel(source.kind)}</dd>
            <dt>${t('原件')}</dt>
            <dd>${source.name ?? '—'}</dd>
            <dt>${t('解析状态')}</dt>
            <dd>${researchLabel(source.contentStatus)} ${source.parser ?? ''}</dd>
          </dl>
          ${source.parseError && html`<p role="alert">${source.parseError}</p>`}
        </section>
        <h4>${t('段落')}</h4>
        ${detail.chunks.map(
          (chunk) =>
            html`<article
              class="card rb-passage"
              data-chunk-id=${chunk.id}
              data-focused=${chunk.id === focusChunkId ? 'true' : 'false'}
            >
              <div class="between">
                <strong
                  >${chunk.page != null ? t('第 {page} 页', { page: chunk.page }) : chunk.section || t('段落 {number}', { number: chunk.ordinal + 1 })}</strong
                ><button
                  class="btn tiny"
                  onClick=${() =>
                    actions.attempt(async () => {
                      await navigator.clipboard.writeText(chunk.citation);
                      actions.toast(t('引用已复制。'));
                    })}
                >
                  ${t('复制引用')}
                </button>
              </div>
              ${chunk.section && html`<small>${chunk.section}</small>`}
              <p class="rb-passage-text">${chunk.text}</p>
              <code>${chunk.citation}</code>
            </article>`,
        )}${!detail.total && html`<div class="empty">${t('暂无可读取的段落')}</div>`}
        <div class="rb-pagination">
          <button
            class="btn tiny"
            disabled=${offset === 0}
            onClick=${() => setOffset(Math.max(0, offset - 20))}
          >
            ${t('上一页')}</button
          ><span
            >${detail.chunks.length ? offset + 1 : 0}–${offset + detail.chunks.length} /
            ${detail.total}</span
          ><button
            class="btn tiny"
            disabled=${!detail.remaining}
            onClick=${() => setOffset(offset + 20)}
          >
            ${t('下一页')}
          </button>
        </div>`
    }
  </div>`;
}
