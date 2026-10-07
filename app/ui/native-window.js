/**
 * Install the frameless window's eight native resize handles.
 * @param {any} [native]
 * @param {Document} [doc]
 * @returns {() => void}
 */
export function installWindowResize(native = globalThis.__TAURI__?.window, doc = document) {
  if (!native?.getCurrentWindow) return () => {};
  const win = native.getCurrentWindow();
  const frame = doc.createElement('div');
  frame.className = 'native-resize-frame';
  frame.setAttribute('aria-hidden', 'true');
  for (const direction of [
    'North',
    'NorthEast',
    'East',
    'SouthEast',
    'South',
    'SouthWest',
    'West',
    'NorthWest',
  ]) {
    const edge = doc.createElement('div');
    edge.dataset.resizeDirection = direction;
    edge.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      void win.startResizeDragging(direction).catch(() => {});
    });
    frame.append(edge);
  }
  doc.body.append(frame);
  const sync = async () => {
    frame.hidden = (await win.isMaximized()) || (await win.isFullscreen());
  };
  let unlisten;
  let disposed = false;
  void win
    .onResized(() => void sync())
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
  void sync();
  const fullscreen = (event) => {
    if (event.key !== 'F11') return;
    event.preventDefault();
    void win.isFullscreen().then((active) => win.setFullscreen(!active));
  };
  doc.addEventListener('keydown', fullscreen);
  return () => {
    disposed = true;
    unlisten?.();
    doc.removeEventListener('keydown', fullscreen);
    frame.remove();
  };
}
