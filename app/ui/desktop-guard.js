// Inside the native window the WebView is the whole application, so the
// browser's own keys and menus must not reach it: reloading, printing, view
// source, developer tools and history navigation would leave the app, and a
// file dropped outside a drop target would replace the page. The old desktop
// line (desktop/desktop-behavior.mjs) had the same guards.

const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

/** @param {KeyboardEvent} event */
export function isBrowserKey(event) {
  const key = event.key.toLowerCase();
  if (['f5', 'f7', 'f12', 'browserback', 'browserforward', 'browserrefresh'].includes(key))
    return true;
  if (event.altKey && !event.ctrlKey && ['arrowleft', 'arrowright', 'home'].includes(key))
    return true;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  if (event.shiftKey) return ['i', 'j', 'c', 'r'].includes(key);
  return ['r', 'p', 'u', 's', 'o', 'j'].includes(key);
}

/**
 * Only default actions are prevented; the application's own handlers for
 * these keys (and its own context menus and drop targets) still run.
 * @param {any} [native]
 * @param {Window} [win]
 * @returns {() => void}
 */
export function installDesktopGuards(native = globalThis.__TAURI__, win = window) {
  if (!native) return () => {};
  /** @param {KeyboardEvent} event */
  const keys = (event) => {
    if (isBrowserKey(event)) event.preventDefault();
  };
  // Text fields keep the system menu for cut, copy and paste.
  /** @param {MouseEvent} event */
  const menu = (event) => {
    if (!(/** @type {Element} */ (event.target).closest?.(EDITABLE))) event.preventDefault();
  };
  /** @param {DragEvent} event */
  const files = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  /** @param {DragEvent} event */
  const over = (event) => {
    if (!files(event) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  /** @param {DragEvent} event */
  const drop = (event) => {
    if (files(event)) event.preventDefault();
  };
  win.addEventListener('keydown', keys, true);
  win.addEventListener('contextmenu', menu);
  win.addEventListener('dragover', over);
  win.addEventListener('drop', drop);
  return () => {
    win.removeEventListener('keydown', keys, true);
    win.removeEventListener('contextmenu', menu);
    win.removeEventListener('dragover', over);
    win.removeEventListener('drop', drop);
  };
}
