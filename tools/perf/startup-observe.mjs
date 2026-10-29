// Diagnostic startup pass only: sampling perturbs timing, so keep the normal
// startup baseline on observe.mjs and compare its existing application marks.
import './observe.mjs';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { Session } from 'node:inspector';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

function scriptPath(value) {
  const normalized = String(value).replaceAll('\\', '/');
  const app = normalized.lastIndexOf('/app/');
  const dependency = normalized.lastIndexOf('/node_modules/');
  if (app >= 0) return normalized.slice(app);
  if (dependency >= 0) return normalized.slice(dependency);
  return normalized.startsWith('file:') ? '(external)' : normalized;
}

/** Samples are time-weighted stack observations, not elapsed phase durations.
 * Inclusive groups overlap: a migration may also be inside openDatabase.
 * @param {any} profile
 */
export function summarizeStartupProfile(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const self = new Map();
  const groups = { databaseOpen: 0, databaseMigrations: 0, projectIndex: 0 };
  let sampledMs = 0;
  let idleMs = 0;
  for (let index = 0; index < (profile.samples ?? []).length; index++) {
    const id = profile.samples[index];
    const ms = (profile.timeDeltas?.[index] ?? 0) / 1000;
    sampledMs += ms;
    self.set(id, (self.get(id) ?? 0) + ms);
    if (nodes.get(id)?.callFrame.functionName === '(idle)') idleMs += ms;
    const matched = new Set();
    for (let cursor = id; cursor !== undefined; cursor = parents.get(cursor)) {
      const frame = nodes.get(cursor)?.callFrame;
      if (!frame) break;
      const script = scriptPath(frame.url);
      if (script === '/app/core/db/database.js' && frame.functionName === 'openDatabase')
        matched.add('databaseOpen');
      if (script.startsWith('/app/core/db/migrations/')) matched.add('databaseMigrations');
      if (/\/app\/services\/knowledge\/project-(?:index|copies)/u.test(script))
        matched.add('projectIndex');
    }
    for (const group of matched) groups[group] += ms;
  }
  return {
    sampledMs,
    idleMs,
    samples: profile.samples?.length ?? 0,
    inclusiveSampledStackMs: groups,
    topFunctions: [...self]
      .map(([id, selfSampledMs]) => ({
        function: nodes.get(id).callFrame.functionName || '(anonymous)',
        script: scriptPath(nodes.get(id).callFrame.url),
        line: nodes.get(id).callFrame.lineNumber + 1,
        selfSampledMs,
      }))
      .filter((row) => !['(idle)', '(program)', '(root)'].includes(row.function))
      .sort((a, b) => b.selfSampledMs - a.selfSampledMs)
      .slice(0, 30),
  };
}

const output =
  process.env.SCIENCESCOPE_PERF_STARTUP ??
  (process.env.SCIENCESCOPE_PERF_HTTP &&
    path.join(path.dirname(process.env.SCIENCESCOPE_PERF_HTTP), `startup-${process.pid}`));
if (output) {
  const observedStartMs = performance.timeOrigin + performance.now();
  const cpuStart = process.cpuUsage();
  const session = new Session();
  session.connect();
  const post = (method, params = {}) =>
    new Promise((resolve, reject) =>
      session.post(method, params, (error, result) => (error ? reject(error) : resolve(result))),
    );
  await post('Profiler.enable');
  await post('Profiler.setSamplingInterval', { interval: 1000 });
  await post('Profiler.start');
  const profileStartMs = performance.timeOrigin + performance.now();
  let stopping;
  const finish = (reason) => {
    if (stopping) return stopping;
    const observedEndMs = performance.timeOrigin + performance.now();
    const cpu = process.cpuUsage(cpuStart);
    unsubscribe('http.server.request.start', requestStarted);
    process.off('beforeExit', beforeExit);
    stopping = (async () => {
      try {
        const { profile } = await post('Profiler.stop');
        const report = {
          schema: 1,
          pid: process.pid,
          reason,
          observedStartMs,
          profileStartMs,
          observedEndMs,
          observedWallMs: observedEndMs - observedStartMs,
          processCpuMs: { user: cpu.user / 1000, system: cpu.system / 1000 },
          nodeTiming: performance.nodeTiming.toJSON(),
          ...summarizeStartupProfile(profile),
          interpretation:
            'Diagnostic sampling pass. Sample weights describe observed stacks; they are not phase wall durations or exact CPU usage. Inclusive groups overlap. Async waits and unsampled work need existing startup marks for wall bounds.',
        };
        for (const node of profile.nodes) node.callFrame.url = scriptPath(node.callFrame.url);
        await mkdir(path.dirname(path.resolve(output)), { recursive: true });
        await writeFile(`${output}.cpuprofile`, JSON.stringify(profile));
        await writeFile(`${output}.json`, JSON.stringify(report, null, 2) + '\n');
      } finally {
        session.disconnect();
      }
    })().catch(() => {
      process.stderr.write('Startup performance observation could not be written.\n');
    });
    return stopping;
  };
  function requestStarted({ request, response }) {
    if (request.method === 'POST' && String(request.url).split('?')[0] === '/api/startup/rendered')
      response.once('finish', () => void finish('page-rendered-response'));
  }
  function beforeExit() {
    void finish('before-exit');
  }
  subscribe('http.server.request.start', requestStarted);
  process.once('beforeExit', beforeExit);
}
