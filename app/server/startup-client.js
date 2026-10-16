// Served by the host, without modifying the UI's components or render flow.
/* global location, window, document, MutationObserver, requestAnimationFrame */
export function reportStartup() {
  const token =
    new URLSearchParams(location.search).get('token') ||
    Reflect.get(window, '__SCIENCESCOPE_API_TOKEN__') ||
    sessionStorage.getItem('sciencescope.token');
  let reported = false;
  const observer = new MutationObserver(check);
  function check() {
    if (reported || !document.querySelector('#app > *')) return;
    reported = true;
    observer.disconnect();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void fetch('/api/startup/rendered', {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({
            pageRendered: performance.timeOrigin + performance.now(),
            renderStatus: document.querySelector('.startup-error') ? 'error' : 'rendered',
          }),
        }).catch(() => {});
      }),
    );
  }
  observer.observe(document, { childList: true, subtree: true });
  check();
}
