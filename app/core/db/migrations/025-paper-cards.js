export const version = 25;
export const name = 'paper-cards';

/**
 * Card checkpoints and provenance survive restarts; extracted text remains a projection.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`
    ALTER TABLE kb_entities ADD COLUMN produced_from TEXT;
    ALTER TABLE kb_entities ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
    CREATE INDEX kb_entities_produced ON kb_entities(produced_from, layer, status);
    ALTER TABLE kb_jobs ADD COLUMN result_json TEXT;
    ALTER TABLE kb_jobs ADD COLUMN meeting_id TEXT;
    ALTER TABLE kb_jobs ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
  `);
}
