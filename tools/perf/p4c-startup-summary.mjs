import { safeRoute } from './native-profile.mjs';

export function unionMs(intervals) {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    start,
    end;
  for (const interval of sorted) {
    if (end === undefined || interval[0] > end) {
      if (end !== undefined) total += end - start;
      [start, end] = interval;
    } else end = Math.max(end, interval[1]);
  }
  return end === undefined ? 0 : total + end - start;
}

export function summarizeStartupSplit(startup, native, page) {
  const point = (stage) => native.find((entry) => entry.stage === stage)?.epochMs;
  const mark = (name) => page.marks.find((entry) => entry.name === name)?.startTime;
  const epoch = (time) => (Number.isFinite(time) ? page.timeOrigin + time : undefined);
  const delta = (end, start) =>
    Number.isFinite(end) && Number.isFinite(start) ? end - start : null;
  const boundary = mark('sciencescope.first-render-report');
  const completed = page.resources.filter(
    (entry) => Number.isFinite(entry.responseEnd) && entry.responseEnd > 0,
  );
  const resources = completed.filter((entry) => entry.startTime < boundary);
  const scripts = resources.filter((entry) => /\.m?js$/u.test(entry.route));
  const apis = resources.filter(
    (entry) => entry.route.startsWith('/api/') && entry.route !== '/api/startup/rendered',
  );
  const span = (entries) =>
    entries.length
      ? Math.max(...entries.map((entry) => Math.min(entry.responseEnd, boundary))) -
        Math.min(...entries.map((entry) => entry.startTime))
      : null;
  const crossings = (entries) => {
    const crossed = entries.filter((entry) => entry.responseEnd > boundary);
    return {
      completedCount: crossed.length,
      tailUnionMs: unionMs(crossed.map((entry) => [boundary, entry.responseEnd])),
      cumulativeTailMs: crossed.reduce((sum, entry) => sum + entry.responseEnd - boundary, 0),
      wholeEncodedBodyBytes: crossed.reduce((sum, entry) => sum + (entry.encodedBodySize ?? 0), 0),
    };
  };
  const navigation = page.navigation[0];
  return {
    httpReadyToRenderMs: delta(startup.points.pageRendered, startup.points.httpListening),
    httpReadyToHostReceiptMs: delta(point('hostReadyReceived'), startup.points.httpListening),
    hostReceiptToWebviewBuildMs: delta(point('mainWebviewBuildStart'), point('hostReadyReceived')),
    webviewBuildMs: delta(point('mainWebviewBuildEnd'), point('mainWebviewBuildStart')),
    webviewBuildToDocumentStartMs: delta(
      epoch(mark('sciencescope.document-start')),
      point('mainWebviewBuildStart'),
    ),
    nativeNavigationToPageStartedMs: delta(
      point('mainPageLoadStarted'),
      point('mainNavigationRequested'),
    ),
    navigationToDocumentResponseMs: navigation
      ? navigation.responseEnd - navigation.startTime
      : null,
    documentStartToFirstChildMs: delta(
      mark('sciencescope.app-first-child'),
      mark('sciencescope.document-start'),
    ),
    firstChildToRenderReportMs: delta(
      mark('sciencescope.first-render-report'),
      mark('sciencescope.app-first-child'),
    ),
    scriptDownloads: {
      count: scripts.length,
      spanMs: span(scripts),
      unionMs: unionMs(
        scripts.map((entry) => [entry.startTime, Math.min(entry.responseEnd, boundary)]),
      ),
      bytes: scripts
        .filter((entry) => entry.responseEnd <= boundary)
        .reduce((sum, entry) => sum + entry.encodedBodySize, 0),
      crossingAfterRender: crossings(scripts),
    },
    firstScreenApis: {
      count: apis.length,
      spanMs: span(apis),
      unionMs: unionMs(
        apis.map((entry) => [entry.startTime, Math.min(entry.responseEnd, boundary)]),
      ),
      crossingAfterRender: crossings(apis),
    },
    resourceBoundary: {
      atMs: boundary,
      observedCompletedCount: completed.length,
      crossingAfterRender: crossings(resources),
      coverage:
        'Only ResourceTiming entries completed by collection are observed. Pending-request contributions remain unknown. Durations stop at the render boundary; script bytes count only bodies completed by that boundary. Crossing whole-body bytes and observed tail intervals are separate.',
    },
    interpretation:
      'Wall bounds and network intervals can overlap. Script download union is elapsed occupied network time across parallel requests. Module evaluation requires the separate diagnostic trace; no residual interval is labelled evaluation.',
  };
}

export function sanitizeTrace(value) {
  if (typeof value === 'string')
    return /^https?:\/\//u.test(value)
      ? safeRoute(value)
      : value.replace(/https?:\/\/[^\s"'<>]+/gu, (url) => safeRoute(url));
  if (Array.isArray(value)) return value.map(sanitizeTrace);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeTrace(item)]),
    );
  return value;
}

export function summarizeStartupTrace(trace) {
  const events = trace.traceEvents ?? trace;
  const start = events.find((event) => event.name === 'sciencescope.document-start');
  const end = events.find(
    (event) => event.name === 'sciencescope.first-render-report' && event.pid === start?.pid,
  );
  if (!start || !end)
    return {
      complete: false,
      reason:
        'The trace must contain both document-start and first-render marks on the main renderer.',
    };
  const complete = [];
  const stacks = new Map();
  for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
    if (event.ph === 'X') complete.push(event);
    const key = `${event.pid}:${event.tid}`;
    if (event.ph === 'B') {
      if (!stacks.has(key)) stacks.set(key, []);
      stacks.get(key).push(event);
    }
    if (event.ph === 'E') {
      const begin = stacks.get(key)?.pop();
      if (begin) complete.push({ ...begin, ph: 'X', dur: event.ts - begin.ts });
    }
  }
  const observed = complete.filter(
    (event) =>
      event.ph === 'X' &&
      event.pid === start.pid &&
      event.tid === start.tid &&
      event.ts >= start.ts &&
      event.ts <= end.ts &&
      Number.isFinite(event.dur),
  );
  const ranges = (names) =>
    observed
      .filter((event) => names.includes(event.name))
      .map((event) => [event.ts / 1000, Math.min(event.ts + event.dur, end.ts) / 1000]);
  const evaluations = ranges(['EvaluateScript', 'v8.evaluateModule']);
  const compilation = ranges([
    'v8.compile',
    'v8.compileModule',
    'V8.CompileModule',
    'V8.CompileScript',
    'V8.CompileCode',
  ]);
  return {
    complete: true,
    observedDocumentToRenderMs: (end.ts - start.ts) / 1000,
    evaluation: { events: evaluations.length, unionMs: unionMs(evaluations) },
    compilation: { events: compilation.length, unionMs: unionMs(compilation) },
    eventNames: [...new Set(observed.map((event) => event.name))].sort(),
    interpretation:
      'Separate tracing diagnostic. Unions describe elapsed main-renderer event intervals between the two application marks; evaluation and compilation may overlap. These values are not mixed into normal warm/cold medians.',
  };
}
