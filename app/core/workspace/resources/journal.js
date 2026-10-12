// The catalog is a replaceable projection of the Markdown, refreshed on read
// and every revision (including undo and snapshot restore).
import { log } from './documents.js';
import { parseLog } from '../../../shared/journal.js';

/**
 * @param {import('../../db/database.js').Db} db
 * @returns {import('../workspace.js').Resource}
 */
export function journalResource(db) {
  return {
    ...log,
    projectText(key, text) {
      db.transaction(() => {
        db.prepare('DELETE FROM log_file_references WHERE project_id = ?').run(key);
        const insert = db.prepare('INSERT INTO log_file_references VALUES (?, ?, ?, ?)');
        for (const entry of parseLog(text))
          entry.references.forEach((reference, index) =>
            insert.run(key, entry.start, index, JSON.stringify(reference)),
          );
      });
    },
  };
}
