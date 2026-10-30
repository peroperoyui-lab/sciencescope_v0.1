// Served by the host, without modifying the UI's components or render flow.
/* global location, window, document, MutationObserver, requestAnimationFrame */
export function reportStartup() {
  performance.mark('sciencescope.startup-client-entered');
  const observation = Reflect.get(window, '__SCIENCESCOPE_STARTUP_OBSERVE__');
  const resources = [];
  const paints = [];
  const observers = [];
  if (observation) {
    const collectResources = (entries) => {
      for (const entry of entries)
        resources.push({
          route: new URL(entry.name, location.href).pathname,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          fetchStart: entry.fetchStart,
          requestStart: entry.requestStart,
          responseStart: entry.responseStart,
          responseEnd: entry.responseEnd,
          duration: entry.duration,
          transferSize: entry.transferSize,
          encodedBodySize: entry.encodedBodySize,
        });
    };
    const resource = new PerformanceObserver((list) => collectResources(list.getEntries()));
    resource.observe({ type: 'resource', buffered: true });
    observers.push({ observer: resource, collect: collectResources });
    const collectPaints = (entries) => {
      for (const entry of entries) paints.push({ name: entry.name, startTime: entry.startTime });
    };
    const paint = new PerformanceObserver((list) => collectPaints(list.getEntries()));
    paint.observe({ type: 'paint', buffered: true });
    observers.push({ observer: paint, collect: collectPaints });
    observation.resources = resources;
    observation.paints = paints;
  }
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
    performance.mark('sciencescope.app-first-child');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        performance.mark('sciencescope.first-render-report');
        for (const { observer: performanceObserver, collect } of observers) {
          collect(performanceObserver.takeRecords());
          performanceObserver.disconnect();
        }
        if (observation) observation.observersDisconnected = true;
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
