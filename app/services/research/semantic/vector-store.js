import { createHash } from 'node:crypto';
import * as sqliteVec from 'sqlite-vec';
import { AppError } from '../../../core/errors.js';
import { createSourceNeighbors } from './source-neighbors.js';

const candidateKey = (ref, version) =>
  createHash('sha256').update(`${ref.type}\0${ref.id}\0${version}`).digest('hex');
const refKey = (ref) => `${ref.type}:${ref.id}`;

/** @param {import('../../../core/db/database.js').Db} db */
function loadVectorExtension(db) {
  db.raw.enableLoadExtension(true);
  try {
    sqliteVec.load(db.raw);
  } finally {
    db.raw.enableLoadExtension(false);
  }
}

/**
 * Deletion also works after reopening a database with semantic search disabled.
 * @param {import('../../../core/db/database.js').Db} db
 * @param {Array<{type:string,id:string}>} refs
 * @returns {number}
 */
export function deleteVectorReferences(db, refs) {
  const find = db.prepare('SELECT rowid FROM rb_vec_docs WHERE ref_type=? AND ref_id=?');
  find.setReadBigInts(true);
  const rows = refs.flatMap((ref) => find.all(ref.type, ref.id));
  if (!rows.length) return 0;
  loadVectorExtension(db);
  return db.transaction(() => {
    const removeVector = db.prepare('DELETE FROM rb_vec WHERE rowid=?');
    const removeDocument = db.prepare('DELETE FROM rb_vec_docs WHERE rowid=?');
    for (const row of rows) {
      removeVector.run(row.rowid);
      removeDocument.run(row.rowid);
    }
    return rows.length;
  });
}

