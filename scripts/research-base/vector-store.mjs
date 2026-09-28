import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';

const REF_TYPES = new Set(['source', 'chunk', 'item', 'message']);
const FILTER_BATCH = 500;
const hashRef = (ref, version) => createHash('sha256')
  .update(`${ref.type}\0${ref.id}\0${version}`)
  .digest('hex');
const invalid = (message, code = 'INVALID_VECTOR_INPUT') => Object.assign(new Error(message), { code });

function validateRef(ref) {
  if (!ref || !REF_TYPES.has(ref.type) || typeof ref.id !== 'string' || !ref.id || ref.id.length > 4096) {
    throw invalid('Vector document reference is invalid.');
  }
}

function validateVersion(version) {
  if ((typeof version !== 'string' && typeof version !== 'number') || String(version).length > 4096) {
    throw invalid('Vector document version is invalid.');
  }
  return String(version);
}

function asVectorBlob(vector, dimensions) {
  if (!(ArrayBuffer.isView(vector) || Array.isArray(vector)) || vector.length !== dimensions) {
    throw invalid('Embedding vector has the wrong dimensions.', 'EMBEDDING_INVALID_VECTOR');
  }
  const values = Float32Array.from(vector);
  let norm = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw invalid('Embedding vector contains a non-finite value.', 'EMBEDDING_INVALID_VECTOR');
    norm += value * value;
  }
  if (norm < 0.98 || norm > 1.02) throw invalid('Embedding vector must be L2 normalized.', 'EMBEDDING_INVALID_VECTOR');
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

