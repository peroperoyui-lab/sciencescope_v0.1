import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createCore } from '../../core/index.js';
import { collectExpansionGraph } from './expansion-graph.js';
import { rankExpansion } from './expansion-rank.js';
import { createExpansionIndex } from './expansion-index.js';

/**
 * A reproducible synthetic graph with five high-degree hubs and many cycles.
 * @param {any} db
 * @param {number} [count]
 * @param {number} [edgeCount]
 * @returns {void}
 */
export function populateRetrievalScale(db, count = 50000, edgeCount = 500000) {
  const entity =
    db.prepare(`INSERT INTO kb_entities(id,kind,name,layer,origin,created_by,created_at,updated_at)
    VALUES(?,'method',?,'curated','user','synthetic','now','now')`);
  const edge =
    db.prepare(`INSERT INTO kb_edges(id,from_ref,to_ref,relation,layer,origin,created_by,created_at,updated_at)
    VALUES(?,?,?,'uses',?,'user','synthetic','now','now')`);
  db.transaction(() => {
    for (let index = 0; index < count; index++)
      entity.run('scale_' + index, `Synthetic method ${index}`);
    for (let index = 0; index < edgeCount; index++) {
      const hub = index < 25000;
      const from = hub ? Math.floor(index / 5000) : (index - 25000) % count;
      const to = hub
        ? 5 + (index % 5000)
        : (from + 17 + Math.floor((index - 25000) / count) * 7919) % count;
      edge.run(
        'scale_edge_' + index,
        'entity:scale_' + from,
        'entity:scale_' + to,
        index % 3 === 0 ? 'curated' : index % 3 === 1 ? 'extracted' : 'derived',
      );
    }
  });
}

/**
 * @param {any} db
 * @param {any} [collector]
 * @returns {any[]}
 */
export function measureRetrievalScale(db, collector = collectExpansionGraph) {
  return [1, 2].map((depth) => {
    const started = performance.now();
    const graph = collector(db, {
      query: 'Synthetic method 42',
      seeds: [
        { ref: 'entity:scale_0', rank: 0 },
        { ref: 'entity:scale_12345', rank: 1 },
      ],
      depth,
      options: { knowledge: true, audience: 'agent' },
    });
    const collected = performance.now();
    const ranked = rankExpansion(graph);
    return {
      depth,
      nodes: graph.nodes.size,
      edges: graph.edges.length,
      visited: graph.visited.length,
      truncated: graph.truncated,
      iterations: ranked.iterations,
      collectMs: collected - started,
      pprMs: performance.now() - collected,
      totalMs: performance.now() - started,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const output = path.resolve(process.argv[2] ?? '.sciencescope-local/temp/kb-7/scale');
  if (!output.startsWith(path.resolve('.sciencescope-local/temp') + path.sep))
    throw new Error('Use the ignored temp directory');
  await mkdir(output, { recursive: true });
  const core = await createCore({ dataRoot: output });
  try {
    if (!core.db.prepare('SELECT 1 FROM kb_entities LIMIT 1').get())
      populateRetrievalScale(core.db);
    const sql = measureRetrievalScale(core.db);
    const started = performance.now();
    const index = createExpansionIndex(core);
    const startupMs = performance.now() - started;
    const results = {
      sql,
      startupMs,
      memory: measureRetrievalScale(core.db, (db, input) =>
        collectExpansionGraph(db, { ...input, index }),
      ),
    };
    await writeFile(path.join(output, 'benchmark.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    core.close();
  }
}
