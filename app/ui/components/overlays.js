// Popups over the window in the design system: the menu (`ss-menu`), dialogs
// (`ss-dialog`), the toast and the search palette (`ss-cmd`). Their state lives in `state.overlay`.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { moveFocus } from './popover.js';
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
    if (top + offsetHeight > innerHeight - 8) top = Math.max(8, menu.y - offsetHeight - 36);
    setPosition({ left: Math.max(8, Math.min(menu.x, innerWidth - offsetWidth - 8)), top });
    /** @type {HTMLElement | null} */ (element.current.querySelector('[role^="menuitem"]'))?.focus({
      preventScroll: true,
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (!element.current?.contains(event.target)) actions.closeMenu();
    };
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      // Esc closes the menu first; it must not also stop a running answer.
      event.preventDefault();
      event.stopPropagation();
      actions.closeMenu();
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [menu]);

  if (!menu) return null;
  return html`<div
    id="v-menu"
    class="ss-menu"
    role="menu"
    aria-label=${menu.label || t('快捷菜单')}
    ref=${element}
    style=${{ left: `${position.left}px`, top: `${position.top}px` }}
    onKeyDown=${moveFocus}
  >
    ${menu.label && html`<div class="ss-menu__label ss-truncate">${menu.label}</div>`}
    ${menu.items.map((item, index) =>
      item.sep
        ? html`<div class="ss-menu__sep" role="separator" key=${index}></div>`
        : html`<button
            type="button"
            key=${index}
            role=${item.check === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked=${item.check === undefined ? undefined : String(item.check)}
            class=${`ss-menu__item ${item.danger ? 'ss-menu__item--danger' : ''}`}
            aria-disabled=${item.disabled ? 'true' : undefined}
            onClick=${() => {
              if (item.disabled) return;
              actions.closeMenu();
              item.run();
            }}
          >
            ${item.icon && html`<${Lucide} name=${item.icon} />`}
            <span class="ss-truncate">${item.text}</span>
            ${item.key && html`<span class="ss-menu__end">${item.key}</span>`}
            ${item.check !== undefined && html`<${Lucide} name="check" class="ss-menu__check" />`}
          </button>`,
    )}
  </div>`;
}

// Dialogs opened with actions.openModal(title, body, size). A body is either
// ModalForm (fields, then 取消 and the submit button) or its own ss-dialog__body.
function ModalLayer() {
  const actions = useActions();
  const modal = useAppState((state) => state.overlay.modal);
  useEffect(() => {
    if (!modal) return undefined;
    const opener = /** @type {HTMLElement | null} */ (document.activeElement);
    const escape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      actions.closeModal();
    };
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('keydown', escape, true);
      opener?.focus?.();
    };
  }, [modal]);
  if (!modal) return null;
  const size = SIZES[modal.className] ?? modal.className ?? '';
  return html`<div
    id="modal"
    class="ss-scrim"
    onPointerDown=${(event) => event.target === event.currentTarget && actions.closeModal()}
  >
    <section
      class=${`ss-dialog ${size ? `ss-dialog--${size}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label=${modal.title}
    >
      <div class="ss-dialog__head">
        <h2 class="ss-dialog__title">${modal.title}</h2>
        <button
          type="button"
          class="ss-icon-btn"
          aria-label=${t('关闭')}
          data-tip=${t('关闭')}
          data-kbd="Esc"
          onClick=${actions.closeModal}
        >
          <${Lucide} name="x" />
        </button>
      </div>
      ${modal.body}
    </section>
  </div>`;
}
// Older callers pass a class name; they map to the design system's sizes.
const SIZES = { 'minutes-modal': 'lg', wide: 'lg' };

/**
 * The usual modal body: fields, then 取消 and the submit button.
 * @param {{ onSubmit: () => void, submitText?: string, disabled?: boolean, danger?: boolean,
 *   aside?: any, children: any }} props
 */
export function ModalForm({
  onSubmit,
  submitText,
  disabled = false,
  danger = false,
  aside,
  children,
}) {
  const actions = useActions();
  const element = useRef(/** @type {HTMLFormElement | null} */ (null));
  useEffect(() => {
    /** @type {HTMLElement | null | undefined} */ (
      element.current?.querySelector('input, textarea, select')
    )?.focus();
  }, []);
  return html`<form
    ref=${element}
    class="ss-dialog__form"
    novalidate
    onSubmit=${(event) => {
      event.preventDefault();
      if (!disabled) onSubmit();
    }}
  >
    <div class="ss-dialog__body">${children}</div>
    <div class="ss-dialog__foot">
      ${aside && html`<span class="ss-dialog__aside">${aside}</span>`}
      <button type="button" class="ss-btn" onClick=${actions.closeModal}>${t('取消')}</button>
      <button
        type="submit"
        class=${`ss-btn ${danger ? 'ss-btn--danger' : 'ss-btn--primary'}`}
        disabled=${disabled}
      >
        ${submitText ?? t('确定')}
      </button>
    </div>
  </form>`;
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
    input.current?.select();
  }, []);
  return html`<${ModalForm}
    submitText=${submitText}
    disabled=${!text.trim()}
    onSubmit=${async () => {
      actions.closeModal();
      await actions.attempt(async () => onSubmit(text.trim()));
    }}
  >
    <label class="ss-field">
      <span class="ss-field__label">${label}</span>
      <span class="ss-input">
        <input
          ref=${input}
          value=${text}
          onInput=${(event) => setText(event.currentTarget.value)}
        />
      </span>
    </label>
  <//>`;
}

