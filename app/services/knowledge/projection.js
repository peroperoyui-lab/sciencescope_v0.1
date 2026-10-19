import { indexText } from '../research/text-index.js';

/**
 * FTS is a rebuildable projection of catalog rows, never their identity or source of truth.
 * @param {import('../../core/db/database.js').Db} db
 * @param {string} id
 * @param {any} row
 * @returns {void}
 */
export function projectEntity(db, id, row) {
  db.prepare("DELETE FROM rb_fts WHERE doc_type='entity' AND doc_id=?").run(id);
  if (!row || row.status !== 'active') return;
  const text = [row.name_en, ...JSON.parse(String(row.aliases_json)), row.description]
    .filter(Boolean)
    .join('\n');
  db.prepare(
    "INSERT INTO rb_fts(doc_type,doc_id,project_id,title,body) VALUES('entity',?,'',?,?)",
  ).run(id, indexText(row.name), indexText(text));
}

/**
 * @param {import('../../core/db/database.js').Db} db
 * @returns {void}
 */
export function rebuildEntityIndex(db) {
  db.transaction(() => {
    db.prepare("DELETE FROM rb_fts WHERE doc_type='entity'").run();
    for (const row of db.prepare('SELECT * FROM kb_entities').all())
      projectEntity(db, String(row.id), row);
  });
}
