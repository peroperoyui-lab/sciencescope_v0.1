// Pure parameter probes: no app, model, database or user settings are opened.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const cases = [
  { name: 'threshold-too-high', value: { threshold: 2, maxPerPaper: 3 }, legal: false },
  { name: 'negative-neighbours', value: { threshold: 0.85, maxPerPaper: -1 }, legal: false },
  { name: 'fractional-neighbours', value: { threshold: 0.85, maxPerPaper: 1.5 }, legal: false },
  { name: 'disabled', value: { threshold: 0.85, maxPerPaper: 0 }, legal: true },
  { name: 'lower-bound', value: { threshold: -1, maxPerPaper: 3 }, legal: true },
  { name: 'upper-bound', value: { threshold: 1, maxPerPaper: 3 }, legal: true },
  { name: 'no-added-cap', value: { threshold: 0.85, maxPerPaper: 1000000 }, legal: true },
];

async function outcome(work) {
  const start = performance.now();
  try {
    await work();
    return { accepted: true, milliseconds: performance.now() - start };
  } catch (error) {
    return {
      accepted: false,
      code: error.code ?? null,
      message: error.message,
      milliseconds: performance.now() - start,
    };
  }
}

/**
 * Observe save/use agreement; the empty graph isolates validation from indexing.
 * @param {{sourceRoot?: string}} [options]
 * @returns {Promise<any>}
 */
export async function measureSimilarity({
  sourceRoot = fileURLToPath(new URL('../../', import.meta.url)),
} = {}) {
  const load = (file) => import(pathToFileURL(path.resolve(sourceRoot, file)).href);
  const [{ settings }, { createDerived }] = await Promise.all([
    load('app/core/workspace/resources/settings.js'),
    load('app/services/knowledge/derived.js'),
  ]);
  const derived = createDerived({
    core: {
      db: { prepare: () => ({ all: () => [] }), transaction: (work) => work() },
      events: { record() {} },
    },
    research: { store: { listSources: () => [] } },
    semantic: { sourceNeighbors: async () => ({ rankings: [] }) },
  });
  const rows = [];
  for (const item of cases) {
    const save = await outcome(() =>
      settings.apply(null, 'patch', { changes: { knowledge: { similarity: item.value } } }),
    );
    const use = await outcome(() => derived.similar(null, item.value));
    rows.push({ ...item, save, use });
  }
  return {
    schema: 1,
    kind: 'pure-validation-with-empty-graph',
    rows,
    invalidSaveAccepted: rows.filter((row) => !row.legal && row.save.accepted).length,
    invalidUseAccepted: rows.filter((row) => !row.legal && row.use.accepted).length,
    legalAcceptedByBoth: rows.filter((row) => row.legal && row.save.accepted && row.use.accepted)
      .length,
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: { out: { type: 'string' }, source: { type: 'string' } },
  });
  if (!values.out) throw new Error('Use --out with an ignored result file.');
  const output = path.resolve(values.out);
  const allowed = path.resolve('.sciencescope-local/temp');
  if (!output.startsWith(allowed + path.sep))
    throw new Error('Results belong under .sciencescope-local/temp.');
  await mkdir(path.dirname(output), { recursive: true });
  const result = await measureSimilarity({ sourceRoot: values.source });
  await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(
    JSON.stringify({
      invalidSaveAccepted: result.invalidSaveAccepted,
      invalidUseAccepted: result.invalidUseAccepted,
      legalAcceptedByBoth: result.legalAcceptedByBoth,
    }),
  );
}
