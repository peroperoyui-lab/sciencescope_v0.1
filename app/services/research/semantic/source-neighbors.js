import { createHash } from 'node:crypto';

/**
 * Source-only nearest neighbours reuse stored normalized vectors. No inference
 * or chunk vectors enter this projection; yielding lets a turn pause the work.
 * @param {import('../../../core/db/database.js').Db} db
 * @param {string} modelId
 * @param {string} modelVersion
 * @returns {(ids:string[],options?:any)=>Promise<any>}
 */
export function createSourceNeighbors(db, modelId, modelVersion) {
  let cached = null;
  return async (ids, { pause = () => false, limit = 3, threshold = -1, sourceIds = ids } = {}) => {
    const allowed = new Set(ids);
    const statement = db.prepare(
      "SELECT rowid,ref_id,candidate_key FROM rb_vec_docs WHERE ref_type='source' AND model_id=? AND model_version=? ORDER BY ref_id",
    );
    statement.setReadBigInts(true);
    const documents = statement
      .all(modelId, modelVersion)
      .filter((row) => allowed.has(String(row.ref_id)));
    const signature = createHash('sha256')
      .update(
        JSON.stringify([documents.map((row) => row.candidate_key), sourceIds, limit, threshold]),
      )
      .digest('hex');
    if (cached?.signature === signature) return cached;
    const rankings = [];
    for (const source of documents.filter((row) => sourceIds.includes(String(row.ref_id)))) {
      if (pause()) return { paused: true };
      const stored = db.prepare('SELECT embedding FROM rb_vec WHERE rowid=?').get(source.rowid);
      // Source deletion can run while a previous source yielded to the host.
      if (!stored) continue;
      const blob = stored.embedding;
      const neighbours = [];
      for (let offset = 0; offset < documents.length; offset += 500) {
        const batch = documents.slice(offset, offset + 500);
        const byRow = new Map(batch.map((row) => [String(row.rowid), String(row.ref_id)]));
        const nearest = db.prepare(
          `SELECT rowid,distance,vec_distance_cosine(embedding,?) AS cosine_distance
           FROM rb_vec WHERE embedding MATCH ? AND k=? AND model_id=? AND model_version=?
           AND candidate_key IN (${batch.map(() => '?').join(',')}) ORDER BY distance`,
        );
        nearest.setReadBigInts(true);
        for (const row of nearest.all(
          blob,
          blob,
          Math.min(limit + 1, batch.length),
          modelId,
          modelVersion,
          ...batch.map((item) => item.candidate_key),
        )) {
          const id = byRow.get(String(row.rowid));
          const score = Math.max(-1, Math.min(1, 1 - Number(row.cosine_distance)));
          if (id !== source.ref_id && score >= threshold) neighbours.push({ id, score });
        }
      }
      neighbours.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      rankings.push({ id: String(source.ref_id), neighbours: neighbours.slice(0, limit) });
      await new Promise((resolve) => setImmediate(resolve));
    }
    cached = { signature, rankings };
    return cached;
  };
}
