// Update state for the interface (design system UpdatePrompt, PageSettingsAbout):
// what the native side found, the install progress and the last error, shared
// by the prompt in the main window and Settings → 关于. Nothing installs
// without the person pressing 更新并重启.
import { useEffect, useState } from 'preact/hooks';
import * as native from './native-update.js';

/**
 * @typedef {{ version: string | null, notes: string | null, date: string | null }} Release
 * @typedef {{ release: Release | null, checking: boolean, checkedAt: number | null,
 *   upToDate: boolean, phase: string | null, downloaded: number, total: number | null,
 *   error: string | null, installError: string | null, dismissed: boolean }} UpdateState
 */

/** @type {UpdateState} */
let state = {
  release: null,
  checking: false,
  checkedAt: null,
  upToDate: false,
  phase: null,
  downloaded: 0,
  total: null,
  error: null,
  installError: null,
  dismissed: false,
};
const listeners = new Set();
/** @param {Partial<UpdateState>} patch */
function set(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

let listening = false;
/** Hears what the automatic check finds; called once by the main window. */
export function listenForUpdates() {
  if (listening || !native.supported()) return;
  listening = true;
  const events = /** @type {any} */ (globalThis).__TAURI__.event;
  void events.listen('update:available', ({ payload }) =>
    set({ release: payload, upToDate: false, dismissed: false }),
  );
}

/** A manual check from Settings → 关于. */
export async function checkNow() {
  set({ checking: true, error: null });
  try {
    const result = await native.check();
    set({
      checking: false,
      checkedAt: Date.now(),
      release: result.available ? result : null,
      upToDate: !result.available,
      dismissed: false,
    });
  } catch (error) {
    set({ checking: false, checkedAt: Date.now(), error: error.message });
  }
}

/** Download, verify, close and install; the window closes during the last step. */
export async function installNow() {
  set({ phase: 'downloading', downloaded: 0, total: null, installError: null, dismissed: false });
  try {
    await native.install((progress) =>
      set({ phase: progress.phase, downloaded: progress.downloaded, total: progress.total }),
    );
  } catch (error) {
    set({ phase: null, installError: error.message });
  }
}

/** 稍后: hide the prompt until something new happens; 关于 still offers the update. */
export const dismiss = () => set({ dismissed: true, installError: null });

export const supported = native.supported;

/** @returns {UpdateState} */
export function useUpdate() {
  const [current, setCurrent] = useState(state);
  useEffect(() => {
    listeners.add(setCurrent);
    setCurrent(state);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}
