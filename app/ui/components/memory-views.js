// Inbox decisions are edits to durable memory items. Each keyed card keeps its
// unsaved edit while the research event feed refreshes neighbouring candidates.
import { useEffect, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { renderMarkdown } from '../markdown.js';
import { researchLabel } from './research-fields.js';
import { MemoryEvidence } from './memory-evidence.js';
import { InfoTip } from './info-tip.js';

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
  return html`<article class="card rb-card" data-rb-proposal=${item.id}>
    <div class="between">
      <label
        ><input
          type="checkbox"
          checked=${selected}
          aria-label=${t('选择候选记忆：{title}', { title: item.title })}
          onChange=${(event) => onSelect(item.id, event.currentTarget.checked)}
        />
        ${researchLabel(item.subtype)}</label
      >
      <span class="badge">${t('待确认')}</span>
    </div>
    <h3>${item.title}</h3>
    <div
      class="rendered-markdown"
      dangerouslySetInnerHTML=${{ __html: renderMarkdown(item.body) }}
    ></div>
    <${MemoryEvidence} item=${item} />
    ${
      editing
        ? html`<form
            onSubmit=${(event) => {
              event.preventDefault();
              decide('active');
            }}
          >
            <label class="field"
              >${t('标题')}<input
                aria-label=${t('标题')}
                required
                value=${title}
                onInput=${(event) => setTitle(event.currentTarget.value)}
            /></label>
            <label class="field"
              >${t('内容')}<textarea
                aria-label=${t('内容')}
                value=${body}
                onInput=${(event) => setBody(event.currentTarget.value)}
              ></textarea>
            </label>
            <button class="btn tiny primary" type="submit" disabled=${busy}>
              ${t('修改后接受')}
            </button>
            <button
              class="btn tiny"
              type="button"
              disabled=${busy}
              onClick=${() => setEditing(false)}
            >
              ${t('取消')}
            </button>
          </form>`
        : html`<div class="rb-row-actions">
            <button class="btn tiny" disabled=${busy} onClick=${() => decide('active')}>
              ${t('接受')}
            </button>
            <button class="btn tiny" disabled=${busy} onClick=${() => setEditing(true)}>
              ${t('修改后接受')}
            </button>
            <button class="btn tiny" disabled=${busy} onClick=${() => decide('rejected')}>
              ${t('拒绝')}
            </button>
          </div>`
    }
    <p role="alert">${error}</p>
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
  return html`<div data-memory-view=${tab}>
    ${error && html`<p role="alert">${error}</p>`}
    ${loading && html`<p role="status">${t('正在读取…')}</p>`}
    ${
      tab === 'inbox'
        ? html`<div class="rb-row-actions">
              <button
                class="btn tiny"
                disabled=${busy || !selected.size}
                onClick=${() => bulk('active')}
              >
                ${t('接受所选')}
              </button>
              <button
                class="btn tiny"
                disabled=${busy || !selected.size}
                onClick=${() => bulk('rejected')}
              >
                ${t('拒绝所选')}
              </button>
            </div>
            <div class="rb-cards">
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
            ${!items.length && !loading && html`<div class="empty">${t('暂无记录')}</div>`}`
        : html`<div class="between">
              <span>${t('项目简报')}</span>
              <${InfoTip}
                text=${t('这是主专家在当前项目中实际收到的确认记忆简报。置顶且有效的记忆排在前面；不截断内容。')}
              />
            </div>
            <pre class="rb-brief" data-rb-brief-text>${brief.text}</pre>
            <div class="rb-row-actions">
              ${brief.refs.map(
                (ref) =>
                  html`<button
                    class="btn tiny"
                    onClick=${() => onEdit({ id: ref.id ?? ref.itemId })}
                  >
                    ${t('编辑条目')} [@${ref.id ?? ref.itemId}]
                  </button>`,
              )}
            </div>`
    }
  </div>`;
}
