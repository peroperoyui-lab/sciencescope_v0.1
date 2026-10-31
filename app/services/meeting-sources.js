import { toToolCall } from '../core/turns.js';
import { usedSources } from '../shared/turn-sources.js';

/**
 * Historical receipts remain useful after a source is renamed or removed.
 * @param {import('../core/index.js').Core} core
 * @returns {{get:(meetingId:string)=>{items:any[]}}}
 */
export function createMeetingSources(core) {
  /**
   * @param {string} meetingId
   * @returns {{items:any[]}}
   */
  function get(meetingId) {
    core.meetings.get(meetingId);
    const rows = core.db
      .prepare(
        `SELECT m.id AS message_id,m.turn_id AS message_turn_id,m.author_id,
          m.created_at AS message_created_at,m.text,t.*
         FROM messages m LEFT JOIN tool_calls t ON t.turn_id=m.turn_id
          AND t.name IN ('research_read','research_search')
          AND t.status NOT IN ('failed','error')
         WHERE m.meeting_id=? AND m.turn_id IS NOT NULL AND m.status<>'streaming'
         ORDER BY m.created_at DESC,m.seq DESC,t.seq`,
      )
      .all(meetingId);
    const messages = new Map();
    for (const row of rows) {
      if (!messages.has(row.message_id)) messages.set(row.message_id, { row, calls: [] });
      if (row.id) messages.get(row.message_id).calls.push(toToolCall(row));
    }
    /** @type {Map<string, any>} */
    const sources = new Map();
    for (const { row, calls } of messages.values()) {
      for (const used of usedSources(calls, row.text)) {
        const source = sources.get(used.id) ?? {
          sourceId: used.id,
          title: null,
          label: null,
          folderPath: null,
          projectId: null,
          pages: new Set(),
          uses: [],
        };
        for (const key of ['title', 'label', 'folderPath', 'projectId'])
          if (source[key] == null && used[key] != null) source[key] = used[key];
        for (const page of used.pages) source.pages.add(Number(page));
        source.uses.push({
          messageId: row.message_id,
          turnId: row.message_turn_id,
          authorId: row.author_id,
          createdAt: row.message_created_at,
          label: used.label ?? null,
        });
        sources.set(used.id, source);
      }
    }
    return {
      items: [...sources.values()].map((source) => ({
        ...source,
        pages: [...source.pages].sort((a, b) => a - b),
      })),
    };
  }
  return { get };
}
