// A queued filename is already a public identity. Preserve it once edits or
// durable references exist, including changes later undone and resumed queues.
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const referenceColumns = [
  ['kb_revisions', 'before_json'],
  ['kb_revisions', 'after_json'],
  ['rb_items', 'payload_json'],
  ['rb_items', 'origin_json'],
  ['research_input_drafts', 'input_json'],
  ['message_research_input', 'input_json'],
  ['meeting_outbox', 'input_json'],
  ['meeting_outbox', 'refs_json'],
  ['messages', 'refs_json'],
  ['manuscript_bindings', 'sources_json'],
  ['manuscript_bindings', 'derivation_json'],
  ['desk_changes', 'annotations_json'],
];

/**
 * Check only a hash-matched provisional source, immediately before reconciliation.
 * Missing baselines on restart use the scanner's stable new-file defaults.
 * @param {import('../../core/index.js').Core} core
 * @param {import('../research/store.js').ResearchSource} source
 * @param {import('../research/store.js').ResearchSource} [baseline]
 * @returns {boolean}
 */
export function hasSourceEdits(core, source, baseline) {
  const expected = baseline ?? {
    title: path.posix.basename(source.folderPath ?? source.name ?? ''),
    name: path.posix.basename(source.folderPath ?? source.name ?? ''),
    kind: 'file',
    metadata: {},
  };
  if (
    ['title', 'name', 'kind', 'metadata'].some(
      (field) => !isDeepStrictEqual(source[field], expected[field]),
    ) ||
    source.originalPath ||
    source.contentHash ||
    source.parser ||
    source.pages != null
  )
    return true;
  const { db } = core;
  const id = source.id;
  const ref = `source:${id}`;
  const has = (sql, ...values) => Boolean(db.prepare(sql).get(...values));
  // Scanner checkpoints have no actor or the explicit system actor. User and
  // agent edits remain visible here even when their field values were restored.
  if (
    has(
      `SELECT 1 FROM events WHERE type='research.changed'
      AND actor_id IS NOT NULL AND actor_id<>'system'
      AND json_extract(payload_json,'$.sourceId')=?
      AND json_extract(payload_json,'$.action')='source.updated' LIMIT 1`,
      id,
    ) ||
    has('SELECT 1 FROM rb_chunks WHERE source_id=? LIMIT 1', id) ||
    has('SELECT 1 FROM kb_labels WHERE ref=? LIMIT 1', ref) ||
    has('SELECT 1 FROM kb_memberships WHERE ref=? LIMIT 1', ref) ||
    has('SELECT 1 FROM kb_positions WHERE ref=? LIMIT 1', ref) ||
    has(
      'SELECT 1 FROM kb_edges WHERE from_ref=? OR to_ref=? OR produced_from=? LIMIT 1',
      ref,
      ref,
      ref,
    ) ||
    has('SELECT 1 FROM kb_entities WHERE produced_from=? LIMIT 1', ref)
  )
    return true;
  // Exact JSON atoms retain marks, manuscript bindings and their reversible
  // history without treating a filename substring as a source reference.
  for (const [table, column] of referenceColumns)
    if (
      has(
        `SELECT 1 FROM ${table}, json_tree(coalesce(${column},'null')) AS node
        WHERE node.atom IN (?,?) LIMIT 1`,
        id,
        ref,
      )
    )
      return true;
  return has(
    `SELECT 1 FROM events, json_tree(payload_json) AS node
    WHERE events.type='research.input.changed' AND node.atom IN (?,?) LIMIT 1`,
    id,
    ref,
  );
}