function ToastLayer() {
  const actions = useActions();
  const toast = useAppState((state) => state.overlay.toast);
  if (!toast) return null;
  const { text, action } = typeof toast === 'string' ? { text: toast, action: null } : toast;
  return html`<div class="ss-toasts">
    <div class="ss-toast" role="status">
      <span class="ss-toast__msg">${text}</span>
      ${
        action &&
        html`<button
          type="button"
          class="ss-btn ss-btn--ghost ss-btn--sm"
          onClick=${() => {
            actions.dismissToast();
            action.run();
          }}
        >
          ${action.label}
        </button>`
      }
      <button
        type="button"
        class="ss-icon-btn ss-icon-btn--sm"
        aria-label=${t('关闭')}
        onClick=${actions.dismissToast}
      >
        <${Lucide} name="x" />
      </button>
    </div>
  </div>`;
}

/** Search projects, chats and message text, or run a command; Enter opens the selection. */
function Palette() {
  const actions = useActions();
  const open = useAppState((state) => state.overlay.palette);
  const projects = useAppState((state) => state.projects);
  const meetings = useAppState((state) => state.meetings);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [selected, setSelected] = useState(0);
  const list = useRef(/** @type {HTMLElement | null} */ (null));

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

  const input = useRef(/** @type {HTMLInputElement | null} */ (null));
  useLayoutEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useLayoutEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, open]);

  if (!open) return null;
  const lower = query.trim().toLowerCase();
  const projectName = (id) => projects.find((project) => project.id === id)?.name ?? t('独立对话');
  const commands = [
    {
      label: t('新对话'),
      icon: 'square-pen',
      key: 'Ctrl N',
      run: () => navigate({ view: 'home' }),
    },
    {
      label: t('全部对话'),
      icon: 'layout-list',
      key: 'Ctrl Shift K',
      run: () => navigate({ view: 'all' }),
    },
    {
      label: t('打开设置'),
      icon: 'settings',
      key: 'Ctrl ,',
      run: () => navigate({ view: 'settings', id: 'general' }),
    },
  ];
  const groups = [
    [
      t('项目'),
      projects
        .filter((project) => !project.archived && project.name.toLowerCase().includes(lower))
        .map((project) => ({
          label: project.name,
          icon: 'folder',
          run: () => navigate({ view: 'workbench', id: project.id }),
        })),
    ],
    [
      t('对话'),
      meetings
        .filter((meeting) => !meeting.archived && meeting.title.toLowerCase().includes(lower))
        .map((meeting) => ({
          label: meeting.title,
          meta: projectName(meeting.projectId),
          icon: 'message-square',
          run: () => navigate({ view: 'meeting', id: meeting.id }),
        })),
    ],
    [
      t('消息'),
      found.map((hit) => ({
        label: hit.snippet,
        meta: meetings.find((meeting) => meeting.id === hit.meetingId)?.title ?? t('对话'),
        icon: 'search',
        run: () => navigate({ view: 'meeting', id: `${hit.meetingId}/${hit.id}` }),
      })),
    ],
    [t('命令'), commands.filter((command) => command.label.toLowerCase().includes(lower))],
  ]
    .map(([title, entries]) => /** @type {[string, any[]]} */ ([title, entries.slice(0, 20)]))
    .filter(([, entries]) => entries.length);
  const items = groups.flatMap(([, entries]) => entries);
  const index = Math.min(selected, Math.max(0, items.length - 1));
  const choose = (item) => {
    actions.closePalette();
    item?.run();
  };

  return html`<div
    class="ss-scrim ss-scrim--top"
    onPointerDown=${(event) => event.target === event.currentTarget && actions.closePalette()}
  >
    <section id="command-palette" class="ss-cmd" role="dialog" aria-label=${t('搜索与命令')}>
      <div class="ss-cmd__input">
        <${Lucide} name="search" />
        <input
          ref=${input}
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
        <span class="ss-kbd">Esc</span>
      </div>
      <div class="ss-cmd__list" role="listbox" ref=${list}>
        ${
          items.length
            ? groups.map(([title, entries]) => [
                html`<div class="ss-cmd__group" key=${title}>${title}</div>`,
                ...entries.map((item) => {
                  const n = items.indexOf(item);
                  return html`<button
                    key=${`${title}-${n}`}
                    type="button"
                    class="ss-cmd__item"
                    role="option"
                    aria-selected=${String(n === index)}
                    data-active=${n === index ? '' : undefined}
                    onMouseDown=${(event) => event.preventDefault()}
                    onMouseMove=${() => n !== index && setSelected(n)}
                    onClick=${() => choose(item)}
                  >
                    <${Lucide} name=${item.icon} />
                    <span class="ss-truncate">${item.label}</span>
                    ${
                      (item.meta || item.key) &&
                      html`<span class="ss-cmd__meta"
                        >${item.key ? html`<span class="ss-kbd">${item.key}</span>` : item.meta}</span
                      >`
                    }
                  </button>`;
                }),
              ])
            : html`<div class="ss-cmd__empty">${t('没有匹配项')}</div>`
        }
      </div>
      <div class="ss-cmd__foot">
        <span><span class="ss-kbd">↑</span><span class="ss-kbd">↓</span>${t('选择')}</span>
        <span><span class="ss-kbd">Enter</span>${t('打开')}</span>
        <span><span class="ss-kbd">Esc</span>${t('关闭')}</span>
      </div>
    </section>
  </div>`;
}

export function Overlays() {
  return html`<${MenuLayer} /><${ModalLayer} /><${ToastLayer} /><${Palette} />`;
}
