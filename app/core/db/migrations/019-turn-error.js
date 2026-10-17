export const version = 19;
export const name = 'turn-error';

/**
 * Why a failed turn ended, kept apart from the answer so a partial answer and
 * its reason can both be shown.
 * @param {import('../database.js').Db} db
 */
export function up(db) {
  db.exec('ALTER TABLE turns ADD COLUMN error TEXT;');
}
