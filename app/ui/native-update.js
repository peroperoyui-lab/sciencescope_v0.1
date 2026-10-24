// The native side owns verification, host shutdown and installer execution.
// This bridge has no UI and never installs an update without an explicit call.
import { t } from './i18n/index.js';

/**
 * @returns {boolean} Whether this is the native main window.
 */
export function supported() {
  const native = globalThis.__TAURI__;
  return Boolean(native?.core?.invoke && native?.window?.getCurrentWindow?.().label === 'main');
}

function requireNative() {
  if (!supported()) throw Object.assign(new Error(t('不支持')), { code: 'UPDATE_UNSUPPORTED' });
  return globalThis.__TAURI__;
}

function updateError(error) {
  return Object.assign(new Error(error?.message ?? String(error)), {
    code: error?.code ?? 'UPDATE_FAILED',
  });
}

/**
 * Manual checks are not subject to the native automatic-check daily interval.
 * @returns {Promise<{available:boolean,version:string|null,notes:string|null,date:string|null}>}
 */
export async function check() {
  const native = requireNative();
  try {
    return await native.core.invoke('check_update');
  } catch (error) {
    throw updateError(error);
  }
}

/**
 * Install the update returned by the most recent native check.
 * @param {(progress:{phase:'downloading'|'verified'|'stopping'|'installing',downloaded:number,total:number|null})=>void} [onProgress]
 * @returns {Promise<void>}
 */
export async function install(onProgress = () => {}) {
  const native = requireNative();
  let unlisten;
  try {
    unlisten = await native.event.listen('update:progress', ({ payload }) => onProgress(payload));
    await native.core.invoke('install_update');
  } catch (error) {
    throw updateError(error);
  } finally {
    unlisten?.();
  }
}
