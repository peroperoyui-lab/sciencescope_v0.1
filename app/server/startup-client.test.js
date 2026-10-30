import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { reportStartup } from './startup-client.js';

function page(observing) {
  const posts = [],
    marks = [],
    observers = [],
    frames = [];
  let appReady = false,
    mutation;
  const observation = observing ? { schema: 1 } : undefined;
  runInNewContext(`(${reportStartup.toString()})();`, {
    performance: { timeOrigin: 1000, now: () => 50, mark: (name) => marks.push(name) },
    location: { search: '?token=fixture-token', href: 'http://local/?token=fixture-token' },
    URL,
    URLSearchParams,
    window: { __SCIENCESCOPE_STARTUP_OBSERVE__: observation },
    document: { querySelector: (selector) => selector === '#app > *' && appReady },
    MutationObserver: class {
      constructor(check) {
        mutation = check;
      }
      observe() {}
      disconnect() {}
    },
    PerformanceObserver: class {
      constructor(callback) {
        this.callback = callback;
        this.pending = [];
        observers.push(this);
      }
      observe(options) {
        this.options = options;
      }
      takeRecords() {
        return this.pending.splice(0);
      }
      disconnect() {
        this.disconnected = true;
      }
    },
    sessionStorage: { getItem: () => null },
    requestAnimationFrame: (callback) => frames.push(callback),
    fetch: async (route, options) => posts.push({ route, ...options }),
  });
  return {
    posts,
    marks,
    observers,
    observation,
    finish() {
      appReady = true;
      mutation();
      assert.equal(posts.length, 0);
      frames.shift()();
      assert.equal(posts.length, 0);
      frames.shift()();
    },
  };
}

test('startup marks keep the existing double-frame request and exact POST fields', () => {
  const browser = page(false);
  browser.finish();
  assert.equal(browser.observers.length, 0);
  assert.equal(browser.posts.length, 1);
  assert.equal(browser.posts[0].route, '/api/startup/rendered');
  assert.equal(browser.posts[0].method, 'POST');
  assert.deepEqual(JSON.parse(browser.posts[0].body), {
    pageRendered: 1050,
    renderStatus: 'rendered',
  });
  assert.deepEqual(browser.marks, [
    'sciencescope.startup-client-entered',
    'sciencescope.app-first-child',
    'sciencescope.first-render-report',
  ]);
});

test('opt-in startup resources and paints drain pending entries and disconnect after the first screen', () => {
  const browser = page(true);
  const [resources, paints] = browser.observers;
  assert.deepEqual(JSON.parse(JSON.stringify(resources.options)), {
    type: 'resource',
    buffered: true,
  });
  resources.pending.push({
    name: 'http://local/main.js?cache=fixture',
    initiatorType: 'script',
    startTime: 3,
    responseEnd: 14,
    duration: 11,
  });
  paints.pending.push({ name: 'first-contentful-paint', startTime: 22 });
  browser.finish();
  assert.equal(browser.observation.resources[0].route, '/main.js');
  assert.equal(browser.observation.resources[0].responseEnd, 14);
  assert.equal(browser.observation.paints[0].startTime, 22);
  assert.equal(browser.observation.observersDisconnected, true);
  assert.ok(browser.observers.every((observer) => observer.disconnected));
  assert.deepEqual(Object.keys(JSON.parse(browser.posts[0].body)).sort(), [
    'pageRendered',
    'renderStatus',
  ]);
});
