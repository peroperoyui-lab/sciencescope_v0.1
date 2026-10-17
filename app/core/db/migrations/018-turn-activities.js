export const version = 18;
export const name = 'turn-activities';

/**
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec(`ALTER TABLE turns ADD COLUMN phase TEXT NOT NULL DEFAULT '';
    ALTER TABLE tool_calls ADD COLUMN kind TEXT NOT NULL DEFAULT 'tool';`);
}
