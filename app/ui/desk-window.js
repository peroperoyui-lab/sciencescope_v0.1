// The editing desk is its own window (docs/architecture/EDITING_DESK.md §7):
// a native window in the desktop app, a browser tab otherwise. Opening it again
// brings that window forward and opens the requested document in a tab.
import { isNative } from './assistant-window.js';
import { t } from './i18n/index.js';

const CHANNEL = 'sciencescope-desk';
/** @type {Window | null} */
let tab = null;
// Inside the desk window itself (its 对话 tab, its file preview) a request is
// handled here instead of opening another desk.
const isDesk = new URLSearchParams(location.search).get('surface') === 'desk';
/** @type {((target: DeskTarget) => void) | null} */
let openHere = null;
/** @type {((focus: any) => void) | null} */
let focusHere = null;

/**
 * A project file (`path`), or a saved version (`versionId`, with the tab's
 * `name` and the manuscript's `group` name) opened read-only.
 * @typedef {{ projectId?: string | null, path?: string | null, versionId?: string,
 *   name?: string, group?: string }} DeskTarget
 */

// A version to open travels like a cited sentence: through local storage,
// which both windows share, so the native window needs no new argument.
const VERSION_KEY = 'sciencescope.desk.version';
const VERSION_FRESH = 60000;

/** The version another window asked for, taken once. @returns {DeskTarget | null} */
function takeVersion() {
  try {
    const saved = JSON.parse(localStorage.getItem(VERSION_KEY) ?? 'null');
    localStorage.removeItem(VERSION_KEY);
    return saved && Date.now() - saved.at < VERSION_FRESH ? saved : null;
  } catch {
    return null;
  }
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
  if (isDesk && openHere) return openHere(target.versionId ? target : { projectId, path });
  if (projectId && target.versionId)
    try {
      localStorage.setItem(VERSION_KEY, JSON.stringify({ ...target, at: Date.now() }));
    } catch {
      // Without storage the desk opens on the project.
    }
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
      onOpen(
        takeVersion() ?? {
          projectId: data.projectId,
          path: typeof data.path === 'string' ? data.path : null,
        },
      );
  };
  openHere = onOpen;
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
      openHere = null;
    };
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = ({ data }) => {
    if (data?.type === 'open') receive(data);
  };
  return () => {
    channel.close();
    openHere = null;
  };
}

/** The document the window was opened on (`?projectId=&path=`, or a version). @returns {DeskTarget} */
export function initialDeskTarget() {
  const query = new URLSearchParams(location.search);
  return takeVersion() ?? { projectId: query.get('projectId'), path: query.get('path') };
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
  if (isDesk && focusHere) return focusHere({ ...found, at: Date.now() });
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
  focusHere = onFocus;
  return () => {
    removeEventListener('storage', receive);
    focusHere = null;
  };
}
