// The native shell owns geometry and visibility. This bridge only opens the
// existing assistant windows and passes navigation back to the main page.
import { navigate, parseRoute } from './route.js';

/** @returns {boolean} */
export function isNative() {
  return typeof globalThis.__TAURI__?.core?.invoke === 'function';
}

/**
 * @param {boolean} [collapsed]
 * @returns {Promise<void>}
 */
export async function openAssistantWindow(collapsed = false) {
  await globalThis.__TAURI__.core.invoke('open_secondary_window', {
    request: { surface: 'assistant', project_id: null, toggle: false, collapsed },
  });
}

/** @returns {Promise<void>} */
export async function hideAssistantWindow() {
  await globalThis.__TAURI__.core.invoke('hide_assistant');
}

/** @returns {Promise<'orb' | 'expanded'>} */
export async function toggleAssistantWindow() {
  const mode = await globalThis.__TAURI__.core.invoke('get_assistant_mode');
  return globalThis.__TAURI__.core.invoke('set_assistant_mode', {
    mode: mode === 'orb' ? 'expanded' : 'orb',
  });
}

/**
 * Apply the saved launch choice once, only from the native main entry point.
 * @param {any} settings
 * @param {string | null} surface
 * @returns {Promise<void>}
 */
export async function applyAssistantStartup(settings, surface) {
  if (!isNative() || surface) return;
  const startup = settings?.assistant?.startup;
  if (startup === 'orb' || startup === 'expanded') await openAssistantWindow(startup === 'orb');
}

/**
 * Open a route in the main window from another window (the desk, the
 * detached assistant); the main window comes forward.
 * @param {string} hash
 */
export function navigateMain(hash) {
  const payload = { type: 'navigate', hash };
  if (isNative()) {
    void globalThis.__TAURI__.event.emitTo('main', 'assistant-navigate', payload);
    return;
  }
  const channel = new BroadcastChannel('sciencescope-navigation');
  channel.postMessage(payload);
  channel.close();
}

/**
 * A detached assistant link navigates Main while its own transcript stays open.
 * @param {string | null} surface
 * @returns {() => void}
 */
export function installAssistantNavigation(surface) {
  const channel = new BroadcastChannel('sciencescope-navigation');
  let stopNative;
  let disposed = false;
  const receive = (data) => {
    if (data?.type !== 'navigate' || typeof data.hash !== 'string') return;
    navigate(parseRoute(data.hash));
    if (isNative())
      void globalThis.__TAURI__.window
        .getCurrentWindow()
        .setFocus()
        .catch(() => {});
  };
  if (!surface) {
    if (isNative()) {
      // Separate native WebViews do not share a BroadcastChannel context.
      void globalThis.__TAURI__.event
        .listen('assistant-navigate', ({ payload }) => receive(payload))
        .then((stop) => {
          if (disposed) stop();
          else stopNative = stop;
        });
    } else channel.onmessage = ({ data }) => receive(data);
  }
  const forward = (event) => {
    if (surface !== 'assistant') return;
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !url.hash.startsWith('#/')) return;
    event.preventDefault();
    navigateMain(url.hash);
  };
  document.addEventListener('click', forward);
  return () => {
    disposed = true;
    stopNative?.();
    document.removeEventListener('click', forward);
    channel.close();
  };
}
