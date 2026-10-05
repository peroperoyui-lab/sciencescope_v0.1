// Line icons from the approved prototype (ScienceScope.html `iconPaths`).
import { html } from './html.js';

const PATHS = {
  chat: 'M4 4h16v12H9l-5 4z',
  book: 'M3 4c4-1 7 0 9 2 2-2 5-3 9-2v15c-4-1-7 0-9 2-2-2-5-3-9-2z M12 6v15',
  cube: 'm12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',
  folder: 'M3 5h7l2 3h9v12H3z',
  file: 'M6 2h9l4 4v16H6z M14 2v6h5 M9 12h7 M9 16h7',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  users:
    'M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M3 20v-3c0-4 10-4 10 0v3z M16 4a3 3 0 0 1 0 6 M16 14c4 0 5 2 5 6',
  browser: 'M3 4h18v17H3z M3 9h18 M6 6h1 M10 6h1',
  summary: 'M3 4h18v14H3z M8 21h8 M12 18v3 M7 9v5 M12 7v7 M17 10v4',
  plus: 'M12 5v14 M5 12h14',
  arrow: 'M12 19V5 M6 11l6-6 6 6',
  down: 'm6 9 6 6 6-6',
  right: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12 M6 18 18 6',
  expand: 'M3 9V3h6 M15 3h6v6 M21 15v6h-6 M9 21H3v-6',
  check: 'm4 12 5 5L20 6',
  more: 'M5 12h1 M11 12h1 M17 12h1',
  link: 'm9 15 6-6 M7 13l-2 2a4 4 0 0 0 6 6l3-3 M17 11l2-2a4 4 0 0 0-6-6l-3 3',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M12 6v6l4 2',
  branch: 'M6 3v12a5 5 0 0 0 5 5h7 M6 8h8a4 4 0 0 0 4-4V3',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 17v4h16v-4',
  image: 'M3 3h18v18H3z m0 14 5-6 5 5 3-3 5 6 M15 7h1',
  edit: 'm4 16 12-12 4 4L8 20H4z M13 7l4 4',
  undo: 'M8 4 3 9l5 5 M3 9h10a7 7 0 0 1 7 8',
  redo: 'm16 4 5 5-5 5 M21 9H11a7 7 0 0 0-7 8',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  pin: 'm9 3 8 0-1 7 3 3H5l3-3z M12 13v8',
  layout: 'M3 3h18v18H3z M3 8h18 M8 8v13',
  play: 'm7 3 14 9-14 9z',
  stop: 'M6 6h12v12H6z',
  key: 'M9 4a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M13 12l8 8 M17 16l3-3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  back: 'M20 12H4 m6-6-6 6 6 6',
  refresh: 'M20 6v6h-6 M4 18v-6h6 M19 10a8 8 0 0 0-14-5 M5 14a8 8 0 0 0 14 5',
  help: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20 M9 8a3 3 0 1 1 5 3c-2 1-2 1-2 3 M12 17h.01',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
};

/** @param {{ name: string }} props */
export function Icon({ name }) {
  return html`<span class="ico"
    ><svg viewBox="0 0 24 24" aria-hidden="true"><path d=${PATHS[name] ?? PATHS.file} /></svg
  ></span>`;
}
