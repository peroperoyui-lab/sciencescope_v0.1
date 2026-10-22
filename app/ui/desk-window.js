// The editing desk is its own window (docs/architecture/EDITING_DESK.md §7):
// a native window in the desktop app, a browser tab otherwise. Opening it again
// brings that window forward and opens the requested document in a tab.
import { isNative } from './assistant-window.js';

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
