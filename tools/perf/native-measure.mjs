import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { launchNative, prepareCold, until } from './native-host.mjs';
import { p4bActions, waitComparison } from './p4b-actions.mjs';
import {
  observePage,
  startProfile,
  stopProfile,
  summarizeHttp,
  percentile,
  safeRoute,
} from './native-profile.mjs';

const { values } = parseArgs({
  options: {
    install: { type: 'string' },
    data: { type: 'string' },
    manifest: { type: 'string' },
    out: { type: 'string' },
    mode: { type: 'string', default: 'warm' },
    runs: { type: 'string', default: '3' },
    port: { type: 'string', default: '9390' },
    'cold-hook': { type: 'string' },
    observer: { type: 'string' },
    'startup-only': { type: 'boolean', default: false },
    label: { type: 'string', default: 'baseline' },
    p4b: { type: 'boolean', default: false },
  },
});
for (const key of ['install', 'data', 'manifest', 'out'])
  assert.ok(values[key], `--${key} required`);
assert.ok(['warm', 'cold', 'fresh-process'].includes(values.mode));
assert.ok(
  Number.isInteger(Number(values.runs)) && Number(values.runs) > 0,
  '--runs must be a positive integer',
);
const output = path.resolve(values.out);
assert.ok(
  output.includes(`${path.sep}.sciencescope-local${path.sep}`),
  'Evidence belongs under .sciencescope-local',
);
await mkdir(output, { recursive: true });
const manifest = JSON.parse(await readFile(values.manifest, 'utf8'));
if (values.p4b) assert.equal(manifest.p4b?.phase, 'complete', 'P4b requires its extended manifest');
async function homeReady(page) {
  if (values.p4b) {
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
  } else
    await page.locator('.listrow').filter({ hasText: manifest.homeProjectName }).first().waitFor();
}
async function documentState() {
  const bytes = await readFile(path.join(manifest.projectFolder, manifest.docx));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    sha256,
    bytes: bytes.length,
    matchesSeed: sha256 === manifest.files.find((file) => file.path === manifest.docx)?.sha256,
  };
}
const report = {
  label: values.label,
  mode: values.mode,
  runs: [],
  windows: [],
  startedAt: new Date().toISOString(),
  timingDefinition:
    'Actual installed executable spawn to observed DOM readiness; CDP attachment bounds earliest observation. Browser HTTP summaries span the broad profiler phase and are diagnostic only. Authoritative server HTTP summaries use backend-http.jsonl filtered by exact report.windows.',
};
const save = () =>
  writeFile(path.join(output, 'native-measure.json'), JSON.stringify(report, null, 2));
