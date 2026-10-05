// Popups over the window, in the old interface's markup: the menu
// (`.menu-popup`), dialogs (`.modalback > .modal`), the toast and the search
// palette (`.command-palette`). Their state lives in `state.overlay`.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Icon } from '../icons.js';
import { navigate } from '../route.js';

function MenuLayer() {
  const actions = useActions();
  const menu = useAppState((state) => state.overlay.menu);
  const element = useRef(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  // Keep the menu inside the window, flipping above the trigger when needed.
  useLayoutEffect(() => {
    if (!menu || !element.current) return;
    const { offsetWidth, offsetHeight } = element.current;
    let top = menu.y;
    if (top + offsetHeight > innerHeight - 15) top = Math.max(42, menu.y - offsetHeight - 40);
    setPosition({ left: Math.max(8, Math.min(menu.x, innerWidth - offsetWidth - 10)), top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (!element.current?.contains(event.target)) actions.closeMenu();
    };
    const escape = (event) => event.key === 'Escape' && actions.closeMenu();
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);

  if (!menu) return null;
  return html`<div
    id="v-menu"
    class="menu-popup"
    role="menu"
    aria-label=${menu.label || t('快捷菜单')}
    ref=${element}
    style=${{ left: `${position.left}px`, top: `${position.top}px` }}
  >
    ${menu.label && html`<div class="menu-label">${menu.label}</div>`}
    ${menu.items.map((item, index) =>
      item.sep
        ? html`<hr class="menu-sep" key=${index} />`
        : html`<button
            key=${index}
            role=${item.check === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked=${item.check === undefined ? undefined : String(item.check)}
            class=${`menu-line ${item.danger ? 'danger' : ''}`}
            onClick=${() => {
              actions.closeMenu();
              item.run();
            }}
          >
            ${
              item.check === undefined
                ? html`<${Icon} name=${item.icon ?? 'right'} />`
                : html`<span class="menu-check">${item.check ? '✓' : ''}</span>`
            }
            <span class="menu-text">${item.text}</span>
            ${item.key && html`<kbd>${item.key}</kbd>`}
          </button>`,
    )}
  </div>`;
}

function ModalLayer() {
  const actions = useActions();
  const modal = useAppState((state) => state.overlay.modal);
  useEffect(() => {
    if (!modal) return undefined;
    const escape = (event) => event.key === 'Escape' && actions.closeModal();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [modal]);
  if (!modal) return null;
  return html`<div
    id="modal"
    class="modalback"
    onPointerDown=${(event) => event.target === event.currentTarget && actions.closeModal()}
  >
    <section class="modal" role="dialog" aria-modal="true" aria-label=${modal.title}>
      <button
        class="iconbtn close"
        title=${t('关闭')}
        aria-label=${t('关闭')}
        onClick=${actions.closeModal}
      >
        <${Icon} name="close" />
      </button>
      <h2>${modal.title}</h2>
      ${modal.body}
    </section>
  </div>`;
}

/**
 * A dialog body with one text field (new project, rename…).
 * @param {{ label: string, value?: string, submitText?: string,
 *   onSubmit: (value: string) => Promise<any> | void }} props
 */
export function FieldForm({ label, value = '', submitText, onSubmit }) {
  const actions = useActions();
  const [text, setText] = useState(value);
  const input = useRef(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  async function submit(event) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    actions.closeModal();
    await actions.attempt(async () => onSubmit(trimmed));
  }
  return html`<form onSubmit=${submit}>
    <div class="field">
      <label class="label">${label}</label>
      <input ref=${input} value=${text} onInput=${(event) => setText(event.currentTarget.value)} />
    </div>
    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn" onClick=${actions.closeModal}>${t('取消')}</button>
      <button type="submit" class="btn primary" disabled=${!text.trim()}>
        ${submitText ?? t('确定')}
      </button>
    </div>
  </form>`;
}

function ToastLayer() {
  const toast = useAppState((state) => state.overlay.toast);
  return toast ? html`<div class="toast" role="status">${toast}</div>` : null;
}

/** Search projects, meetings and message text; Enter opens the selection. */
function Palette() {
  const actions = useActions();
  const open = useAppState((state) => state.overlay.palette);
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [selected, setSelected] = useState(0);

  // Start empty next time; resetting on open could race with the first keystrokes.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setSelected(0);
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setFound([]);
      return undefined;
    }
    let current = true;
    const timer = setTimeout(() => {
      actions
        .search(query.trim())
        .then((result) => current && setFound(result.messages))
        .catch(() => {});
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  if (!open) return null;
  const lower = query.trim().toLowerCase();
  const items = [
    ...projects
      .filter((project) => !project.archived && project.name.toLowerCase().includes(lower))
      .map((project) => ({
        label: project.name,
        category: t('项目'),
        icon: 'folder',
        run: () => navigate({ view: 'workbench', id: project.id }),
      })),
    ...meetings
      .filter((meeting) => !meeting.archived && meeting.title.toLowerCase().includes(lower))
      .map((meeting) => ({
        label: meeting.title,
        category: t('对话'),
        icon: 'chat',
        run: () => navigate({ view: 'meeting', id: meeting.id }),
      })),
    ...found.map((hit) => ({
      label: hit.snippet,
      category: meetings.find((meeting) => meeting.id === hit.meetingId)?.title ?? t('对话'),
      icon: 'search',
      run: () => navigate({ view: 'meeting', id: hit.meetingId }),
    })),
  ].slice(0, 40);
  const index = Math.min(selected, Math.max(0, items.length - 1));
  const choose = (item) => {
    actions.closePalette();
    item?.run();
  };

  return html`<section
    id="command-palette"
    class="command-palette"
    role="dialog"
    aria-label=${t('搜索与命令')}
  >
    <div class="command-input">
      <${Icon} name="search" />
      <input
        autofocus
        value=${query}
        placeholder=${t('搜索项目、对话或消息…')}
        aria-label=${t('搜索与命令')}
        onInput=${(event) => {
          setQuery(event.currentTarget.value);
          setSelected(0);
        }}
        onKeyDown=${(event) => {
          if (event.key === 'Escape') actions.closePalette();
          if (event.key === 'ArrowDown') setSelected(Math.min(index + 1, items.length - 1));
          if (event.key === 'ArrowUp') setSelected(Math.max(index - 1, 0));
          if (event.key === 'Enter' && !event.isComposing) choose(items[index]);
        }}
        onBlur=${() => setTimeout(actions.closePalette, 150)}
      />
      <kbd>Esc</kbd>
    </div>
    <div class="command-results" role="listbox">
      ${
        items.length
          ? items.map(
              (item, n) =>
                html`<button
                  key=${n}
                  role="option"
                  aria-selected=${n === index}
                  class=${n === index ? 'sel' : ''}
                  onMouseDown=${(event) => event.preventDefault()}
                  onClick=${() => choose(item)}
                >
                  <${Icon} name=${item.icon} />
                  <span class="grow">
                    ${item.label}
                    <small style="display:block;margin-top:4px">${item.category}</small>
                  </span>
                </button>`,
            )
          : html`<div class="empty">${t('没有匹配项')}</div>`
      }
    </div>
    <div class="palette-foot">
      <span>↑ ↓ ${t('选择')}</span><span>Enter ${t('打开')}</span><span>Esc ${t('关闭')}</span>
    </div>
  </section>`;
}

export function Overlays() {
  return html`<${MenuLayer} /><${ModalLayer} /><${ToastLayer} /><${Palette} />`;
}
