import { rebuildEntityIndex } from './projection.js';
import { createRecords } from './records.js';
import { createKnowledgeVersions } from './versions.js';
import { createKnowledgeMutations } from './mutations.js';
import { createKnowledgeQueries } from './queries.js';

/**
 * Durable graph facts and their own reversible editing history. No model, UI or HTTP dependency.
 * @param {import('../../core/index.js').Core} core
 * @returns {any}
 */
export function createKnowledgeStore(core) {
  const records = createRecords(core.db);
  const versions = createKnowledgeVersions(core);
  return {
    ...createKnowledgeMutations(core, records, versions),
    ...createKnowledgeQueries(core, records),
    rebuildIndex: () => rebuildEntityIndex(core.db),
    versions,
    closeTurn: versions.closeTurn,
  };
}
