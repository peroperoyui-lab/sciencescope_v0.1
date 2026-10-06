import * as sqliteVec from 'sqlite-vec';

export const version = 4;
export const name = 'research-vectors';

/** @param {import('../database.js').Db} db */
export function up(db) {
  db.raw.enableLoadExtension(true);
  try {
    sqliteVec.load(db.raw);
  } finally {
    db.raw.enableLoadExtension(false);
  }
  db.exec(`
    CREATE TABLE rb_vec_docs (
      rowid INTEGER PRIMARY KEY,
      model_id TEXT NOT NULL,
      model_version TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      doc_version TEXT NOT NULL,
      candidate_key TEXT NOT NULL,
      UNIQUE(model_id, model_version, ref_type, ref_id, doc_version)
    );
    CREATE INDEX rb_vec_docs_ref ON rb_vec_docs(ref_type, ref_id);
    CREATE INDEX rb_vec_docs_candidate ON rb_vec_docs(candidate_key, model_id, model_version);
    CREATE VIRTUAL TABLE rb_vec USING vec0(
      embedding FLOAT[384],
      model_id TEXT PARTITION KEY,
      model_version TEXT PARTITION KEY,
      candidate_key TEXT
    );
  `);
}
