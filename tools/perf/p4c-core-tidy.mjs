// Behavior-preserving consolidation: actual file writes, with no model or network work.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const allowed = fileURLToPath(
  new URL('../../.sciencescope-local/temp/p4c/part6/', import.meta.url),
);
const { values } = parseArgs({
  options: {
    phase: { type: 'string' },
    source: { type: 'string' },
    out: { type: 'string' },
    baseline: { type: 'string' },
  },
});
if (!['before', 'after'].includes(values.phase) || !values.out)
  throw new Error(
    'Use --phase before|after --out <receipt.json> [--source checkout] [--baseline before.json].',
  );
const output = path.resolve(values.out);
if (!output.startsWith(allowed))
  throw new Error('Receipts belong under .sciencescope-local/temp/p4c/part6.');
const source = values.source
  ? path.resolve(values.source)
  : fileURLToPath(new URL('../../', import.meta.url));
const sourceImport = (file) => import(pathToFileURL(path.join(source, file)).href);
const [
  { DEFAULT_SETTINGS },
  { DEFAULT_MEMORY_SETTINGS },
  { DEFAULT_SUMMARY, summarySettings },
  { writeTextAtomic },
  { writeAtomic },
  { readCredentials, saveKeys },
  { dataPaths },
] = await Promise.all([
  sourceImport('app/core/workspace/resources/settings.js'),
  sourceImport('app/services/memory/index.js'),
  sourceImport('app/services/secretary/policy.js'),
  sourceImport('app/core/workspace/files.js'),
  sourceImport('app/services/desk/storage.js'),
  sourceImport('app/services/providers.js'),
  sourceImport('app/core/paths.js'),
]);
await mkdir(allowed, { recursive: true });
const receipt = await open(output, 'wx');
const folder = await mkdtemp(path.join(allowed, 'core-tidy-'));
if (!path.resolve(folder).startsWith(allowed)) throw new Error('Unexpected fixture directory.');
const median = (samples) => [...samples].sort((a, b) => a - b)[1];
const definitions = {};
const sources = await Promise.all(
  [
    'app/core/workspace/resources/settings.js',
    'app/services/memory/index.js',
    'app/services/secretary/policy.js',
    'app/core/defaults.js',
    'app/core/workspace/files.js',
    'app/services/desk/storage.js',
    'app/services/providers.js',
    'app/core/files.js',
  ].map(async (file) => {
    try {
      return { file, text: await readFile(path.join(source, file), 'utf8') };
    } catch (error) {
      if (error.code === 'ENOENT') return { file, text: '' };
      throw error;
    }
  }),
);
definitions.memory = sources
  .filter(({ text }) =>
    /(?:memory:|DEFAULT_MEMORY_SETTINGS\s*=)\s*\{\s*enabled:\s*true,\s*idleMinutes:\s*10/.test(
      text,
    ),
  )
  .map(({ file }) => file);
definitions.summary = sources
  .filter(({ text }) =>
    /(?:summary:|DEFAULT_SUMMARY\s*=)\s*\{\s*afterDiscussion:\s*true/.test(text),
  )
  .map(({ file }) => file);
definitions.atomic = sources
  .filter(
    ({ text }) =>
      text.includes('randomUUID()}.tmp') && text.includes('await renameWithRetry(temporary, file)'),
  )
  .map(({ file }) => file);
const bytes = Buffer.from(Array.from({ length: 65536 }, (_, i) => i % 251));
const text = '中文科研记录\n'.repeat(4096);
const paths = dataPaths(folder);
async function measured(work, verify) {
  const samples = [];
  for (let run = 0; run < 4; run++) {
    const begin = performance.now();
    await work();
    const durationMs = performance.now() - begin;
    await verify();
    if (run) samples.push(durationMs);
  }
  return { samplesMs: samples, medianMs: median(samples) };
}
try {
  const workspace = path.join(folder, 'nested', 'notes.md');
  const desk = path.join(folder, 'desk', 'document.bin');
  const result = {
    schema: 1,
    phase: values.phase,
    node: process.version,
    generatedAt: new Date().toISOString(),
    protocol: {
      warmup: 1,
      runs: 3,
      modelRequests: 0,
      downloads: 0,
      osCaches: 'not cleared',
      purpose:
        'Behavior-preserving consolidation; timings are actual writes on the same volume, not an optimization target.',
    },
    definitions,
    defaults: {
      settingsMemory: DEFAULT_SETTINGS.memory,
      serviceMemory: DEFAULT_MEMORY_SETTINGS,
      settingsSummary: DEFAULT_SETTINGS.summary,
      policySummary: DEFAULT_SUMMARY,
      mergedSummary: summarySettings({ everyMessages: { n: 7 }, workbench: { plans: 'auto' } }),
    },
  };
  assert.deepEqual(DEFAULT_SETTINGS.memory, DEFAULT_MEMORY_SETTINGS);
  assert.deepEqual(DEFAULT_SETTINGS.summary, DEFAULT_SUMMARY);
  result.workspace = await measured(
    async () => {
      for (let index = 0; index < 8; index++) await writeTextAtomic(workspace, text);
    },
    async () => assert.equal(await readFile(workspace, 'utf8'), text),
  );
  result.desk = await measured(
    async () => {
      for (let index = 0; index < 8; index++) await writeAtomic(desk, bytes);
    },
    async () => assert.deepEqual(await readFile(desk), bytes),
  );
  result.credentials = await measured(
    async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          saveKeys(paths, { ['synthetic.' + i]: 'public-test-' + i }),
        ),
      );
      await Promise.all([
        saveKeys(paths, { 'synthetic.extra': 'public-extra' }),
        saveKeys(paths, {}, ['synthetic.0']),
      ]);
    },
    async () => {
      const { refs } = await readCredentials(paths);
      assert.equal(Object.keys(refs).length, 8);
      assert.equal(refs['synthetic.0'], undefined);
      assert.equal(refs['synthetic.extra'], 'public-extra');
    },
  );
  result.outputs = {
    textBytes: Buffer.byteLength(text),
    deskBytes: bytes.length,
    deskSha256: createHash('sha256')
      .update(await readFile(desk))
      .digest('hex'),
    credentialRefs: 8,
    nestedFiles: await readdir(path.dirname(workspace)),
    deskFiles: await readdir(path.dirname(desk)),
    credentialFiles: await readdir(paths.secret),
  };
  if (values.baseline) {
    const before = JSON.parse(await readFile(path.resolve(values.baseline), 'utf8'));
    assert.deepEqual(result.defaults, before.defaults);
    assert.deepEqual(result.outputs, before.outputs);
    result.beforeParity = true;
  }
  await receipt.writeFile(JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await receipt.close();
  await rm(folder, { recursive: true, force: true });
}
