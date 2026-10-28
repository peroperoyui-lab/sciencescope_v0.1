import { useEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
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
  return html`<div class="ss-dialog__body ss-source-detail" ref=${body} data-rb-source-detail>
    ${error && html`<p class="ss-field__error" role="alert">${error}</p>`}
    ${!source && !error && html`<p class="ss-muted" role="status">${t('正在读取…')}</p>`}
    ${
      source &&
      html`<div class="ss-source-detail__head">
          <h3 class="ss-source-detail__title">${source.title}</h3>
          <button
            type="button"
            class="ss-btn ss-btn--sm"
            onClick=${() => {
              actions.closeModal();
              actions.openPreview({ kind: 'source', id: source.id });
            }}
          >
            <${Lucide} name="eye" />${t('预览')}
          </button>
        </div>
        <section>
          <div class="ss-block-head">
            <span class="ss-block-head__title">${t('来源信息')}</span>
          </div>
          <dl class="ss-props">
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
            <dd class="ss-source-detail__wrap">${source.name ?? '—'}</dd>
            <dt>${t('解析状态')}</dt>
            <dd>${researchLabel(source.contentStatus)} ${source.parser ?? ''}</dd>
          </dl>
          ${source.parseError && html`<p class="ss-field__error" role="alert">${source.parseError}</p>`}
        </section>
        <section class="ss-source-detail__passages">
          <div class="ss-block-head">
            <span class="ss-block-head__title">${t('段落')}</span>
            <span class="ss-count">${detail.total}</span>
          </div>
          ${detail.chunks.map(
            (chunk) =>
              html`<article
                class="ss-passage"
                key=${chunk.id}
                data-chunk-id=${chunk.id}
                data-focused=${chunk.id === focusChunkId ? 'true' : 'false'}
              >
                <div class="ss-passage__head">
                  <strong
                    >${chunk.page != null ? t('第 {page} 页', { page: chunk.page }) : chunk.section || t('段落 {number}', { number: chunk.ordinal + 1 })}</strong
                  >
                  <button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    onClick=${() =>
                      actions.attempt(async () => {
                        await navigator.clipboard.writeText(chunk.citation);
                        actions.toast(t('引用已复制。'));
                      })}
                  >
                    <${Lucide} name="copy" />${t('复制引用')}
                  </button>
                </div>
                ${chunk.section && html`<span class="ss-passage__section">${chunk.section}</span>`}
                <p class="ss-passage__text">${chunk.text}</p>
                <code class="ss-passage__cite">${chunk.citation}</code>
              </article>`,
          )}
          ${!detail.total && html`<p class="ss-muted">${t('暂无可读取的段落')}</p>`}
        </section>
        <div class="ss-pager">
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('上一页')}
            data-tip=${t('上一页')}
            disabled=${offset === 0}
            onClick=${() => setOffset(Math.max(0, offset - 20))}
          >
            <${Lucide} name="chevron-left" />
          </button>
          <span class="ss-muted"
            >${detail.chunks.length ? offset + 1 : 0}–${offset + detail.chunks.length} /
            ${detail.total}</span
          >
          <button
            type="button"
            class="ss-icon-btn ss-icon-btn--sm"
            aria-label=${t('下一页')}
            data-tip=${t('下一页')}
            disabled=${!detail.remaining}
            onClick=${() => setOffset(offset + 20)}
          >
            <${Lucide} name="chevron-right" />
          </button>
        </div>`
    }
  </div>`;
}
