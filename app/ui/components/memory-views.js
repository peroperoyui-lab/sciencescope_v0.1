// Inbox decisions are edits to durable memory items. Each keyed card keeps its
// unsaved edit while the research event feed refreshes neighbouring candidates.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { researchLabel } from './research-fields.js';
import { MemoryEvidence } from './memory-evidence.js';
import { Info } from './info-tip.js';

/**
 * @param {{ item:any, selected:boolean, onSelect:(id:string,selected:boolean)=>void }} props
 * @returns {import('preact').VNode}
 */
function MemoryCandidate({ item, selected, onSelect }) {
  const actions = useActions();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function decide(status) {
    setBusy(true);
    setError('');
    try {
      await actions.updateMemory(item.id, {
        status,
        expectedRevision: item.revision,
        ...(editing ? { title, body } : {}),
      });
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const button = (text, run, primary = false) =>
    html`<button
      type="button"
      class=${`ss-btn ss-btn--sm${primary ? ' ss-btn--primary' : ''}`}
      disabled=${busy}
      onClick=${run}
    >
      ${t(text)}
    </button>`;
  return html`<article class="ss-item-card" data-rb-proposal=${item.id}>
    <div class="ss-item-card__head">
      <label class="ss-check"
        ><input
          type="checkbox"
          checked=${selected}
          aria-label=${t('选择候选记忆：{title}', { title: item.title })}
          onChange=${(event) => onSelect(item.id, event.currentTarget.checked)}
        /><span>${researchLabel(item.subtype)}</span></label
      >
      <span class="ss-tag ss-tag--warn">${t('待确认')}</span>
    </div>
    <h3 class="ss-item-card__title">${item.title}</h3>
    <div class="ss-prose" dangerouslySetInnerHTML=${{ __html: renderMarkdown(item.body) }}></div>
    <${MemoryEvidence} item=${item} />
    ${
      editing
        ? html`<form
            class="ss-item-card__form"
            onSubmit=${(event) => {
              event.preventDefault();
              decide('active');
            }}
          >
            <label class="ss-field">
              <span class="ss-field__label">${t('标题')}</span>
              <span class="ss-input"
                ><input
                  aria-label=${t('标题')}
                  required
                  value=${title}
                  onInput=${(event) => setTitle(event.currentTarget.value)}
              /></span>
            </label>
            <label class="ss-field">
              <span class="ss-field__label">${t('内容')}</span>
              <textarea
                class="ss-textarea"
                aria-label=${t('内容')}
                value=${body}
                onInput=${(event) => setBody(event.currentTarget.value)}
              ></textarea>
            </label>
            <div class="ss-item-card__actions ss-item-card__actions--solid">
              <button class="ss-btn ss-btn--sm ss-btn--primary" type="submit" disabled=${busy}>
                ${t('修改后接受')}
              </button>
              ${button('取消', () => setEditing(false))}
            </div>
          </form>`
        : html`<div class="ss-item-card__actions ss-item-card__actions--solid">
            ${button('接受', () => decide('active'), true)}
            ${button('修改后接受', () => setEditing(true))}
            ${button('拒绝', () => decide('rejected'))}
          </div>`
    }
    ${error && html`<p class="ss-field__error" role="alert">${error}</p>`}
  </article>`;
}

/**
 * @param {{ projectId:string|null, tab:string, onEdit:(item:any)=>void }} props
 * @returns {import('preact').VNode}
 */
export function MemoryViews({ projectId, tab, onEdit }) {
  const actions = useActions();
  const version = useAppState((state) => state.researchVersion);
  const [items, setItems] = useState([]);
  const [brief, setBrief] = useState({ text: '', refs: [] });
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    const work = tab === 'inbox' ? actions.memoryInbox(projectId) : actions.memoryBrief(projectId);
    work
      .then((result) => {
        if (!current) return;
        if (tab === 'inbox') {
          setItems(result.items);
          setSelected(
            (previous) =>
              new Set([...previous].filter((id) => result.items.some((item) => item.id === id))),
          );
        } else setBrief(result);
      })
      .catch((failure) => current && setError(failure.message))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [projectId, tab, version]);
  async function bulk(status) {
    setBusy(true);
    setError('');
    try {
      await actions.decideMemories([...selected], status);
      setSelected(new Set());
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  const choose = (id, checked) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  return html`<div class="ss-memory-view" data-memory-view=${tab}>
    ${error && html`<p class="ss-field__error" role="alert">${error}</p>`}
    ${loading && html`<p class="ss-muted" role="status">${t('正在读取…')}</p>`}
    ${
      tab === 'inbox'
        ? html`<div class="ss-toolbar">
              <button
                type="button"
                class="ss-btn ss-btn--sm"
                disabled=${busy || !selected.size}
                onClick=${() => bulk('active')}
              >
                ${t('接受所选')}
              </button>
              <button
                type="button"
                class="ss-btn ss-btn--sm"
                disabled=${busy || !selected.size}
                onClick=${() => bulk('rejected')}
              >
                ${t('拒绝所选')}
              </button>
            </div>
            <div class="ss-item-cards">
              ${items.map(
                (item) =>
                  html`<${MemoryCandidate}
                    key=${item.id}
                    item=${item}
                    selected=${selected.has(item.id)}
                    onSelect=${choose}
                  />`,
              )}
            </div>
            ${!items.length && !loading && html`<p class="ss-muted">${t('暂无记录')}</p>`}`
        : html`<div class="ss-block-head">
              <span class="ss-block-head__title">${t('项目简报')}</span>
              <${Info}
                text=${t('这是主专家在当前项目中实际收到的确认记忆简报。置顶且有效的记忆排在前面；不截断内容。')}
              />
            </div>
            <pre class="ss-memory-view__brief" data-rb-brief-text>${brief.text}</pre>
            <div class="ss-item-card__actions">
              ${brief.refs.map(
                (ref) =>
                  html`<button
                    type="button"
                    class="ss-btn ss-btn--ghost ss-btn--sm"
                    onClick=${() => onEdit({ id: ref.id ?? ref.itemId })}
                  >
                    ${t('编辑条目')} [@${ref.id ?? ref.itemId}]
                  </button>`,
              )}
            </div>`
    }
  </div>`;
}