function vectorBlob(vector, dimensions) {
  const values = Float32Array.from(vector);
  const norm = values.reduce((sum, value) => sum + value * value, 0);
  if (values.length !== dimensions || !Number.isFinite(norm) || Math.abs(norm - 1) > 0.02) {
    throw new AppError('EMBEDDING_INVALID_VECTOR', 'Embedding output must be a normalized vector.');
  }
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

/** Rebuildable sqlite-vec projection on the application connection. Schema is migration-owned.
 * @param {{db: import('../../../core/db/database.js').Db, embedding:any, modelId:string, modelVersion:string, dimensions?:number, onRebuild?:()=>void}} options
 */
export async function createVectorStore({
  db,
  embedding,
  modelId,
  modelVersion,
  dimensions = 384,
  onRebuild = () => {},
}) {
  loadVectorExtension(db);
  let closed = false;
  const current = db.prepare(
    'SELECT rowid FROM rb_vec_docs WHERE model_id=? AND model_version=? AND candidate_key=?',
  );
  const previous = db.prepare('SELECT rowid FROM rb_vec_docs WHERE ref_type=? AND ref_id=?');
  const otherModel = db.prepare(
    'SELECT 1 FROM rb_vec_docs WHERE candidate_key=? AND (model_id<>? OR model_version<>?)',
  );
  const nextRow = db.prepare('SELECT ifnull(max(rowid),0)+1 AS next FROM rb_vec_docs');
  const deleteDocument = db.prepare('DELETE FROM rb_vec_docs WHERE rowid=?');
  const deleteVector = db.prepare('DELETE FROM rb_vec WHERE rowid=?');
  const insertDocument = db.prepare(
    'INSERT INTO rb_vec_docs(rowid,model_id,model_version,ref_type,ref_id,doc_version,candidate_key) VALUES(?,?,?,?,?,?,?)',
  );
  const insertVector = db.prepare(
    'INSERT INTO rb_vec(rowid,embedding,model_id,model_version,candidate_key) VALUES(?,?,?,?,?)',
  );
  const vectorDocument = db.prepare(
    'SELECT ref_type,ref_id FROM rb_vec_docs WHERE rowid=? AND model_id=? AND model_version=?',
  );
  for (const statement of [current, previous, nextRow]) statement.setReadBigInts(true);

  function ensureOpen() {
    if (closed) throw new AppError('VECTOR_STORE_CLOSED', 'Vector projection is closed.', 409);
  }

  function remove(rowid) {
    // vec0 rowids require signed integer bindings; Number bindings become doubles.
    deleteVector.run(BigInt(rowid));
    deleteDocument.run(BigInt(rowid));
  }

  /** @param {Array<{ref:{type:string,id:string},version:string,text:string}>} documents */
  async function upsertDocuments(documents) {
    ensureOpen();
    const pending = [];
    const seen = new Set();
    for (const document of documents) {
      const key = candidateKey(document.ref, document.version);
      if (seen.has(key) || current.get(modelId, modelVersion, key)) continue;
      seen.add(key);
      pending.push({ ...document, key });
    }
    if (!pending.length) return { indexed: 0, skipped: documents.length };
    const vectors = await embedding.embedPassages(pending.map((document) => document.text));
    ensureOpen();
    if (vectors.length !== pending.length)
      throw new AppError('EMBEDDING_INVALID_BATCH', 'Embedding output is incomplete.');
    const blobs = vectors.map((vector) => vectorBlob(vector, dimensions));
    db.transaction(() => {
      for (const [index, document] of pending.entries()) {
        for (const row of previous.all(document.ref.type, document.ref.id)) remove(row.rowid);
        const rowid = nextRow.get().next;
        insertDocument.run(
          rowid,
          modelId,
          modelVersion,
          document.ref.type,
          document.ref.id,
          document.version,
          document.key,
        );
        insertVector.run(rowid, blobs[index], modelId, modelVersion, document.key);
      }
    });
    return { indexed: pending.length, skipped: documents.length - pending.length };
  }

  /** @param {{queries:string[],candidates:any[],limit?:number,signal?:AbortSignal,cosineScores?:boolean}} input */
  async function search({ queries, candidates, limit = 30, signal, cosineScores = false }) {
    ensureOpen();
    const allowed = candidates.map((document) => ({
      ...document,
      key: candidateKey(document.ref, document.version),
    }));
    if (!allowed.length) return { rankings: queries.map(() => []) };
    const embeddingStatus = embedding.status?.();
    if (embeddingStatus?.ready === false) return { fallbackReason: 'index-incomplete' };
    const actualModel = embedding.modelId?.() ?? embeddingStatus?.modelId;
    const actualVersion = embedding.modelVersion?.() ?? embeddingStatus?.modelVersion;
    if (
      (actualModel && actualModel !== modelId) ||
      (actualVersion && actualVersion !== modelVersion)
    ) {
      onRebuild();
      return { fallbackReason: 'model-version-mismatch' };
    }
    const missing = allowed.filter((document) => !current.get(modelId, modelVersion, document.key));
    if (missing.some((document) => otherModel.get(document.key, modelId, modelVersion))) {
      onRebuild();
      return { fallbackReason: 'model-version-mismatch' };
    }
    if (missing.length) return { fallbackReason: 'index-incomplete' };
    const rankings = [];
    for (const query of queries) {
      if (signal?.aborted) return { fallbackReason: 'timeout' };
      const values = await embedding.embedQuery(query);
      if (signal?.aborted) return { fallbackReason: 'timeout' };
      ensureOpen();
      const blob = vectorBlob(values, dimensions);
      const byReference = new Map();
      // Batch filters stay below SQLite's bind-variable boundary. Retrieve each
      // batch in full before sorting so ties and page boundaries remain stable.
      for (let offset = 0; offset < allowed.length; offset += 500) {
        if (signal?.aborted) return { fallbackReason: 'timeout' };
        const keys = allowed.slice(offset, offset + 500).map((document) => document.key);
        // Retrieval keeps its existing L2 ranking. Entity alignment compares a
        // cosine threshold, so request the actual cosine distance for that path.
        const cosineColumn = cosineScores
          ? ',vec_distance_cosine(embedding,?) AS cosine_distance'
          : '';
        const statement = db.prepare(
          `SELECT rowid,distance${cosineColumn} FROM rb_vec WHERE embedding MATCH ? AND k=? AND model_id=? AND model_version=? AND candidate_key IN (${keys.map(() => '?').join(',')}) ORDER BY distance`,
        );
        statement.setReadBigInts(true);
        const bindings = [blob, keys.length, modelId, modelVersion, ...keys];
        if (cosineScores) bindings.unshift(blob);
        for (const row of statement.all(...bindings)) {
          const document = vectorDocument.get(row.rowid, modelId, modelVersion);
          if (!document) continue;
          const ref = { type: String(document.ref_type), id: String(document.ref_id) };
          const score = cosineScores
            ? Math.max(-1, Math.min(1, 1 - Number(row.cosine_distance)))
            : 1 - Number(row.distance);
          const prior = byReference.get(refKey(ref));
          if (!prior || score > prior.score) byReference.set(refKey(ref), { ref, score });
        }
      }
      rankings.push(
        [...byReference.values()]
          .sort(
            (left, right) =>
              right.score - left.score || (refKey(left.ref) < refKey(right.ref) ? -1 : 1),
          )
          .slice(0, limit),
      );
    }
    return { rankings };
  }

  /** @param {Array<{type:string,id:string}>} refs */
  async function removeMissing(refs) {
    ensureOpen();
    const wanted = new Set(refs.map(refKey));
    const statement = db.prepare('SELECT rowid,ref_type,ref_id FROM rb_vec_docs');
    statement.setReadBigInts(true);
    const stale = statement
      .all()
      .filter((row) => !wanted.has(refKey({ type: row.ref_type, id: row.ref_id })));
    db.transaction(() => {
      for (const row of stale) remove(row.rowid);
    });
    return { removed: stale.length };
  }

  function status() {
    return {
      mode: 'sqlite-vec',
      modelId,
      modelVersion,
      dimensions,
      count: Number(
        db
          .prepare('SELECT count(*) AS count FROM rb_vec_docs WHERE model_id=? AND model_version=?')
          .get(modelId, modelVersion).count,
      ),
    };
  }

  async function close() {
    closed = true;
  }
  const sourceNeighbors = createSourceNeighbors(db, modelId, modelVersion);
  return { upsertDocuments, search, sourceNeighbors, removeMissing, status, close };
}
