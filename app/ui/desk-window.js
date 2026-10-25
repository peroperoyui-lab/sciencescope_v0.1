// The editing desk is its own window (docs/architecture/EDITING_DESK.md §7):
// a native window in the desktop app, a browser tab otherwise. Opening it again
// brings that window forward and opens the requested document in a tab.
import { isNative } from './assistant-window.js';
import { t } from './i18n/index.js';

const CHANNEL = 'sciencescope-desk';
/** @type {Window | null} */
let tab = null;

/** @typedef {{ projectId?: string | null, path?: string | null }} DeskTarget */

/** The desk switch (`features.editingDesk`, off until the alpha checks pass). @param {any} settings */
export function deskEnabled(settings) {
  return settings?.features?.editingDesk === true;
}

/** @param {DeskTarget} target */
function deskUrl(target) {
  const url = new URL('/', location.href);
  url.searchParams.set('surface', 'desk');
  if (target.projectId) url.searchParams.set('projectId', target.projectId);
  if (target.projectId && target.path) url.searchParams.set('path', target.path);
  return url.href;
}

/**
 * Open the desk, optionally on a project file.
 * @param {DeskTarget} [target]
 * @returns {Promise<void>}
 */
export async function openDesk(target = {}) {
  const projectId = target.projectId ?? null;
  const path = projectId ? (target.path ?? null) : null;
  if (isNative()) {
    await globalThis.__TAURI__.core.invoke('open_secondary_window', {
      request: { surface: 'desk', project_id: projectId, path, toggle: false, collapsed: false },
    });
    return;
  }
  if (tab && !tab.closed) {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: 'open', projectId, path });
    channel.close();
    tab.focus();
    return;
  }
  tab = window.open(deskUrl({ projectId, path }), CHANNEL);
}

/**
 * The desk window's side: documents other windows ask it to open.
 * @param {(target: DeskTarget) => void} onOpen
 * @returns {() => void}
 */
export function listenForDeskTargets(onOpen) {
  const receive = (data) => {
    if (data && typeof data.projectId === 'string')
      onOpen({ projectId: data.projectId, path: typeof data.path === 'string' ? data.path : null });
  };
  if (isNative()) {
    let stop;
    let disposed = false;
    void globalThis.__TAURI__.event
      .listen('desk-open', ({ payload }) => receive(payload))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (data?.type === 'open') receive(data);
  };
  return () => channel.close();
}

/** The document the window was opened on (`?projectId=&path=`). @returns {DeskTarget} */
export function initialDeskTarget() {
  const query = new URLSearchParams(location.search);
  return { projectId: query.get('projectId'), path: query.get('path') };
}

// A chat mark's sentence travels to the desk window through local storage:
// both windows share it, a storage event reaches a desk that is already open,
// and a desk that opens later reads it on start.
const FOCUS_KEY = 'sciencescope.desk.focus';
const FOCUS_FRESH = 60000;

/**
 * Show a cited sentence on the desk: locate it in the open working text, then
 * open the desk on its document.
 * @param {any} actions @param {any} reference a schema 1 version or project-file reference
 */
export async function focusDesk(actions, reference) {
  const found = await actions.deskFocus(reference);
  if (!found.path) throw new Error(t('这份文稿只在应用里，编辑台还不能从这里打开它。'));
  try {
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ ...found, at: Date.now() }));
  } catch {
    // Without storage the desk still opens on the document.
  }
  await openDesk({ projectId: found.projectId, path: found.path });
}

/** The desk side: a waiting sentence, taken once. */
export function takeDeskFocus() {
  try {
    const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? 'null');
    localStorage.removeItem(FOCUS_KEY);
    return saved && Date.now() - saved.at < FOCUS_FRESH ? saved : null;
  } catch {
    return null;
  }
}

/** @param {(focus: any) => void} onFocus */
export function listenForDeskFocus(onFocus) {
  const receive = (event) => {
    if (event.key !== FOCUS_KEY || !event.newValue) return;
    // Another desk window may already have taken it; the event still carries it.
    try {
      const focus = JSON.parse(event.newValue);
      if (Date.now() - focus.at < FOCUS_FRESH) onFocus(focus);
    } catch {
      // Not ours to read.
    }
  };
  addEventListener('storage', receive);
  return () => removeEventListener('storage', receive);
}
