// Message and queue snapshots are immutable copies of the submitted draft.
// Original documents remain owned by the research library.

/**
 * @param {import('./db/database.js').Db} db
 */
export function createInputRecords(db) {
  return {
    read(messageId) {
      const row = db
        .prepare('SELECT input_json FROM message_research_input WHERE message_id=?')
        .get(messageId);
      return row ? JSON.parse(String(row.input_json)) : { materials: [], marks: [] };
    },
    save(messageId, input) {
      if (input)
        db.prepare('INSERT INTO message_research_input(message_id,input_json) VALUES(?,?)').run(
          messageId,
          JSON.stringify(input),
        );
    },
  };
}
