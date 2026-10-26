import { subscribe } from 'node:diagnostics_channel';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const literals = new Set(
  'api activity projects meetings messages turns contexts focus files index research sources chunks search items knowledge graph layout viewport positions entities edges labels memberships session versions version-groups version-tiers version-preferences import compare diff save-as-new baseline organize rename export notes open open-notes minutes refresh memory status inbox brief history revisions undo redo restore decisions cards estimate build retry settings models participants agents workspace read edit desk documents sessions blocks text annotations changes save close media tex engines compile pdf preview document system startup approvals pending health tools skills semantic'.split(
    ' ',
  ),
);

/**
 * @param {string} url
 * @returns {string}
 */
export function normalizedPath(url) {
  const pathname = String(url ?? '').split(/[?#]/u)[0];
  return pathname
    .split('/')
    .map((part) => (part && !literals.has(part) ? ':id' : part))
    .join('/');
}

const output = process.env.SCIENCESCOPE_PERF_HTTP;
if (output) {
  let pending = mkdir(path.dirname(path.resolve(output)), { recursive: true });
  subscribe('http.server.request.start', ({ request, response }) => {
    if (!String(request.url).startsWith('/api/')) return;
    const startMs = performance.timeOrigin + performance.now();
    const started = performance.now();
    response.once('finish', () => {
      if (String(response.getHeader('content-type') ?? '').includes('text/event-stream')) return;
      const record = {
        schema: 1,
        pid: process.pid,
        method: request.method,
        path: normalizedPath(request.url),
        status: response.statusCode,
        startMs,
        durationMs: performance.now() - started,
      };
      pending = pending
        .then(() => appendFile(output, JSON.stringify(record) + '\n', 'utf8'))
        .catch(() => {
          process.stderr.write('Performance HTTP observation could not be written.\n');
        });
    });
  });
}

function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}

/**
 * @param {any[]} rows
 * @param {{startMs:number,endMs:number}[]} windows
 */
export function summarizeHttp(rows, windows) {
  const groups = new Map();
  let selected = 0;
  for (const row of rows) {
    if (!windows.some((window) => row.startMs >= window.startMs && row.startMs <= window.endMs))
      continue;
    if (!Number.isFinite(row.durationMs)) continue;
    selected++;
    const key = `${row.method} ${row.path}`;
    const group = groups.get(key) ?? {
      method: row.method,
      path: row.path,
      durations: [],
      failures: 0,
    };
    group.durations.push(row.durationMs);
    if (row.status >= 400) group.failures++;
    groups.set(key, group);
  }
  const endpoints = [...groups.values()]
    .map(({ durations, ...group }) => ({
      ...group,
      count: durations.length,
      p50Ms: quantile(durations, 0.5),
      p95Ms: quantile(durations, 0.95),
      maxMs: Math.max(...durations),
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);
  return {
    schema: 1,
    selectedRequests: selected,
    windows: windows.length,
    endpoints,
    slowest: endpoints.slice(0, 10),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => {
      if (index % 2 === 0) pairs.push([value.replace(/^--/u, ''), all[index + 1]]);
      return pairs;
    }, []),
  );
  if (!args.input || !args.windows || !args.out) {
    process.stderr.write(
      'Usage: node tools/perf/observe.mjs --input http.jsonl --windows actions.json --out summary.json\n',
    );
    process.exitCode = 1;
  } else {
    const rows = (await readFile(args.input, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
    const report = JSON.parse(await readFile(args.windows, 'utf8'));
    const result = summarizeHttp(rows, report.windows ?? report);
    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await writeFile(args.out, JSON.stringify(result, null, 2) + '\n');
    process.stdout.write(
      JSON.stringify({
        selectedRequests: result.selectedRequests,
        endpoints: result.endpoints.length,
      }) + '\n',
    );
  }
}
