import test from 'node:test';
import assert from 'node:assert/strict';
import {
  unionMs,
  summarizeStartupSplit,
  summarizeStartupTrace,
  sanitizeTrace,
} from './p4c-startup-summary.mjs';

test('startup split retains native wall bounds and unions overlapping script downloads', () => {
  const result = summarizeStartupSplit(
    { points: { httpListening: 1000, pageRendered: 2000 } },
    [
      { stage: 'hostReadyReceived', epochMs: 1010 },
      { stage: 'mainWebviewBuildStart', epochMs: 1020 },
      { stage: 'mainWebviewBuildEnd', epochMs: 1550 },
    ],
    {
      timeOrigin: 1500,
      marks: [
        { name: 'sciencescope.document-start', startTime: 20 },
        { name: 'sciencescope.app-first-child', startTime: 450 },
        { name: 'sciencescope.first-render-report', startTime: 500 },
      ],
      navigation: [{ startTime: 0, responseEnd: 35 }],
      resources: [
        { route: '/main.js', startTime: 30, responseEnd: 150, encodedBodySize: 100 },
        { route: '/actions.js', startTime: 100, responseEnd: 250, encodedBodySize: 200 },
        { route: '/api/settings', startTime: 300, responseEnd: 345, encodedBodySize: 50 },
        { route: '/late.js', startTime: 600, responseEnd: 700, encodedBodySize: 999 },
      ],
    },
  );
  assert.equal(result.httpReadyToRenderMs, 1000);
  assert.equal(result.webviewBuildMs, 530);
  assert.equal(result.documentStartToFirstChildMs, 430);
  assert.equal(result.firstChildToRenderReportMs, 50);
  assert.deepEqual(result.scriptDownloads, {
    count: 2,
    spanMs: 220,
    unionMs: 220,
    bytes: 300,
    crossingAfterRender: {
      completedCount: 0,
      tailUnionMs: 0,
      cumulativeTailMs: 0,
      wholeEncodedBodyBytes: 0,
    },
  });
  assert.deepEqual(result.firstScreenApis, {
    count: 1,
    spanMs: 45,
    unionMs: 45,
    crossingAfterRender: {
      completedCount: 0,
      tailUnionMs: 0,
      cumulativeTailMs: 0,
      wholeEncodedBodyBytes: 0,
    },
  });
  assert.equal(
    unionMs([
      [0, 10],
      [2, 6],
      [8, 20],
      [30, 35],
    ]),
    25,
  );
});

test('first-screen network intervals clip crossing responses and keep their complete bytes and tails separate', () => {
  const result = summarizeStartupSplit({ points: {} }, [], {
    timeOrigin: 0,
    navigation: [],
    marks: [{ name: 'sciencescope.first-render-report', startTime: 100 }],
    resources: [
      { route: '/cross.js', startTime: 20, responseEnd: 180, encodedBodySize: 1000 },
      { route: '/api/settings', startTime: 50, responseEnd: 160, encodedBodySize: 2000 },
      { route: '/at-boundary.js', startTime: 100, responseEnd: 110, encodedBodySize: 9999 },
      { route: '/not-completed.js', startTime: 10, responseEnd: 0, encodedBodySize: 0 },
    ],
  });
  assert.equal(result.scriptDownloads.count, 1);
  assert.equal(result.scriptDownloads.spanMs, 80);
  assert.equal(result.scriptDownloads.unionMs, 80);
  assert.equal(result.scriptDownloads.bytes, 0);
  assert.deepEqual(result.scriptDownloads.crossingAfterRender, {
    completedCount: 1,
    tailUnionMs: 80,
    cumulativeTailMs: 80,
    wholeEncodedBodyBytes: 1000,
  });
  assert.equal(result.firstScreenApis.unionMs, 50);
  assert.deepEqual(result.resourceBoundary.crossingAfterRender, {
    completedCount: 2,
    tailUnionMs: 80,
    cumulativeTailMs: 140,
    wholeEncodedBodyBytes: 3000,
  });
  assert.match(result.resourceBoundary.coverage, /Pending-request contributions remain unknown/u);
});

test('diagnostic trace evaluates complete and begin/end events on only the main renderer without double counting', () => {
  const trace = {
    traceEvents: [
      { name: 'sciencescope.document-start', pid: 1, tid: 7, ts: 1000 },
      { name: 'sciencescope.first-render-report', pid: 1, tid: 7, ts: 11000 },
      { name: 'v8.evaluateModule', ph: 'X', pid: 1, tid: 7, ts: 2000, dur: 4000 },
      { name: 'EvaluateScript', ph: 'B', pid: 1, tid: 7, ts: 4000 },
      { ph: 'E', pid: 1, tid: 7, ts: 8000 },
      { name: 'v8.compileModule', ph: 'X', pid: 1, tid: 7, ts: 3500, dur: 1000 },
      { name: 'EvaluateScript', ph: 'X', pid: 1, tid: 8, ts: 1000, dur: 10000 },
    ],
  };
  const result = summarizeStartupTrace(trace);
  assert.equal(result.complete, true);
  assert.deepEqual(result.evaluation, { events: 2, unionMs: 6 });
  assert.deepEqual(result.compilation, { events: 1, unionMs: 1 });
  assert.equal(summarizeStartupTrace([]).complete, false);
  assert.deepEqual(
    sanitizeTrace({
      args: {
        url: 'http://local/api/messages/msg_fixture?token=fixture',
        script: 'http://local/main.js?v=1',
      },
    }),
    { args: { url: '/api/messages/:id', script: '/main.js' } },
  );
});
