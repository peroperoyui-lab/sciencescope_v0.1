// One icon set: Lucide 1.49.0 (ISC), drawn by the design system's .ss-i class.
// Names are Lucide names (docs/design/system/build/icons_meta.py lists each
// meaning); the short names on the left are the older interface's names.
import { html } from './html.js';
import { LUCIDE } from './lucide-icons.js';

const ALIASES = {
  chat: 'message-square',
  book: 'book-open',
  cube: 'box',
  file: 'file-text',
  gear: 'settings',
  browser: 'globe',
  summary: 'newspaper',
  arrow: 'arrow-up',
  down: 'chevron-down',
  right: 'chevron-right',
  up: 'chevron-up',
  close: 'x',
  expand: 'maximize-2',
  more: 'ellipsis',
  branch: 'git-branch',
  edit: 'pencil',
  undo: 'undo-2',
  redo: 'redo-2',
  trash: 'trash-2',
  layout: 'layout-list',
  stop: 'square',
  key: 'key-round',
  back: 'arrow-left',
  refresh: 'refresh-cw',
  help: 'circle-help',
};

/** @param {string} name */
export function iconSvg(name) {
  return LUCIDE[ALIASES[name] ?? name] ?? LUCIDE.file;
}

/**
 * A bare Lucide icon, as in the design system (`<i data-i>`).
 * @param {{ name: string, small?: boolean, class?: string }} props
 */
export function Lucide({ name, small = false, class: extra = '' }) {
  return html`<svg
    class=${['ss-i', small ? 'ss-i--sm' : '', extra].filter(Boolean).join(' ')}
    viewBox="0 0 24 24"
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: iconSvg(name) }}
  ></svg>`;
}

/** The older interface's icon slot (`.ico`), now drawing a Lucide icon. @param {{ name: string }} props */
export function Icon({ name }) {
  return html`<span class="ico"><${Lucide} name=${name} /></span>`;
}