/** SQLite vec0 projection. The canonical source/item records remain in Research Base. */
export async function createVectorStore({ dbPath, embedding, modelId, modelVersion, dimensions = 384, onRebuild = () => {} } = {}) {
  if (typeof dbPath !== 'string' || !dbPath) throw new TypeError('dbPath is required');
  if (!embedding || typeof embedding.embedPassages !== 'function' || typeof embedding.embedQuery !== 'function') {
    throw new TypeError('embedding must expose embedPassages() and embedQuery()');
  }
  if (typeof modelId !== 'string' || !modelId || typeof modelVersion !== 'string' || !modelVersion) {
    throw new TypeError('modelId and modelVersion are required');
  }
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 4096) throw new TypeError('dimensions is invalid');

  // Node requires the connection capability to be enabled at construction;
  // extension loading is then enabled only for sqlite-vec's load call.
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  let closed = false;
  let statements;
  try {
    db.enableLoadExtension(true);
    sqliteVec.load(db);
    db.enableLoadExtension(false);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS rb_vec_docs (
        rowid INTEGER PRIMARY KEY,
        model_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        ref_type TEXT NOT NULL,
        ref_id TEXT NOT NULL,
        doc_version TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(model_id, model_version, ref_type, ref_id, doc_version)
      );
      CREATE INDEX IF NOT EXISTS rb_vec_docs_ref ON rb_vec_docs(ref_type,ref_id);
      CREATE INDEX IF NOT EXISTS rb_vec_docs_candidate ON rb_vec_docs(candidate_key,model_id,model_version);
      CREATE VIRTUAL TABLE IF NOT EXISTS rb_vec USING vec0(
        embedding FLOAT[${dimensions}],
        model_id TEXT PARTITION KEY,
        model_version TEXT PARTITION KEY,
        candidate_key TEXT
      );`);
    statements = {
      docsByCurrentVersion: db.prepare(`SELECT rowid FROM rb_vec_docs
        WHERE model_id=? AND model_version=? AND ref_type=? AND ref_id=? AND doc_version=?`),
      docsByRef: db.prepare('SELECT rowid FROM rb_vec_docs WHERE ref_type=? AND ref_id=?'),
      deleteDoc: db.prepare('DELETE FROM rb_vec_docs WHERE rowid=?'),
      deleteVector: db.prepare('DELETE FROM rb_vec WHERE rowid=?'),
      insertDoc: db.prepare(`INSERT INTO rb_vec_docs
        (rowid,model_id,model_version,ref_type,ref_id,doc_version,candidate_key)
        VALUES(?,?,?,?,?,?,?)`),
      insertVector: db.prepare(`INSERT INTO rb_vec
        (rowid,embedding,model_id,model_version,candidate_key) VALUES(?,?,?,?,?)`),
      nextRow: db.prepare('SELECT ifnull(max(rowid),0)+1 AS next FROM rb_vec_docs'),
      docForVector: db.prepare('SELECT ref_type,ref_id FROM rb_vec_docs WHERE rowid=? AND model_id=? AND model_version=?'),
    };
    statements.docsByCurrentVersion.setReadBigInts(true);
    statements.docsByRef.setReadBigInts(true);
    statements.nextRow.setReadBigInts(true);
  } catch (error) {
    try { db.enableLoadExtension(false); } catch { /* loader may not have been enabled */ }
    try { db.close(); } catch { /* preserve the initialization error */ }
    throw error;
  }
  const { docsByCurrentVersion, docsByRef, deleteDoc, deleteVector, insertDoc, insertVector, nextRow, docForVector } = statements;
  const removeRow = (rowid) => { deleteVector.run(BigInt(rowid)); deleteDoc.run(BigInt(rowid)); };

  function ensureOpen() { if (closed) throw invalid('Vector store is closed.', 'VECTOR_STORE_CLOSED'); }

  async function upsertDocuments(documents) {
    ensureOpen();
    if (!Array.isArray(documents)) throw invalid('Vector documents must be an array.');
    const pending = [];
    let skipped = 0;
    const seen = new Set();
    for (const doc of documents) {
      validateRef(doc?.ref);
      const version = validateVersion(doc.version);
      if (typeof doc.text !== 'string') throw invalid('Vector document text must be a string.');
      const identity = `${doc.ref.type}\0${doc.ref.id}\0${version}`;
      if (seen.has(identity) || docsByCurrentVersion.get(modelId, modelVersion, doc.ref.type, doc.ref.id, version)) {
        skipped += 1;
        continue;
      }
      seen.add(identity);
      pending.push({ ref: doc.ref, version, text: doc.text, candidateKey: hashRef(doc.ref, version) });
    }
    if (!pending.length) return { indexed: 0, skipped };

    const vectors = await embedding.embedPassages(pending.map(({ text }) => text));
    if (closed) throw invalid('Vector store was closed during embedding.', 'VECTOR_STORE_CLOSED');
    if (!Array.isArray(vectors) || vectors.length !== pending.length) throw invalid('Embedding engine returned an incomplete batch.', 'EMBEDDING_INVALID_BATCH');

    db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < pending.length; index += 1) {
        const doc = pending[index];
        const priorRows = docsByRef.all(doc.ref.type, doc.ref.id);
        for (const row of priorRows) removeRow(row.rowid);
        // sqlite-vec rowids are SQLite signed 64-bit integers. Bind BigInt so
        // identity is not rounded by JavaScript's Number representation.
        const id = nextRow.get().next;
        const blob = asVectorBlob(vectors[index], dimensions);
        insertDoc.run(id, modelId, modelVersion, doc.ref.type, doc.ref.id, doc.version, doc.candidateKey);
        insertVector.run(id, blob, modelId, modelVersion, doc.candidateKey);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { indexed: pending.length, skipped };
  }

  function candidatesForSearch(candidates) {
    if (!Array.isArray(candidates)) throw invalid('Search candidates must be an array.');
    const normalized = [];
    const seen = new Set();
    for (const candidate of candidates) {
      validateRef(candidate?.ref);
      const version = validateVersion(candidate.version);
      const candidateKey = hashRef(candidate.ref, version);
      if (seen.has(candidateKey)) continue;
      seen.add(candidateKey);
      normalized.push({ ref: candidate.ref, version, candidateKey });
    }
    return normalized;
  }

  const hasCurrentDoc = db.prepare(`SELECT 1 AS found FROM rb_vec_docs
    WHERE model_id=? AND model_version=? AND candidate_key=? LIMIT 1`);
  const hasOtherModelDoc = db.prepare(`SELECT 1 AS found FROM rb_vec_docs
    WHERE candidate_key=? AND (model_id<>? OR model_version<>?) LIMIT 1`);

  async function search({ queries, candidates, limit = 30, signal } = {}) {
    ensureOpen();
    if (signal?.aborted) return { rankings: [], fallbackReason: 'timeout' };
    if (!Array.isArray(queries) || queries.length < 1 || queries.length > 6 || queries.some((q) => typeof q !== 'string')) {
      throw invalid('Search queries are invalid.');
    }
    const allowed = candidatesForSearch(candidates);
    const boundedLimit = Math.max(1, Math.min(30, Number(limit) || 30));
    if (!allowed.length) return { rankings: queries.map(() => []) };
    const embeddingStatus = typeof embedding.status === 'function' ? embedding.status() : null;
    if (embeddingStatus && embeddingStatus.ready === false) {
      const fallbackReason = ['model-missing', 'MODEL_MISSING'].includes(embeddingStatus.reason) ? 'model-missing' : 'index-incomplete';
      return { rankings: [], fallbackReason };
    }
    const actualModelId = typeof embedding.modelId === 'function' ? embedding.modelId() : embeddingStatus?.modelId;
    const actualModelVersion = typeof embedding.modelVersion === 'function' ? embedding.modelVersion() : embeddingStatus?.modelVersion;
    if ((actualModelId && actualModelId !== modelId) || (actualModelVersion && actualModelVersion !== modelVersion)) {
      onRebuild();
      return { rankings: [], fallbackReason: 'model-version-mismatch' };
    }
    let missing = false;
    let modelMismatch = false;
    for (const candidate of allowed) {
      if (!hasCurrentDoc.get(modelId, modelVersion, candidate.candidateKey)) {
        missing = true;
        if (hasOtherModelDoc.get(candidate.candidateKey, modelId, modelVersion)) modelMismatch = true;
      }
    }
    if (modelMismatch) {
      onRebuild();
      return { rankings: [], fallbackReason: 'model-version-mismatch' };
    }
    if (missing) return { rankings: [], fallbackReason: 'index-incomplete' };

    const rankingRows = [];
    for (const query of queries) {
      if (signal?.aborted) return { rankings: [], fallbackReason: 'timeout' };
      const vector = await embedding.embedQuery(query);
      if (signal?.aborted) return { rankings: [], fallbackReason: 'timeout' };
      ensureOpen();
      const blob = asVectorBlob(vector, dimensions);
      const rowsByRef = new Map();
      for (let offset = 0; offset < allowed.length; offset += FILTER_BATCH) {
        if (signal?.aborted) return { rankings: [], fallbackReason: 'timeout' };
        const keys = allowed.slice(offset, offset + FILTER_BATCH).map(({ candidateKey }) => candidateKey);
        const marks = keys.map(() => '?').join(',');
        const statement = db.prepare(`SELECT rowid,distance FROM rb_vec
          WHERE embedding MATCH ? AND k=? AND model_id=? AND model_version=?
            AND candidate_key IN (${marks}) ORDER BY distance`);
        statement.setReadBigInts(true);
        const rows = statement.all(blob, Math.min(boundedLimit, keys.length), modelId, modelVersion, ...keys);
        for (const row of rows) {
          const doc = docForVector.get(row.rowid, modelId, modelVersion);
          if (!doc) continue;
          const key = `${doc.ref_type}:${doc.ref_id}`;
          const distance = Number(row.distance);
          const old = rowsByRef.get(key);
          if (!old || distance < old.distance) rowsByRef.set(key, { ref: { type: doc.ref_type, id: doc.ref_id }, distance });
        }
      }
      if (signal?.aborted) return { rankings: [], fallbackReason: 'timeout' };
      rankingRows.push([...rowsByRef.values()].sort((a, b) => {
        if (a.distance !== b.distance) return a.distance - b.distance;
        const left = `${a.ref.type}:${a.ref.id}`;
        const right = `${b.ref.type}:${b.ref.id}`;
        return left < right ? -1 : left > right ? 1 : 0;
      })
        .slice(0, boundedLimit).map(({ ref, distance }) => ({ ref, score: 1 - distance })));
    }
    return { rankings: rankingRows };
  }

  async function removeMissing(refs) {
    ensureOpen();
    if (!Array.isArray(refs)) throw invalid('Current vector references must be an array.');
    const current = new Set();
    for (const ref of refs) { validateRef(ref); current.add(`${ref.type}\0${ref.id}`); }
    const allDocs = db.prepare('SELECT rowid,ref_type,ref_id FROM rb_vec_docs');
    allDocs.setReadBigInts(true);
    const rows = allDocs.all();
    db.exec('BEGIN IMMEDIATE');
    try {
      let removed = 0;
      for (const row of rows) {
        if (current.has(`${row.ref_type}\0${row.ref_id}`)) continue;
        removeRow(row.rowid);
        removed += 1;
      }
      db.exec('COMMIT');
      return { removed };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function status() {
    ensureOpen();
    const count = db.prepare('SELECT count(*) AS count FROM rb_vec_docs WHERE model_id=? AND model_version=?').get(modelId, modelVersion).count;
    return { mode: 'sqlite-vec', count, modelId, modelVersion, dimensions };
  }

  async function close() {
    if (closed) return;
    closed = true;
    db.close();
  }

  return { search, upsertDocuments, removeMissing, status, close };
}