let native;
// Warm process starts follow one untimed launch of the same installed product.
// A fresh-process run deliberately makes no claim about OS file-cache state.
if (values.mode === 'warm') {
  const warmup = await launchNative({
    install: path.resolve(values.install),
    data: path.resolve(values.data),
    port: Number(values.port),
    onPage: async () => {},
  });
  try {
    await warmup.main.getByRole('textbox', { name: '主输入框', exact: true }).waitFor();
    await homeReady(warmup.main);
    report.warmup = { ready: true };
  } finally {
    report.warmupShutdown = await warmup.close();
  }
}
for (let index = 1; index <= Number(values.runs); index++) {
  const row = { index, operations: [], http: [], errors: [], indexProgress: [], cold: null };
  row.documentBefore = await documentState();
  assert.ok(row.documentBefore.matchesSeed, 'Each sample requires the original seeded DOCX bytes');
  report.runs.push(row);
  let phase = 'startup';
  const sessions = new Map();
  async function observe(page) {
    const session = await observePage(page, row.http, row.errors, () => phase, row.indexProgress);
    if (phase === 'startup') await startProfile(session);
    sessions.set(page, session);
  }
  async function operation(name, page, action) {
    phase = name;
    const session = await until(() => sessions.get(page));
    await startProfile(session);
    const started = performance.now();
    const result = { name, ok: false, startMs: Date.now() };
    try {
      result.detail = await action();
      result.ms = performance.now() - started;
      result.ok = true;
    } catch (error) {
      process.exitCode = 1;
      result.ms = performance.now() - started;
      result.error = error.message.replace(/https?:\/\/\S+/g, '(URL omitted)');
      await page
        .screenshot({ path: path.join(output, `run-${index}-${name}-failure.png`) })
        .catch(() => {});
    } finally {
      result.endMs = Date.now();
      report.windows.push({ name, run: index, startMs: result.startMs, endMs: result.endMs });
      result.cpu = await stopProfile(session, output, `run-${index}-${name}`).catch((error) => ({
        error: error.message,
      }));
      row.operations.push(result);
      phase = 'idle';
      await save();
    }
    console.log(JSON.stringify({ run: index, operation: name, ok: result.ok, ms: result.ms }));
    return result;
  }
  try {
    if (values.mode === 'cold') row.cold = await prepareCold(values['cold-hook'], index);
    native = await launchNative({
      install: path.resolve(values.install),
      data: path.resolve(values.data),
      port: Number(values.port),
      onPage: observe,
      observer: values.observer,
      observerOutput: path.join(output, 'backend-http.jsonl'),
    });
    const page = native.main;
    row.cdpAttachedMs = native.attachedMs;
    await page.getByRole('textbox', { name: '主输入框', exact: true }).waitFor();
    await until(() => page.getByRole('textbox', { name: '主输入框', exact: true }).isEnabled());
    row.inputEnabledMs = performance.now() - native.started;
    await page
      .locator('.ss-sidebar')
      .getByText(manifest.homeProjectName, { exact: true })
      .first()
      .waitFor();
    await homeReady(page);
    row.homeDataReadyMs = performance.now() - native.started;
    report.windows.push({
      name: 'startup',
      run: index,
      startMs: Date.now() - row.homeDataReadyMs,
      endMs: Date.now(),
    });
    row.startupCpu = await stopProfile(sessions.get(page), output, `run-${index}-startup`);
    row.startupResources = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => new URL(entry.name).pathname.startsWith('/api/'))
        .map((entry) => ({
          route: new URL(entry.name).pathname,
          startMs: entry.startTime,
          durationMs: entry.duration,
        })),
    );
    row.startupResources.forEach(
      (entry) => (entry.route = safeRoute('http://local' + entry.route)),
    );
    row.navigation = await page.evaluate(() =>
      performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
    );
    row.scriptResources = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .filter((entry) => ['script', 'link'].includes(entry.initiatorType))
        .map((entry) => ({
          route: new URL(entry.name).pathname,
          startMs: entry.startTime,
          durationMs: entry.duration,
          initiatorType: entry.initiatorType,
        })),
    );
    if (!values['startup-only']) {
      const nav = (route) =>
        page.evaluate((route) => {
          location.hash = route;
        }, route);
      await operation('chat-open', page, async () => {
        await nav('/meeting/' + manifest.longestMeetingId);
        const message = page.locator(`[data-message-id="${manifest.lastMessageId}"]`);
        await message.waitFor();
        await message.scrollIntoViewIfNeeded();
        assert.ok(await message.isVisible());
        return { lastMessageId: manifest.lastMessageId };
      });
      await operation('chat-earlier', page, async () => {
        const before = await page
          .locator('[data-message-id]')
          .first()
          .getAttribute('data-message-id');
        await page
          .getByRole('button', { name: '加载更早的消息', exact: true })
          .scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: '加载更早的消息', exact: true }).click();
        await page.waitForFunction(
          (id) =>
            document.querySelector('[data-message-id]')?.getAttribute('data-message-id') !== id,
          before,
        );
        await page.locator('[data-message-id]').first().scrollIntoViewIfNeeded();
        return {
          previousFirst: before,
          loadedFirst: await page
            .locator('[data-message-id]')
            .first()
            .getAttribute('data-message-id'),
        };
      });
      await operation('library-open', page, async () => {
        await nav('/database/' + manifest.projectId);
        await page.locator('[data-rb-source]').first().waitFor();
        return { visibleRows: await page.locator('[data-rb-source]').count() };
      });
      await operation('library-search', page, async () => {
        const search = page.getByLabel('统一检索资料与条目');
        await search.fill(manifest.searchTerm);
        await search.press('Enter');
        await page.locator('[data-rb-search-results] mark').first().waitFor();
        return { results: await page.locator('[data-hit-type]').count() };
      });
      await operation('library-graph', page, async () => {
        await nav('/library');
        await page.getByRole('button', { name: '图', exact: true }).click();
        await page.waitForFunction(
          (expected) => {
            const map = document.querySelector('[data-kb-map]')?.knowledgeMap;
            return map?.cy?.nodes().length > 0 && (!expected || map.size === expected);
          },
          values.p4b ? manifest.counts.paperSources + 1 : null,
        );
        const graph = await page.evaluate(() => {
          const host = document.querySelector('[data-kb-map]');
          return {
            nodes: host.knowledgeMap.cy.nodes().length,
            edges: host.knowledgeMap.cy.edges().length,
            indexedNodes: host.knowledgeMap.size,
          };
        });
        if (values.p4b) assert.equal(graph.indexedNodes, manifest.counts.paperSources + 1);
        else assert.equal(graph.nodes, manifest.counts.paperSources);
        return graph;
      });
      if (values.p4b) await p4bActions({ page, manifest, operation, output, index });
      // Create the empty native desk before profiling document open so the same
      // CDP profiler covers its complete parsing/rendering operation in every run.
      await page.evaluate(async () => (await import('/desk-window.js')).openDesk());
      const desk = await until(() =>
        native.browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((candidate) => candidate.url().includes('surface=desk')),
      );
      desk.setDefaultTimeout(120000);
      if (!sessions.has(desk)) await observe(desk);
      await desk.locator('.ss-desk').waitFor();
      if (values.p4b)
        assert.equal(
          await desk.locator('.ss-page--edit[contenteditable="true"]').count(),
          0,
          'DOCX open requires a desk without a preloaded editor',
        );
      await operation('docx-open', desk, async () => {
        await page.evaluate(async (target) => (await import('/desk-window.js')).openDesk(target), {
          projectId: manifest.projectId,
          path: manifest.docx,
        });
        const editor = desk.locator('.ss-page--edit[contenteditable="true"]');
        await editor.waitFor();
        assert.ok(await editor.isEditable());
        return { paragraphs: await editor.locator('p').count() };
      });
      await operation('version-tree-open', desk, async () => {
        await desk.locator('.ss-statusbar').getByRole('button', { name: '版本树' }).click();
        const tree = desk.getByRole('tree', { name: '版本', exact: true });
        await tree.waitFor();
        await tree.getByRole('treeitem', { name: /^v1\b/u }).waitFor();
        await tree.getByRole('treeitem', { name: /^v2\b/u }).waitFor();
        const nodes = await tree.getByRole('treeitem').count();
        if (values.p4b) assert.equal(nodes, manifest.p4b.versions);
        else assert.ok(nodes >= manifest.compareVersionIds.length);
        return { nodes, visible: await tree.isVisible() };
      });
      await desk.screenshot({ path: path.join(output, `run-${index}-version-tree.png`) });
      await desk.getByRole('button', { name: '关闭版本树', exact: true }).click();
      await operation('docx-edit-writeback', desk, async () => {
        const paragraphs = desk.locator('.ss-page--edit p');
        const middle = paragraphs.nth(Math.floor((await paragraphs.count()) / 2));
        await middle.click();
        await desk.keyboard.press('End');
        const response = desk.waitForResponse(
          (response) =>
            /\/api\/desk\/sessions\/[^/]+\/save$/.test(new URL(response.url()).pathname) &&
            response.request().method() === 'POST',
        );
        await desk.keyboard.type(`性能测量第${index}次合成补充句。`);
        await desk.getByRole('button', { name: '保存', exact: true }).click();
        const saved = await response;
        assert.ok(saved.ok());
        const body = await saved.json();
        assert.equal(body.session.seq, body.session.savedSeq);
        await desk.locator('[data-save="saved"]').waitFor();
        return { seq: body.session.seq, savedSeq: body.session.savedSeq };
      });
      // Restore the actual editor change outside the measured operation so each
      // run starts with identical document text, without bypassing the UI.
      await desk.locator('.ss-page--edit').click();
      await desk.keyboard.press('Control+z');
      const restored = desk.waitForResponse(
        (response) =>
          /\/api\/desk\/sessions\/[^/]+\/save$/.test(new URL(response.url()).pathname) &&
          response.request().method() === 'POST',
      );
      await desk.keyboard.press('Control+s');
      assert.ok((await restored).ok());
      if (values.p4b) {
        await operation('version-diff', desk, async () => {
          await desk.locator('.ss-statusbar').getByRole('button', { name: '版本树' }).click();
          await desk
            .getByRole('tree', { name: '版本', exact: true })
            .getByRole('treeitem', { name: /^v2\b/u })
            .click();
          await desk.getByRole('button', { name: /^和 v\d+ 比较$/u }).click();
          return waitComparison(desk);
        });
      } else
        await operation('version-diff', page, async () => {
          const comparison = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return (
              url.pathname.endsWith(`/versions/${manifest.compareVersionIds[1]}/diff`) &&
              url.searchParams.get('baseline') === manifest.compareVersionIds[0]
            );
          });
          await nav('/version-diff/' + manifest.projectId + '/' + manifest.compareVersionIds[1]);
          assert.ok((await comparison).ok());
          await page.locator('[data-compare="ready"] .ss-cmp__col').first().waitFor();
          await page.waitForFunction(() => {
            const pages = document.querySelectorAll('[data-compare="ready"] article.ss-page');
            return (
              pages.length === 2 &&
              [...pages].every((article) => article.textContent.trim().length > 0)
            );
          });
          const response = row.http.filter((entry) => entry.route.endsWith('/diff')).at(-1);
          return {
            columns: await page.locator('.ss-cmp__col').count(),
            expectedVersions: manifest.compareVersionIds,
            diffRequestObserved: !!response,
          };
        });
      await page.screenshot({ path: path.join(output, `run-${index}-completed.png`) });
      await nav('/');
    }
  } catch (error) {
    row.fatal = error.message.replace(/https?:\/\/\S+/g, '(URL omitted)');
    process.exitCode = 1;
  } finally {
    phase = 'shutdown';
    if (native) row.shutdown = await native.close().catch((error) => ({ error: error.message }));
    native = null;
    try {
      const records = (await readFile(path.join(values.data, 'logs', 'startup.log'), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      row.startupRecord = records.at(-1);
    } catch (error) {
      row.startupRecordError = error.message;
    }
    row.documentAfter = await documentState();
    row.documentRestored =
      row.documentBefore.sha256 === row.documentAfter.sha256 && row.documentAfter.matchesSeed;
    if (!row.documentRestored) process.exitCode = 1;
    row.httpSummary = summarizeHttp(
      row.http.filter((entry) => entry.operation !== 'idle' && entry.operation !== 'shutdown'),
    );
    await save();
  }
}
report.medians = Object.fromEntries(
  ['inputEnabledMs', 'homeDataReadyMs'].map((name) => [
    name,
    percentile(report.runs.map((run) => run[name]).filter(Number.isFinite), 0.5),
  ]),
);
for (const name of new Set(
  report.runs.flatMap((run) => run.operations.map((operation) => operation.name)),
)) {
  const results = report.runs.flatMap((run) =>
    run.operations.filter((operation) => operation.name === name && operation.ok),
  );
  report.medians[name] = {
    successfulRuns: results.length,
    ms: percentile(
      results.map((result) => result.ms),
      0.5,
    ),
  };
}
report.httpTop10 = summarizeHttp(
  report.runs.flatMap((run) =>
    run.http.filter((entry) => entry.operation !== 'idle' && entry.operation !== 'shutdown'),
  ),
).slice(0, 10);
report.finishedAt = new Date().toISOString();
await save();
console.log(JSON.stringify({ medians: report.medians, httpTop10: report.httpTop10 }));
