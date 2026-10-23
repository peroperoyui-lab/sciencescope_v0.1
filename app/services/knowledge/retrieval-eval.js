import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCore } from '../../core/index.js';
import { createResearch } from '../research/index.js';
import { createSemantic } from '../research/semantic/index.js';
import { createEmbedding } from '../research/semantic/embedding.js';
import { buildRetrievalFixture } from './retrieval-fixture.js';

/**
 * Reproducible Hit@3 and Recall@12; each question has explicit source labels.
 * No answer generation, query rewriting, remote inference or model reranking.
 * @param {any} core
 * @param {any} semantic
 * @param {any} fixture
 * @param {any[]} [variants]
 * @returns {Promise<any>}
 */
export async function evaluateRetrieval(
  core,
  semantic,
  fixture,
  variants = [
    { name: 'baseline', graph: false },
    {
      name: 'expanded-plain',
      graph: { depth: 1 },
      expansion: { hubPenalty: false, fanout: false },
    },
    { name: 'expanded-guarded', graph: { depth: 1 } },
  ],
) {
  const results = [];
  for (const variant of variants) {
    const research = createResearch(core, { semantic, expansion: variant.expansion });
    const rows = [];
    for (const question of fixture.questions) {
      const started = performance.now();
      const response = await research.search(question.query, {
        knowledge: true,
        audience: 'agent',
        limit: 12,
        graph: variant.graph,
      });
      const matches = (count) =>
        new Set(
          response.hits
            .slice(0, count)
            .map((hit) => hit.sourceId ?? (hit.type === 'source' ? hit.id : null))
            .filter((id) => question.correctIds.includes(id)),
        );
      rows.push({
        id: question.id,
        group: question.group,
        query: question.query,
        expected: question.correct,
        hit3: matches(3).size > 0,
        coverage12: matches(12).size / question.correctIds.length,
        durationMs: performance.now() - started,
        mode: response.mode,
        fallbackReason: response.fallbackReason,
        graph: response.graph,
        hits: response.hits.map((hit) => ({
          ...hit,
          sourceKey:
            Object.entries(fixture.sources).find(([, id]) => id === hit.sourceId)?.[0] ?? null,
        })),
      });
    }
    const summary = Object.fromEntries(
      ['general', 'method'].map((group) => {
        const selected = rows.filter((row) => row.group === group);
        return [
          group,
          {
            count: selected.length,
            hit3: selected.filter((row) => row.hit3).length / selected.length,
            coverage12: selected.reduce((sum, row) => sum + row.coverage12, 0) / selected.length,
          },
        ];
      }),
    );
    results.push({ variant: variant.name, summary, rows });
  }
  return { limit: 12, questions: fixture.questions.length, results };
}

/**
 * CLI requires an existing verified local model directory. All generated data
 * stays below the repository's ignored temp directory; no model is downloaded.
 * @param {string} output
 * @param {string} modelDir
 * @param {any[]} [variants]
 * @returns {Promise<any>}
 */
export async function runRetrievalEvaluation(output, modelDir, variants) {
  const folder = path.resolve(output);
  const temp = path.resolve('.sciencescope-local/temp');
  if (!folder.startsWith(temp + path.sep))
    throw new Error('Evaluation output must be under .sciencescope-local/temp');
  await mkdir(folder, { recursive: true });
  const core = await createCore({ dataRoot: path.join(folder, 'data') });
  const embed = createEmbedding({ modelDir });
  const semantic = createSemantic(core, { embed });
  try {
    const research = createResearch(core);
    const fixture = await buildRetrievalFixture(core, research);
    await semantic.start();
    await semantic.configure('enable');
    await semantic.idle();
    if (semantic.status().state !== 'ready') throw new Error(JSON.stringify(semantic.status()));
    const result = await evaluateRetrieval(core, semantic, fixture, variants);
    result.model = semantic.status();
    await writeFile(path.join(folder, 'retrieval-eval.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await semantic.close();
    core.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [, , output, modelDir] = process.argv;
  if (!output || !modelDir)
    throw new Error(
      'Usage: node app/services/knowledge/retrieval-eval.js <temp output> <installed model>',
    );
  const result = await runRetrievalEvaluation(output, modelDir);
  console.log(
    JSON.stringify(
      result.results.map(({ variant, summary }) => ({ variant, summary })),
      null,
      2,
    ),
  );
}
