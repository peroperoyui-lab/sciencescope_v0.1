// A right-side panel (design system Panel): splitter, 44px head with the
// title and its buttons, then the body. The width is a setting
// (`appearance.panels`), so each panel keeps it across restarts.
import { useActions, useAppState } from '../context.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { Lucide } from '../icons.js';
import { Splitter } from './splitter.js';

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const MAX_WIDTH = 640;

/**
 * @param {{ name: 'secretary' | 'assistant', title: string, closeLabel: string,
 *   onClose: () => void, buttons?: any, onHeadPointerDown?: (event: PointerEvent) => void,
 *   detached?: boolean, className?: string, children: any }} props
 */
export function SidePanel({
  name,
  title,
  closeLabel,
  onClose,
  buttons,
  onHeadPointerDown,
  detached = false,
  className = '',
  children,
}) {
  const actions = useActions();
  const stored = useAppState((state) => state.settings?.appearance?.panels?.[name]);
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stored ?? DEFAULT_WIDTH));
  return html`<aside
    class=${`ss-panel side-panel ${detached ? 'side-panel--window' : ''} ${className}`}
    style=${detached ? undefined : { width: `${width}px` }}
    aria-label=${t(title)}
  >
    ${
      !detached &&
      html`<${Splitter}
        side="start"
        width=${width}
        min=${MIN_WIDTH}
        max=${MAX_WIDTH}
        defaultWidth=${DEFAULT_WIDTH}
        onCommit=${(next) =>
          actions.attempt(() =>
            actions.updateSettings({ appearance: { panels: { [name]: next } } }),
          )}
      />`
    }
    <div
      class="ss-panel__head"
      data-tauri-drag-region=${detached || undefined}
      onPointerDown=${onHeadPointerDown}
    >
      <span class="ss-panel__title">${t(title)}</span>
      ${buttons}
      <button
        type="button"
        class="ss-icon-btn"
        aria-label=${t(closeLabel)}
        data-tip=${t('关闭')}
        data-kbd="Esc"
        onClick=${onClose}
      >
        <${Lucide} name="x" />
      </button>
    </div>
    ${children}
  </aside>`;
}
