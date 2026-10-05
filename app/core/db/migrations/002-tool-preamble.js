// Text a model writes right before a tool call ("I'll read the draft first")
// belongs to the tool card, not to the answer.

export const version = 2;
export const name = 'tool-preamble';

/** @param {{ exec: (sql: string) => void }} db */
export function up(db) {
  db.exec(`
    ALTER TABLE tool_calls ADD COLUMN preamble TEXT NOT NULL DEFAULT '';
    ALTER TABLE tool_calls ADD COLUMN call_id TEXT;
    CREATE INDEX tool_calls_by_turn ON tool_calls(turn_id, seq);
    CREATE INDEX turns_by_meeting ON turns(meeting_id, started_at);
  `);
}
