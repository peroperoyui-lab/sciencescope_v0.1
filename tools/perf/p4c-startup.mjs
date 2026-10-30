import assert from 'node:assert/strict';
import { mkdir, open, readFile, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { launchNative, prepareCold, until } from './native-host.mjs';
import { safeRoute } from './native-profile.mjs';
import {
  sanitizeTrace,
  summarizeStartupSplit,
  summarizeStartupTrace,
} from './p4c-startup-summary.mjs';

const { values } = parseArgs({
  options: {
    install: { type: 'string' },
    data: { type: 'string' },
    out: { type: 'string' },
    manifest: { type: 'string' },
    mode: { type: 'string', default: 'warm' },
    runs: { type: 'string', default: '3' },
    port: { type: 'string', default: '9398' },
    'cold-hook': { type: 'string' },
    label: { type: 'string', default: 'before' },
  },
});
for (const key of ['install', 'data', 'out']) assert.ok(values[key], `--${key} required`);
assert.ok(['warm', 'cold', 'fresh-process', 'diagnostic'].includes(values.mode));
assert.ok(Number.isInteger(Number(values.runs)) && Number(values.runs) > 0);
if (values.mode === 'diagnostic')
  assert.equal(Number(values.runs), 1, 'Diagnostic tracing is one separate run; use --runs 1.');
const output = path.resolve(values.out);
const allowed = path.resolve('.sciencescope-local/temp/p4c/part5');
assert.ok(
  output.startsWith(allowed + path.sep),
  'Evidence belongs under .sciencescope-local/temp/p4c/part5.',
);
await mkdir(output, { recursive: true });
const receipt = await open(path.join(output, 'startup-native.json'), 'wx');
const report = {
  schema: 1,
  kind: 'native-startup-split',
  label: values.label,
  mode: values.mode,
  node: process.version,
  startedAt: new Date().toISOString(),
  runs: [],
  protocol:
    'Actual isolated installed executable. Low-overhead native/browser marks for normal samples; no CPU profiler or tracing in warm/cold samples. First-screen report protocol remains unchanged. OS-cache purge receipts are required for cold samples. Tracing is one separate diagnostic.',
};
let manifest;
const startupFile = path.join(path.resolve(values.data), 'logs/startup.log');
async function records(file) {
  try {
    return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
async function ready(page) {
  const input = page.getByRole('textbox', { name: '主输入框', exact: true });
  await input.waitFor();
  await until(() => input.isEnabled());
  if (manifest?.homeProjectName) {
    await page
      .locator('.ss-sidebar')
      .getByText(manifest.homeProjectName, { exact: true })
      .first()
      .waitFor();
    await page
      .locator('.ss-home .ss-list')
      .getByText(manifest.homeProjectName, { exact: true })
      .first()
      .waitFor();
  }
  await until(() =>
    page.evaluate(
      () => performance.getEntriesByName('sciencescope.first-render-report').length > 0,
    ),
  );
}
async function launch(index, diagnostic = false) {
  const nativeFile = path.join(output, `run-${index}-native.jsonl`);
  await writeFile(nativeFile, '', { flag: 'wx' });
  const rawTrace = path.join(output, `run-${index}-trace.raw.json`);
  const browserArguments = diagnostic
    ? `--trace-startup=devtools.timeline,v8,blink.user_timing,loading,disabled-by-default-v8.compile --trace-startup-file="${rawTrace}" --trace-startup-duration=20 --trace-startup-format=json`
    : '';
  return launchNative({
    install: path.resolve(values.install),
    data: path.resolve(values.data),
    port: Number(values.port),
    onPage: async () => {},
    nativeStartupOutput: nativeFile,
    extraBrowserArguments: browserArguments,
  });
}
try {
  const bundledNode = await promisify(execFile)(
    path.join(path.resolve(values.install), 'runtime/node.exe'),
    ['--version'],
    { windowsHide: true, timeout: 5000 },
  );
  report.hostNodeVersion = bundledNode.stdout.trim();
  assert.match(report.hostNodeVersion, /^v22\./u, 'The isolated install must bundle Node 22.');
  manifest = values.manifest ? JSON.parse(await readFile(values.manifest, 'utf8')) : null;
  if (values.mode === 'warm') {
    const native = await launch('warmup');
    try {
      await ready(native.main);
      report.warmup = { ready: true };
    } finally {
      report.warmupShutdown = await native.close();
    }
  }
  for (let index = 1; index <= Number(values.runs); index++) {
    const row = { index };
    report.runs.push(row);
    const previous = (await records(startupFile)).length;
    if (values.mode === 'cold') row.cold = await prepareCold(values['cold-hook'], index);
    let native;
    let runError;
    try {
      native = await launch(index, values.mode === 'diagnostic');
      await ready(native.main);
      row.domReadyMs = performance.now() - native.started;
      row.cdpAttachedMs = native.attachedMs;
      row.startup = await until(async () =>
        (await records(startupFile)).slice(previous).find((entry) => entry.points.pageRendered),
      );
      row.native = await records(path.join(output, `run-${index}-native.jsonl`));
      assert.ok(row.native.some((entry) => entry.stage === 'mainWebviewBuildEnd'));
      row.page = await native.main.evaluate(() => ({
        timeOrigin: performance.timeOrigin,
        marks: performance
          .getEntriesByType('mark')
          .filter((entry) => entry.name.startsWith('sciencescope.'))
          .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
        navigation: performance.getEntriesByType('navigation').map((entry) => ({
          startTime: entry.startTime,
          requestStart: entry.requestStart,
          responseStart: entry.responseStart,
          responseEnd: entry.responseEnd,
          domInteractive: entry.domInteractive,
          domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
          loadEventEnd: entry.loadEventEnd,
        })),
        resources: performance.getEntriesByType('resource').map((entry) => ({
          route: new URL(entry.name).pathname,
          initiatorType: entry.initiatorType,
          startTime: entry.startTime,
          requestStart: entry.requestStart,
          responseStart: entry.responseStart,
          responseEnd: entry.responseEnd,
          duration: entry.duration,
          encodedBodySize: entry.encodedBodySize,
          transferSize: entry.transferSize,
        })),
        paints: performance
          .getEntriesByType('paint')
          .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
        observersDisconnected: window.__SCIENCESCOPE_STARTUP_OBSERVE__?.observersDisconnected,
      }));
      row.page.resources.forEach((entry) => {
        entry.route = safeRoute('http://local' + entry.route);
      });
      assert.ok(row.page.observersDisconnected);
      for (const name of [
        'sciencescope.document-start',
        'sciencescope.app-first-child',
        'sciencescope.first-render-report',
      ])
        assert.ok(
          row.page.marks.some((entry) => entry.name === name),
          `Missing startup mark: ${name}`,
        );
      row.split = summarizeStartupSplit(row.startup, row.native, row.page);
      if (values.mode === 'diagnostic') {
        const rawTrace = path.join(output, `run-${index}-trace.raw.json`);
        await until(async () => {
          try {
            return (await stat(rawTrace)).size > 0;
          } catch {
            return false;
          }
        }, 60000);
      }
    } catch (error) {
      row.error = error.message;
      runError = error;
    } finally {
      if (native) row.shutdown = await native.close();
    }
    if (values.mode === 'diagnostic') {
      const rawTrace = path.resolve(output, `run-${index}-trace.raw.json`);
      assert.ok(rawTrace.startsWith(output + path.sep));
      try {
        const trace = sanitizeTrace(JSON.parse(await readFile(rawTrace, 'utf8')));
        await writeFile(path.join(output, `run-${index}-trace.json`), JSON.stringify(trace), {
          flag: 'wx',
        });
        await rm(rawTrace);
        row.trace = summarizeStartupTrace(trace);
      } catch (error) {
        row.trace = { complete: false, error: error.message };
        runError ??= error;
      }
    }
    if (runError) throw runError;
    console.log(
      JSON.stringify({ run: index, mode: values.mode, split: row.split, trace: row.trace }),
    );
  }
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  report.medians = Object.fromEntries(
    [
      'httpReadyToRenderMs',
      'webviewBuildMs',
      'webviewBuildToDocumentStartMs',
      'documentStartToFirstChildMs',
      'firstChildToRenderReportMs',
    ].map((key) => [key, median(report.runs.map((row) => row.split[key]))]),
  );
  report.finishedAt = new Date().toISOString();
  await receipt.writeFile(JSON.stringify(report, null, 2));
} catch (error) {
  report.failed = true;
  report.error = error.stack;
  await receipt.writeFile(JSON.stringify(report, null, 2));
  throw error;
} finally {
  await receipt.close();
}
