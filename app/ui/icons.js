// Line icons (24×24, stroke), drawn in the prototype's style.
import { html } from './html.js';

const PATHS = {
  chat: 'M5 5h14v10H9l-4 4z',
  book: 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v13',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  folder: 'M3 7h6l2 2h10v10H3z',
  users:
    'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6',
  settings:
    'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12 2l2 3 3.5-.5.5 3.5 3 2-2 3 2 3-3 2-.5 3.5-3.5-.5-2 3-2-3-3.5.5-.5-3.5-3-2 2-3-2-3 3-2 .5-3.5L10 5z',
  send: 'M12 19V5M6 11l6-6 6 6',
  stop: 'M7 7h10v10H7z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  branch:
    'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c0 6-12 3-12 9',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM12 7v5l3 2',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  pin: 'M9 4h6l-1 6 3 3H7l3-3zM12 13v8',
  alert: 'M12 3l10 18H2zM12 10v4M12 17h.01',
  tool: 'M14 6a4 4 0 0 0 5 5l-9 9a2 2 0 0 1-3-3l9-9a4 4 0 0 0-2-2z',
  map: 'M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2zM9 4v14M15 6v14',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
};

/** @param {{ name: keyof typeof PATHS, size?: number }} props */
export function Icon({ name, size = 16 }) {
  return html`<span class="ico" aria-hidden="true">
    <svg viewBox="0 0 24 24" width=${size} height=${size}><path d=${PATHS[name]} /></svg>
  </span>`;
}
