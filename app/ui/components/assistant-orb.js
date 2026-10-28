// A click toggles the assistant; dragging the native orb never also clicks it.
import { useEffect, useRef, useState } from 'preact/hooks';
import { isNative, toggleAssistantWindow } from '../assistant-window.js';
import { html } from '../html.js';
import { t } from '../i18n/index.js';
import { LogoMark } from '../illustrations.js';

/** @returns {import('preact').VNode} */
export function AssistantOrb() {
  const [mode, setMode] = useState('orb');
  const [error, setError] = useState('');
  const gesture = useRef(null);
  const suppress = useRef(0);
  useEffect(() => {
    if (!isNative()) return;
    let stop;
    let disposed = false;
    void globalThis.__TAURI__.core
      .invoke('get_assistant_mode')
      .then(setMode)
      .catch((failure) => setError(failure.message));
    void globalThis.__TAURI__.event
      .listen('assistant-mode', (event) => setMode(event.payload))
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useEffect(() => () => gesture.current?.(), []);
  async function attempt(work) {
    try {
      await work();
      setError('');
    } catch {
      setError(t('助手窗口操作失败，请重试。'));
    }
  }
  return html`<div class="ss-orb-view">
    <button
      type="button"
      class="ss-orb"
      data-v="toggle-orb"
      aria-label=${t('展开或收起全局助手')}
      aria-expanded=${mode === 'expanded'}
      title=${error || t('全局助手')}
      onClick=${() => {
        if (Date.now() >= suppress.current && isNative())
          void attempt(async () => setMode(await toggleAssistantWindow()));
      }}
      onPointerDown=${(event) => {
        if (event.button !== 0 || !isNative()) return;
        gesture.current?.();
        const { screenX: x, screenY: y } = event;
        const cleanup = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', cleanup);
          window.removeEventListener('pointercancel', cleanup);
          gesture.current = null;
        };
        const move = (next) => {
          if (Math.hypot(next.screenX - x, next.screenY - y) < 5) return;
          cleanup();
          suppress.current = Date.now() + 600;
          // A WebView pointer capture can retain OS mouse ownership and prevent
          // the native move loop. Use the legacy window listener without capture.
          void attempt(async () => {
            await globalThis.__TAURI__.window.getCurrentWindow().startDragging();
            suppress.current = Date.now() + 300;
          });
        };
        gesture.current = cleanup;
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', cleanup, { once: true });
        window.addEventListener('pointercancel', cleanup, { once: true });
      }}
      onContextMenu=${(event) => {
        event.preventDefault();
        if (isNative()) void attempt(() => globalThis.__TAURI__.core.invoke('show_assistant_menu'));
      }}
    >
      <${LogoMark} className="ss-logo" />
    </button>
  </div>`;
}
