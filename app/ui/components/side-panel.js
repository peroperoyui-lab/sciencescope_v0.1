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
 * @param {{ name: 'secretary' | 'assistant' | 'preview' | 'materials' | 'knowledge' | 'versions', title: string, closeLabel: string,
 *   defaultWidth?: number,
 *   onClose: () => void, buttons?: any, onHeadPointerDown?: (event: PointerEvent) => void,
 *   detached?: boolean, className?: string, onBack?: () => void, backLabel?: string,
 *   bare?: boolean, detail?: string, children: any }} props
 * `onBack` puts an arrow before the title, for a panel opened from another one.
 * `detail` follows the title after a dot (a name, not translated).
 * `bare` leaves the head to the children (the version tree draws its own).
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
  defaultWidth = DEFAULT_WIDTH,
  onBack,
  backLabel = '返回',
  bare = false,
  detail = '',
  children,
}) {
  const actions = useActions();
  const stored = useAppState((state) => state.settings?.appearance?.panels?.[name]);
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, stored ?? defaultWidth));
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
        defaultWidth=${defaultWidth}
        onCommit=${(next) =>
          actions.attempt(() =>
            actions.updateSettings({ appearance: { panels: { [name]: next } } }),
          )}
      />`
    }
    ${
      !bare &&
      html`<div
        class="ss-panel__head"
        data-tauri-drag-region=${detached || undefined}
        onPointerDown=${onHeadPointerDown}
      >
        ${
          onBack &&
          html`<button
            type="button"
            class="ss-icon-btn"
            aria-label=${t(backLabel)}
            data-tip=${t(backLabel)}
            onClick=${onBack}
          >
            <${Lucide} name="arrow-left" />
          </button>`
        }
        <span class="ss-panel__title" title=${detail ? `${t(title)} · ${detail}` : undefined}
          >${t(title)}${detail && ` · ${detail}`}</span
        >
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
      </div>`
    }
    ${children}
  </aside>`;
}
