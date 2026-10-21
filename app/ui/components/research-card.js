import { html } from '../html.js';
import { renderMarkdown, renderFormula } from '../markdown.js';
import { t } from '../i18n/index.js';
import { MemoryEvidence } from './memory-evidence.js';
import { researchLabel } from './research-fields.js';

/** @param {{item:any,onAction:(action:string,item:any)=>void}} props */
export function ResearchCard({ item, onAction }) {
  const button = (text, action) =>
    html`<button type="button" class="btn tiny" onClick=${() => onAction(action, item)}>
      ${t(text)}
    </button>`;
  return html`<article class="card rb-card" data-rb-item=${item.id}>
    <div class="between">
      <h3>${item.title}</h3>
      <span class="badge">${researchLabel(item.status)}</span>
    </div>
    <small>${researchLabel(item.subtype)} · r${item.revision}</small>
    <div
      class="rendered-markdown"
      dangerouslySetInnerHTML=${{ __html: renderMarkdown(item.body) }}
    ></div>
    <${ResearchPayload} item=${item} />
    ${item.supersededBy && html`<div><button class="btn tiny" onClick=${() => onAction('detail', { id: item.supersededBy })}>${t('查看取代记录')}</button></div>`}
    ${item.type === 'memory' && html`<${MemoryEvidence} item=${item} />`}
    <div class="rb-row-actions">
      ${button('编辑', 'edit')}${button(item.pinned ? '取消置顶' : '置顶', 'pin')}${item.status === 'active' && html`${button('归档', 'archive')}${button('取代', 'supersede')}`}${button('修订历史', 'history')}
    </div>
  </article>`;
}
/** Structured parts of a model or claim: formula, variables, assumptions, steps, state. @param {{item:any}} props */
export function ResearchPayload({ item }) {
  const payload = item.payload ?? {};
  return html`${item.type === 'claim' && html`<span class="badge">${researchLabel(payload.claimStatus ?? 'hypothesis')}</span>`}
  ${
    item.type === 'model' &&
    html`${payload.latex && html`<div class="rb-latex" aria-label=${t('公式')} dangerouslySetInnerHTML=${{ __html: renderFormula(payload.latex) }}></div>`}${
      payload.variables?.length > 0 &&
      html`<table class="table">
        <thead>
          <tr>
            <th>${t('符号')}</th>
            <th>${t('含义')}</th>
            <th>${t('单位')}</th>
          </tr>
        </thead>
        <tbody>
          ${payload.variables.map(
            (variable) =>
              html`<tr>
                <td>${variable.symbol}</td>
                <td>${variable.meaning}</td>
                <td>${variable.unit}</td>
              </tr>`,
          )}
        </tbody>
      </table>`
    }${
      payload.assumptions?.length > 0 &&
      html`<h4>${t('假设')}</h4>
        <ul>
          ${payload.assumptions.map((assumption) => html`<li>${assumption}</li>`)}
        </ul>`
    }${
      payload.steps?.length > 0 &&
      html`<h4>${t('步骤')}</h4>
        <ol>
          ${payload.steps.map((step) => html`<li>${step}</li>`)}
        </ol>`
    }`
  }`;
}
/** @param {{detail:any}} props */
export function ResearchHistory({ detail }) {
  return html`<div class="rb-dialog" data-rb-history>
    ${[
      ...detail.revisions,
      { revision: detail.item.revision, snapshot: detail.item, changedAt: detail.item.updatedAt },
    ].map(
      (revision) =>
        html`<article class="card">
          <strong>r${revision.revision}</strong> <small>${revision.changedAt}</small>
          <div
            class="rendered-markdown"
            dangerouslySetInnerHTML=${{ __html: renderMarkdown(revision.snapshot.body) }}
          ></div>
          <pre>${JSON.stringify(revision.snapshot, null, 2)}</pre>
        </article>`,
    )}
  </div>`;
}
