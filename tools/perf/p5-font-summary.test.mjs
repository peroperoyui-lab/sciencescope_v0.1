import test from 'node:test';
import assert from 'node:assert/strict';
import { median, summarizeFontResources, summarizeFontTrace } from './p5-font-summary.mjs';

const marks = [
  { name: 'sciencescope.document-start', pid: 1, tid: 7, ts: 1000 },
  { name: 'sciencescope.first-render-report', pid: 1, tid: 7, ts: 11000 },
];
const event = (ph, ts, extra = {}) => ({
  name: 'UpdateLayoutTree',
  pid: 1,
  tid: 7,
  ph,
  ts,
  ...extra,
});
const page = (resources) => ({
  marks: marks.map(({ name, ts }) => ({ name, startTime: ts / 1000 })),
  resources,
});
const font = (route, startTime, responseEnd, transferSize = 10, encodedBodySize = 20) => ({
  route,
  startTime,
  responseEnd,
  duration: responseEnd - startTime,
  transferSize,
  encodedBodySize,
});

test('trace clips long X and B/E layouts at both bounds and unions overlap on only the main thread', () => {
  const trace = {
    traceEvents: [
      ...marks,
      event('X', 0, { dur: 4000 }), // Clips to [1,4] ms.
      event('B', 3000),
      { ph: 'B', name: 'nested', pid: 1, tid: 7, ts: 5000 },
      { ph: 'E', pid: 1, tid: 7, ts: 6000 },
      { ph: 'E', pid: 1, tid: 7, ts: 13000 }, // Clips to [3,11] ms.
      event('X', 8000, { dur: 1000 }), // Nested/overlapping time is not counted twice.
      event('X', 1000, { dur: 10000, tid: 8 }),
      event('X', 1000, { dur: 10000, pid: 2 }),
      event('X', 15000, { dur: 9000 }),
      event('X', 11000, { dur: 5000 }), // Touching the boundary contributes no interval.
    ],
  };
  const snapshot = structuredClone(trace);
  assert.deepEqual(summarizeFontTrace(trace), {
    complete: true,
    documentToRenderMs: 10,
    boundary: { startTs: 1000, endTs: 11000, pid: 1, tid: 7 },
    updateLayoutTree: { totalMs: 10, maxMs: 8, count: 3 },
  });
  assert.deepEqual(trace, snapshot);
});

test('missing, reversed or wrong-thread trace marks and unclosed layout events are incomplete', () => {
  for (const trace of [
    [],
    [marks[0]],
    [marks[0], { ...marks[1], tid: 8 }],
    [marks[0], { ...marks[1], ts: 500 }],
    [...marks, event('B', 2000)],
  ]) {
    const result = summarizeFontTrace(trace);
    assert.equal(result.complete, false);
    assert.equal(typeof result.reason, 'string');
    assert.equal(result.updateLayoutTree, undefined);
  }
  assert.deepEqual(summarizeFontTrace(marks).updateLayoutTree, { totalMs: 0, maxMs: 0, count: 0 });
});

test('resources separate render-crossing fonts, all observed completions, Noto CSS and ResourceTiming cache hits', () => {
  const input = page([
    font('/fonts/a.woff2?v=1', 2, 5, 0, 100),
    font('/fonts/b.WOFF?hash=2', 8, 15, 40, 70),
    font('/fonts/c.ttf', 11, 16, 30, 60),
    font('/fonts/d.otf#font', 12, 18, 0, 0), // Zero/zero alone is not a cache hit.
    font('/vendor/fonts/noto-sans-sc/index.css?v=3', 1, 4, 10, 90),
    font('/fonts/ignore.woff2.js', 1, 3, 999, 999),
  ]);
  const result = summarizeFontResources(input);
  assert.equal(result.complete, true);
  assert.equal(result.documentToRenderMs, 10);
  assert.deepEqual(result.fonts.startedBeforeRender, {
    count: 2,
    transferBytes: 40,
    encodedBodyBytes: 170,
    resourceTimingCacheHits: 1,
    lastStartMs: 8,
    lastResponseEndMs: 15,
  });
  assert.deepEqual(result.fonts.completedByRender, {
    count: 1,
    transferBytes: 0,
    encodedBodyBytes: 100,
    resourceTimingCacheHits: 1,
    lastStartMs: 2,
    lastResponseEndMs: 5,
  });
  assert.deepEqual(result.fonts.allReady, {
    count: 4,
    transferBytes: 70,
    encodedBodyBytes: 230,
    resourceTimingCacheHits: 1,
    lastStartMs: 12,
    lastResponseEndMs: 18,
  });
  assert.equal(result.notoStylesheets.allReady.count, 1);
  assert.equal(result.notoStylesheets.allReady.encodedBodyBytes, 90);
  assert.match(result.interpretation, /ResourceTiming/u);
});

test('resource boundaries are mandatory and pending font timing never becomes a completed request', () => {
  for (const input of [{ resources: [] }, { marks: [], resources: [] }, page(null)]) {
    const result = summarizeFontResources(input);
    assert.equal(result.complete, false);
    assert.equal(typeof result.reason, 'string');
  }
  const result = summarizeFontResources(page([font('/pending.woff2', 2, 0, 0, 0)]));
  assert.equal(result.complete, false);
  assert.equal(result.observedComplete, false);
  assert.equal(result.fonts.startedBeforeRender.count, 1);
  assert.equal(result.fonts.completedByRender.count, 0);
  assert.equal(result.fonts.allReady.count, 0);
  assert.equal(result.fonts.allReady.lastResponseEndMs, null);
  assert.equal(summarizeFontResources(page([])).fonts.allReady.count, 0);
});

test('median preserves its input and rejects empty or invalid sample sets', () => {
  const values = [9, 1, 5];
  assert.equal(median(values), 5);
  assert.deepEqual(values, [9, 1, 5]);
  assert.equal(median([9, 1, 5, 3]), 4);
  assert.equal(median([0]), 0);
  for (const values of [[], [NaN], [1, Infinity], [null], ['2'], null])
    assert.equal(median(values), null);
});
