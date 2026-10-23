// Source bytes and catalog rows have one deletion path. Curated relationships
// keep reversible history; derived/extracted projections are discarded.
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { createKnowledgeStore } from './store.js';
import { deleteVectorReferences } from '../research/semantic/vector-store.js';
import { recyclePath } from '../system.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {import('../research/store.js').ResearchStore} store
 * @param {{recycle?:typeof recyclePath}} [options]
 * @returns {(id:string,actor?:any)=>Promise<any>}
 */
export function createSourceRemoval(core, store, { recycle = recyclePath } = {}) {
  const knowledge = createKnowledgeStore(core);
  return async (id, actor = {}) => {
    const source = store.getSource(id);
    // Project snapshots belong to explicit orphan cleanup, never to the recycle bin.
    const projectSnapshot = source.originalPath?.replaceAll('\\', '/').startsWith('project-files/');
    if (!source.folderPath && source.originalPath && !projectSnapshot) {
      const original = path.join(core.paths.library, source.originalPath);
      const exists = await stat(original).then(
        () => true,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return false;
        },
      );
      if (exists) await recycle(original);
    }
    return core.db.transaction(() => {
      const nodes = [
        { type: 'source', id },
        ...store.chunks(id).map((chunk) => ({ type: 'chunk', id: chunk.id })),
      ];
      const refs = nodes.map((node) => `${node.type}:${node.id}`);
      const affected = new Set(refs);
      const group = knowledge.versions.begin({ ...actor, projectId: source.projectId });
      const selected = new Set(refs);
      const edges = new Map();
      const endpoints = core.db.prepare('SELECT * FROM kb_edges WHERE from_ref=? OR to_ref=?');
      for (const ref of refs) for (const edge of endpoints.all(ref, ref)) edges.set(edge.id, edge);
      for (const edge of core.db
        .prepare("SELECT * FROM kb_edges WHERE layer='extracted' AND produced_from=?")
        .all(`source:${id}`))
        edges.set(edge.id, edge);
      for (const edge of edges.values()) {
        const endpoint = selected.has(String(edge.from_ref)) || selected.has(String(edge.to_ref));
        const produced = edge.layer === 'extracted' && edge.produced_from === `source:${id}`;
        if ((endpoint && edge.layer === 'derived') || produced) {
          core.db.prepare('DELETE FROM kb_edges WHERE id=?').run(edge.id);
          affected.add(`edge:${edge.id}`);
        } else if (endpoint && edge.layer === 'curated' && edge.status === 'active') {
          knowledge.removeEdge(String(edge.id), { ...actor, versionId: group.id });
          affected.add(`edge:${edge.id}`);
        }
      }
      const vectors = deleteVectorReferences(core.db, nodes);
      for (const ref of refs) {
        core.db.prepare('DELETE FROM kb_labels WHERE ref=?').run(ref);
        core.db.prepare('DELETE FROM kb_memberships WHERE ref=?').run(ref);
      }
      store.deleteSource(id, actor);
      const version = group.automatic ? knowledge.versions.close(group.id) : group;
      knowledge.versions.changed([...affected], { ...actor, projectId: source.projectId });
      return { deleted: id, vectors, versionId: version?.id ?? null };
    });
  };
}
