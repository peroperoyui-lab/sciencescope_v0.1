import { readFile } from 'node:fs/promises';
import { nowIso } from '../../core/ids.js';
import { readDocument } from './formats.js';
import { annotationText, quoteAt, relocate } from './annotation-anchors.js';
import { addCommentMarkers } from './annotation-docx.js';

/**
 * Reconstruct the preceding session from its immutable source and journal.
 * Lost Word comments remain journal data until a real text range is chosen.
 * @param {import('../../core/index.js').Core} core
 * @param {any} state
 * @param {any} proposal
 * @param {(state:any,records:any[])=>void} hydrate
 * @param {(groupId:string)=>Map<string,any>} history
 */
export async function recoverDocx(core, state, proposal, hydrate, history) {
  const previous = core.db
    .prepare(
      'SELECT id,base_version_id FROM desk_sessions WHERE group_id=? AND id<>? ORDER BY created_at DESC,rowid DESC LIMIT 1',
    )
    .get(state.session.groupId, state.session.id);
  if (!previous) return;
  const document = await readDocument(
    await readFile(core.versionCatalog.file(String(previous.base_version_id))),
    'docx',
  );
  const prior = {
    document,
    session: { groupId: state.session.groupId, baseVersionId: String(previous.base_version_id) },
  };
  const records = core.db
    .prepare('SELECT annotations_json FROM desk_changes WHERE session_id=? ORDER BY seq,rowid')
    .all(previous.id);
  hydrate(
    prior,
    records.map((row) => ({ annotations: JSON.parse(String(row.annotations_json)) })),
  );
  const current = [...state.comments.values()];
  const reserved = new Set([
    ...state.comments.keys(),
    ...prior.comments.keys(),
    ...history(state.session.groupId).keys(),
  ]);
  let number = Math.max(
    -1,
    ...[...reserved]
      .filter((id) => id.startsWith('docx:'))
      .map((id) => Number(id.split(':').at(-1))),
  );
  for (const original of prior.comments.values()) {
    // Word can renumber comments. Match the paragraph identity before w:id.
    if (
      current.some((item) =>
        original.paraId && item.paraId
          ? original.paraId === item.paraId
          : item.id === original.id && item.authorName === original.authorName,
      )
    )
      continue;
    const item = state.comments.has(original.id)
      ? { ...original, id: `docx:${state.session.groupId}:${++number}` }
      : original;
    // The external document owns its native comments. Only a record the user
    // restored as lost may recreate a missing comment without another action.
    const found = item.status === 'lost' ? relocate(proposal.blocks, item, true) : null;
    if (!found) {
      proposal.records.push({
        blockId: item.blockId,
        op: item.status === 'lost' ? 'annotation' : 'annotation-lost',
        before: null,
        after: null,
        annotations:
          item.status === 'lost'
            ? [{ before: null, after: item }]
            : [{ before: item, after: null }],
      });
      continue;
    }
    const block = proposal.blocks.find((entry) => entry.id === found.blockId);
    const after = {
      ...item,
      ...found,
      endBlockId: found.blockId,
      quote: quoteAt(annotationText(block), found.from, found.to),
      status: 'anchored',
      versionId: state.session.baseVersionId,
      updatedAt: nowIso(),
    };
    const inlines = addCommentMarkers(state.document, block, after);
    proposal.records.push({
      blockId: block.id,
      op: 'comment',
      before: block.inlines,
      after: inlines,
      annotations: [{ before: item.status === 'lost' ? item : null, after }],
    });
    proposal.blocks = proposal.blocks.map((entry) =>
      entry.id === block.id ? { ...entry, inlines } : entry,
    );
  }
}
