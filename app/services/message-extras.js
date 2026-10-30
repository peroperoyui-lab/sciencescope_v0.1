import { AppError } from '../core/errors.js';
import { toTurn, toToolCall } from '../core/turns.js';
import { extractCitationLabels } from './research/citations.js';
import { projectCitations } from './preview/citations.js';
import { publicRow } from './knowledge/records.js';
import {
  describeKnowledgeRef,
  knowledgeNodeTables,
  projectRevisionDetails,
} from './knowledge/revision-details.js';

function groupRows(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row[key])) groups.set(row[key], []);
    groups.get(row[key]).push(row);
  }
  return groups;
}

function loadCitations(db, messages, projectId) {
  const materials = new Map();
  const numbers = new Set();
  const selectedIds = new Set();
  const locators = [];
  const errors = new Map();
  for (const message of messages) {
    try {
      const selected = JSON.parse(message.input_json ?? '{}').materials ?? [];
      materials.set(message.id, selected);
      for (const label of extractCitationLabels(message.text)) {
        for (const citation of label.citations.filter((entry) => entry.kind === 'source')) {
          const chosen = selected.find((entry) => entry.label === citation.label);
          if (chosen) selectedIds.add(chosen.id);
          else numbers.add(citation.number);
          locators.push({ citation, chosen });
        }
      }
    } catch (error) {
      errors.set(message.id, error);
    }
  }
  const sources = db
    .prepare(
      `SELECT id,project_id,number FROM rb_sources
       WHERE id IN (SELECT value FROM json_each(?))
       OR ((project_id IS ? OR project_id IS NULL)
         AND number IN (SELECT value FROM json_each(?)))`,
    )
    .all(JSON.stringify([...selectedIds]), projectId, JSON.stringify([...numbers]))
    .map((row) => ({ id: String(row.id), projectId: row.project_id, number: Number(row.number) }));
  const byId = new Map(sources.map((source) => [source.id, source]));
  const byScope = new Map(
    sources.map((source) => [JSON.stringify([source.projectId, source.number]), source]),
  );
  const resolve = (citation, chosen) =>
    chosen
      ? byId.get(chosen.id)
      : (byScope.get(JSON.stringify([projectId, citation.number])) ??
        byScope.get(JSON.stringify([null, citation.number])));
  const wanted = new Set();
  for (const { citation, chosen } of locators) {
    const source = resolve(citation, chosen);
    if (source) wanted.add(JSON.stringify([source.id, citation.fromPage]));
  }
  // Fetch only the first matching passage, even for a long book with many chunks.
  const highlights = new Map(
    db
      .prepare(
        `WITH wanted AS (
           SELECT json_extract(value,'$[0]') AS source_id,
             json_extract(value,'$[1]') AS page FROM json_each(?)
         )
         SELECT w.source_id,w.page,c.text FROM wanted w
         LEFT JOIN rb_chunks c ON c.source_id=w.source_id AND c.ordinal=(
           SELECT min(ordinal) FROM rb_chunks
           WHERE source_id=w.source_id AND (w.page IS NULL OR page=w.page)
         )`,
      )
      .all('[' + [...wanted].join(',') + ']')
      .map((row) => [JSON.stringify([row.source_id, row.page]), row.text ?? '']),
  );
  return (message) => {
    if (errors.has(message.id)) throw errors.get(message.id);
    return projectCitations(
      message.text,
      materials.get(message.id),
      (citation, chosen) => {
        const source = resolve(citation, chosen);
        if (chosen && !source)
          throw new AppError('SOURCE_NOT_FOUND', 'Research source not found.', 404);
        return source;
      },
      (source, citation) => highlights.get(JSON.stringify([source.id, citation.fromPage])) ?? '',
    );
  };
}

