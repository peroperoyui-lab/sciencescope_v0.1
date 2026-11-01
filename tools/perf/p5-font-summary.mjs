import { unionMs } from './p4c-startup-summary.mjs';

const START = 'sciencescope.document-start';
const RENDER = 'sciencescope.first-render-report';
const incomplete = (reason) => ({ complete: false, reason });

/** Trace timestamps/durations are microseconds; reported intervals are milliseconds. */
export function summarizeFontTrace(trace) {
  const events = trace?.traceEvents ?? trace;
  if (!Array.isArray(events)) return incomplete('Expected a traceEvents array.');
  const start = events.find(
    (event) =>
      event.name === START && Number.isFinite(event.ts) && event.pid != null && event.tid != null,
  );
  const end = events.find(
    (event) =>
      event.name === RENDER &&
      event.pid === start?.pid &&
      event.tid === start?.tid &&
      Number.isFinite(event.ts) &&
      event.ts >= start?.ts,
  );
  if (!start || !end)
    return incomplete(
      'Missing ordered document-start/first-render marks on the same renderer thread.',
    );
  const stack = [];
  const ranges = [];
  const collect = (event, finish) => {
    if (event.name !== 'UpdateLayoutTree') return;
    const from = Math.max(start.ts, event.ts);
    const to = Math.min(end.ts, finish);
    if (to > from) ranges.push([from / 1000, to / 1000]);
  };
  for (const event of events
    .filter((item) => item.pid === start.pid && item.tid === start.tid && Number.isFinite(item.ts))
    .slice()
    .sort((left, right) => left.ts - right.ts)) {
    if (event.ph === 'B') stack.push(event);
    else if (event.ph === 'E') {
      const begin = stack.pop();
      if (begin) collect(begin, event.ts);
    } else if (event.ph === 'X' && Number.isFinite(event.dur) && event.dur >= 0)
      collect(event, event.ts + event.dur);
  }
  if (stack.some((event) => event.name === 'UpdateLayoutTree' && event.ts < end.ts))
    return incomplete('An UpdateLayoutTree begin event has no matching end.');
  return {
    complete: true,
    documentToRenderMs: (end.ts - start.ts) / 1000,
    boundary: { startTs: start.ts, endTs: end.ts, pid: start.pid, tid: start.tid },
    updateLayoutTree: {
      totalMs: unionMs(ranges),
      maxMs: ranges.reduce((maximum, [from, to]) => Math.max(maximum, to - from), 0),
      count: ranges.length,
    },
  };
}

const completed = (entry) =>
  Number.isFinite(entry.startTime) &&
  entry.startTime >= 0 &&
  Number.isFinite(entry.responseEnd) &&
  entry.responseEnd > 0 &&
  entry.responseEnd >= entry.startTime;
const last = (entries, key) =>
  entries.reduce((value, entry) => Math.max(value ?? -Infinity, entry[key]), null);
const bytes = (entries, key) =>
  entries.every((entry) => Number.isFinite(entry[key]) && entry[key] >= 0)
    ? entries.reduce((sum, entry) => sum + entry[key], 0)
    : null;
const stats = (entries) => ({
  count: entries.length,
  transferBytes: bytes(entries, 'transferSize'),
  encodedBodyBytes: bytes(entries, 'encodedBodySize'),
  resourceTimingCacheHits: entries.filter(
    (entry) => entry.transferSize === 0 && entry.encodedBodySize > 0,
  ).length,
  lastStartMs: last(entries, 'startTime'),
  lastResponseEndMs: last(entries.filter(completed), 'responseEnd'),
});

/** Resource times are navigation-relative milliseconds; bytes are whole completed entries. */
export function summarizeFontResources(page) {
  const start = page?.marks?.find((mark) => mark.name === START)?.startTime;
  const render = page?.marks?.find((mark) => mark.name === RENDER)?.startTime;
  if (!Number.isFinite(start) || !Number.isFinite(render) || render < start)
    return incomplete('Missing ordered document-start/first-render ResourceTiming boundaries.');
  if (!Array.isArray(page.resources)) return incomplete('Missing resources array.');
  const route = (entry) => String(entry.route ?? '').split(/[?#]/u)[0];
  const fonts = page.resources.filter((entry) => /\.(?:woff2?|ttf|otf)$/iu.test(route(entry)));
  const noto = page.resources.filter((entry) => /\/noto[^/]*\/index\.css$/iu.test(route(entry)));
  const observedComplete = [...fonts, ...noto].every(completed);
  const group = (entries) => ({
    startedBeforeRender: stats(entries.filter((entry) => entry.startTime < render)),
    completedByRender: stats(
      entries.filter((entry) => completed(entry) && entry.responseEnd <= render),
    ),
    allReady: stats(entries.filter(completed)),
  });
  return {
    complete: observedComplete,
    ...(observedComplete
      ? {}
      : { reason: 'Some observed font/stylesheet requests have incomplete timing.' }),
    observedComplete,
    documentToRenderMs: render - start,
    renderAtMs: render,
    fonts: group(fonts),
    notoStylesheets: group(noto),
    interpretation:
      'allReady includes entries completed by collection, including requests after render. Cache hits mean ResourceTiming transferSize=0 and encodedBodySize>0; bytes are whole responses, never clipped or attributed to time before render.',
  };
}

/** Reject missing/invalid samples instead of silently changing the sample count. */
export function median(values) {
  if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite)) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
