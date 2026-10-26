import path from 'node:path';
import { writeFile } from 'node:fs/promises';

export function safeRoute(value) {
  try {
    return new URL(value).pathname.replace(
      /\b(?:prj|meeting|msg|version|vgroup|desk)_[\w-]+/g,
      ':id',
    );
  } catch {
    return '(native)';
  }
}

export const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
};

export function summarizeHttp(rows) {
  const groups = new Map();
  for (const row of rows.filter((entry) => entry.durationMs !== undefined)) {
    const key = `${row.method} ${row.route}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row.durationMs);
  }
  return [...groups]
    .map(([route, values]) => ({
      route,
      count: values.length,
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
    }))
    .sort((a, b) => b.p95 - a.p95);
}

export async function observePage(page, http, errors, phase) {
  const session = await page.context().newCDPSession(page);
  const pending = new Map();
  session.on('Network.requestWillBeSent', (event) => {
    const route = safeRoute(event.request.url);
    if (!route.startsWith('/api/')) return;
    pending.set(event.requestId, {
      route,
      method: event.request.method,
      operation: phase(),
      start: event.timestamp,
    });
  });
  session.on('Network.responseReceived', (event) => {
    const row = pending.get(event.requestId);
    if (row)
      Object.assign(row, {
        status: event.response.status,
        ttfbMs: (event.timestamp - row.start) * 1000,
      });
  });
  session.on('Network.loadingFinished', (event) => {
    const row = pending.get(event.requestId);
    if (!row) return;
    pending.delete(event.requestId);
    http.push({
      ...row,
      durationMs: (event.timestamp - row.start) * 1000,
      bytes: event.encodedDataLength,
    });
  });
  session.on('Network.loadingFailed', (event) => {
    const row = pending.get(event.requestId);
    if (row) http.push({ ...row, failed: event.errorText });
    pending.delete(event.requestId);
  });
  page.on('pageerror', (error) => errors.push({ operation: phase(), message: error.message }));
  await session.send('Network.enable');
  await session.send('Profiler.enable');
  return session;
}

export async function startProfile(session) {
  await session.send('Profiler.setSamplingInterval', { interval: 1000 });
  await session.send('Profiler.start');
}

export async function stopProfile(session, output, name) {
  const { profile } = await session.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const times = new Map();
  for (let index = 0; index < (profile.samples ?? []).length; index++) {
    const id = profile.samples[index];
    times.set(id, (times.get(id) ?? 0) + (profile.timeDeltas?.[index] ?? 0));
  }
  for (const node of profile.nodes) node.callFrame.url = safeRoute(node.callFrame.url);
  const heavy = [...times]
    .map(([id, microseconds]) => ({
      function: byId.get(id).callFrame.functionName || '(anonymous)',
      script: byId.get(id).callFrame.url,
      line: byId.get(id).callFrame.lineNumber + 1,
      selfMs: microseconds / 1000,
    }))
    .sort((a, b) => b.selfMs - a.selfMs);
  await writeFile(path.join(output, `${name}.cpuprofile`), JSON.stringify(profile));
  return {
    topFunctions: heavy
      .filter((entry) => !['(idle)', '(program)'].includes(entry.function))
      .slice(0, 20),
    idleMs: heavy
      .filter((entry) => entry.function === '(idle)')
      .reduce((sum, entry) => sum + entry.selfMs, 0),
    sampledMs: heavy.reduce((sum, entry) => sum + entry.selfMs, 0),
    samples: profile.samples?.length ?? 0,
  };
}