function loadKnowledge(db, turnIds) {
  // UNION terminates a malformed cycle; the per-item projection reports it below.
  const versions = db
    .prepare(
      `WITH RECURSIVE chain(id,restored_by) AS (
         SELECT id,restored_by FROM kb_versions
         WHERE turn_id IN (SELECT value FROM json_each(?)) AND closed_at IS NOT NULL
         UNION
         SELECT v.id,v.restored_by FROM kb_versions v JOIN chain c ON v.id=c.restored_by
       ) SELECT v.* FROM kb_versions v JOIN chain c ON v.id=c.id`,
    )
    .all(JSON.stringify(turnIds));
  const byId = new Map(versions.map((version) => [version.id, version]));
  const roots = new Map(
    versions
      .filter((version) => turnIds.includes(version.turn_id))
      .map((version) => [version.turn_id, version]),
  );
  const revisions = db
    .prepare(
      `SELECT rowid,* FROM kb_revisions
       WHERE version_id IN (SELECT value FROM json_each(?)) ORDER BY rowid`,
    )
    .all(JSON.stringify([...roots.values()].map((version) => version.id)));
  const changes = groupRows(revisions, 'version_id');
  const errors = new Map();
  const refs = new Set();
  for (const row of revisions) {
    let snapshot;
    try {
      snapshot = JSON.parse(row.after_json ?? 'null') ?? JSON.parse(row.before_json ?? 'null');
    } catch (error) {
      errors.set(row.version_id, error);
      continue;
    }
    if (!snapshot) refs.add(row.ref);
    if (row.ref.startsWith('edge:') && snapshot) {
      for (const ref of [snapshot.from_ref ?? snapshot.fromRef, snapshot.to_ref ?? snapshot.toRef])
        if (typeof ref === 'string') refs.add(ref);
    }
  }
  const nodes = new Map();
  for (const [type, table] of Object.entries(knowledgeNodeTables)) {
    const ids = [...refs]
      .filter((ref) => ref.startsWith(type + ':'))
      .map((ref) => ref.split(':')[1]);
    if (!ids.length) continue;
    for (const row of db
      .prepare(`SELECT * FROM ${table} WHERE id IN (SELECT value FROM json_each(?))`)
      .all(JSON.stringify(ids)))
      nodes.set(type + ':' + row.id, row);
  }
  const describe = (ref, snapshot) => describeKnowledgeRef(ref, snapshot ?? nodes.get(ref));
  return (turnId) => {
    const version = roots.get(turnId);
    if (!version) return null;
    if (errors.has(version.id)) throw errors.get(version.id);
    let last = version;
    let links = 0;
    const visited = new Set([last.id]);
    while (last.restored_by) {
      const next = byId.get(last.restored_by);
      if (!next)
        throw new AppError('KNOWLEDGE_VERSION_NOT_FOUND', 'Knowledge version does not exist.', 404);
      if (visited.has(next.id))
        throw new AppError(
          'KNOWLEDGE_VERSION_CHAIN',
          'Knowledge restore history contains a cycle.',
        );
      last = next;
      visited.add(last.id);
      links++;
    }
    return {
      version: publicRow(version),
      changes: (changes.get(version.id) ?? []).map((row) =>
        projectRevisionDetails(publicRow(row), describe),
      ),
      lastId: last.id,
      withdrawn: links % 2 === 1,
    };
  };
}

/**
 * Page-level read projection; all database reads are batched independently of message count.
 * @param {import('../core/index.js').Core} core
 * @returns {{get:(meetingId:string,ids:string[])=>{items:Record<string,any>}}}
 */
export function createMessageExtras(core) {
  const { db } = core;
  /**
   * @param {string} meetingId
   * @param {string[]} ids
   * @returns {{items:Record<string,any>}}
   */
  function get(meetingId, ids) {
    if (ids.length > 50)
      throw new AppError('MESSAGE_EXTRAS_LIMIT', '一次最多读取 50 条消息的辅助信息。');
    const meeting = core.meetings.get(meetingId);
    const requested = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!requested.length) return { items: {} };
    const messages = db
      .prepare(
        `SELECT m.*,r.id AS reply_id,i.input_json FROM messages m
         LEFT JOIN messages r ON r.id=m.reply_to
         LEFT JOIN message_research_input i ON i.message_id=r.id
         WHERE m.meeting_id=? AND m.id IN (SELECT value FROM json_each(?))`,
      )
      .all(meetingId, JSON.stringify(requested));
    const byId = new Map(messages.map((message) => [String(message.id), message]));
    const turnIds = [...new Set(messages.map((message) => message.turn_id).filter(Boolean))];
    const turnJson = JSON.stringify(turnIds);
    const turns = new Map(
      db
        .prepare('SELECT * FROM turns WHERE id IN (SELECT value FROM json_each(?))')
        .all(turnJson)
        .map((row) => [row.id, row]),
    );
    const calls = groupRows(
      db
        .prepare(
          'SELECT * FROM tool_calls WHERE turn_id IN (SELECT value FROM json_each(?)) ORDER BY seq',
        )
        .all(turnJson),
      'turn_id',
    );
    const citations = loadCitations(db, messages, meeting.projectId);
    const knowledge = loadKnowledge(db, turnIds);
    return {
      items: Object.fromEntries(
        requested.map((id) => {
          const message = byId.get(id);
          if (!message) return [id, { error: '找不到这条消息，或消息不属于这个会议。' }];
          try {
            if (message.reply_to && !message.reply_id)
              throw new AppError('MESSAGE_NOT_FOUND', '找不到这条消息。', 404);
            const turn = turns.get(message.turn_id);
            if (message.turn_id && !turn)
              throw new AppError('TURN_NOT_FOUND', '找不到这次发言。', 404);
            return [
              id,
              {
                turn: turn
                  ? { turn: toTurn(turn), toolCalls: (calls.get(turn.id) ?? []).map(toToolCall) }
                  : null,
                citations: citations(message),
                knowledge: knowledge(message.turn_id),
              },
            ];
          } catch (error) {
            return [id, { error: error.message }];
          }
        }),
      ),
    };
  }
  return { get };
}
