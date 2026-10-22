// The desk journal is the transaction boundary for text and its annotations.
// DOCX metadata is projected from the package + journal; only other annotations
// use the two catalog tables. Neither path maintains a second undo stack.
import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { AppError } from '../../core/errors.js';
import { newId, nowIso } from '../../core/ids.js';
import { createAnnotationStore } from './annotation-store.js';
import { recoverDocx } from './annotation-recovery.js';
import { readDocument } from './formats.js';
import { annotationText, quoteAt, mapRange, relocate, splitInlines } from './annotation-anchors.js';
import {
  addCommentMarkers,
  commentAtoms,
  commentIdentity,
  commentRanges,
  originalComments,
} from './annotation-docx.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @returns {any}
 */
export function createAnnotations(core) {
  const table = createAnnotationStore(core);
  const nameOf = (id) => core.participants.list().find((person) => person.id === id)?.name ?? id;
  const all = (state) => [...table.rows(state.session.groupId), ...state.comments.values()];
  const get = (state, id) => state.comments.get(id) ?? table.get(id);
  function history(groupId) {
    const entries = core.db
      .prepare(
        `SELECT c.annotations_json FROM desk_changes c
      JOIN desk_sessions s ON s.id=c.session_id WHERE s.group_id=? ORDER BY c.created_at,c.rowid`,
      )
      .all(groupId);
    const items = new Map();
    for (const row of entries)
      for (const entry of JSON.parse(String(row.annotations_json))) {
        if (entry.after) items.set(entry.after.id, entry.after);
        else items.set(entry.before.id, entry.before);
      }
    return items;
  }
  function hydrate(state, records) {
    state.document.groupId = state.session.groupId;
    state.comments =
      state.document.format === 'docx'
        ? originalComments(state, history(state.session.groupId))
        : new Map();
    for (const record of records)
      for (const change of record.annotations ?? []) {
        const item = change.after ?? change.before;
        if (!item.id.startsWith('docx:')) continue;
        commentAtoms(state.document, item.id);
        if (change.after) state.comments.set(item.id, change.after);
        else state.comments.delete(item.id);
      }
  }
  function present(item) {
    const { authorId, authorName } = item;
    const value = { ...item };
    for (const key of ['authorId', 'authorName', 'groupId', 'versionId', 'paraId'])
      delete value[key];
    return {
      ...value,
      status: item.status ?? 'anchored',
      author: { id: authorId, name: authorName ?? nameOf(authorId) },
    };
  }
  function list(state, versionId = null) {
    const positions = new Map(state.blocks.map((block, index) => [block.id, index]));
    const items = all(state)
      .filter((item) => !versionId || item.versionId === versionId)
      .sort(
        (left, right) =>
          (positions.get(left.blockId) ?? Infinity) - (positions.get(right.blockId) ?? Infinity) ||
          left.from - right.from ||
          left.createdAt?.localeCompare(right.createdAt ?? '') ||
          left.id.localeCompare(right.id),
      );
    return { items: items.map(present) };
  }
  function requireItem(state, id, actor, ownOnly) {
    const item = get(state, id);
    if (!item || item.groupId !== state.session.groupId)
      throw new AppError('DESK_ANNOTATION_NOT_FOUND', '找不到这条批注或索引。', 404);
    if (ownOnly && item.authorId !== actor.actorId)
      throw new AppError('DESK_NOT_AUTHOR', '只能删除自己添加的批注或索引。');
    return item;
  }
  function selection(state, input) {
    const block = state.blocks.find((entry) => entry.id === input.blockId);
    if (!block) throw new AppError('DOCX_BLOCK_NOT_FOUND', '这段正文已不存在。');
    const text = annotationText(block);
    if (input.from === input.to) throw new AppError('DESK_EMPTY_RANGE', '请先划选要标注的文字。');
    if (
      !Number.isInteger(input.from) ||
      !Number.isInteger(input.to) ||
      input.from < 0 ||
      input.to <= input.from ||
      input.to > text.length
    )
      throw new AppError('DESK_RANGE', '请在当前段落内重新划选文字。');
    if (block.inlines) splitInlines(block.inlines, [input.from, input.to]);
    return { block, quote: quoteAt(text, input.from, input.to) };
  }
  function create(state, input, actor) {
    const { block, quote } = selection(state, input);
    if (!['comment', 'index'].includes(input.type))
      throw new AppError('DESK_ANNOTATION_TYPE', '请选择批注或索引。');
    if (
      input.type === 'index' &&
      (!Array.isArray(input.sources) ||
        !input.sources.length ||
        input.sources.some((source) => source?.schema !== 1))
    )
      throw new AppError('DESK_SOURCE_REQUIRED', '索引至少需要一个 schema 1 来源引用。');
    const isDocx = state.document.format === 'docx' && input.type === 'comment';
    if (isDocx && (input.parentId || input.resolved))
      throw new AppError('UNKNOWN_OP', 'Word 批注的回复和解决暂未开放。');
    const timestamp = nowIso();
    const largest = Math.max(
      -1,
      ...(state.document.comments?.map((entry) => Number(entry.id)) ?? []),
      ...[...history(state.session.groupId).keys()]
        .filter((id) => id.startsWith('docx:'))
        .map((id) => Number(id.split(':').at(-1))),
      ...[...state.comments.keys()].map((id) => Number(id.split(':').at(-1))),
    );
    /** @type {any} */
    const item = {
      id: isDocx
        ? `docx:${state.session.groupId}:${largest + 1}`
        : newId(input.type === 'index' ? 'binding' : 'comment'),
      type: input.type,
      groupId: state.session.groupId,
      versionId: state.session.baseVersionId,
      blockId: block.id,
      from: input.from,
      to: input.to,
      quote,
      status: 'anchored',
      authorId: actor.actorId ?? 'person_user',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(input.type === 'comment'
        ? { text: String(input.text ?? ''), parentId: input.parentId ?? null, resolved: false }
        : {
            kind: input.kind ?? 'text',
            value: input.value ?? '',
            sources: input.sources,
            derivation: input.derivation ?? null,
            note: input.note ?? '',
          }),
    };
    if (isDocx) {
      item.authorName = nameOf(item.authorId);
      item.paraId = state.allocateId();
    }
    if (item.parentId) requireItem(state, item.parentId, actor, false);
    let blocks = state.blocks;
    let before = null,
      after = null;
    if (isDocx) {
      before = block.inlines;
      after = addCommentMarkers(state.document, block, item);
      blocks = blocks.map((entry) =>
        entry.id === block.id ? { ...entry, inlines: after } : entry,
      );
    }
    return {
      blocks,
      inserted: {},
      item,
      records: [
        {
          blockId: block.id,
          op: isDocx ? 'comment' : 'annotation',
          before,
          after,
          annotations: [{ before: null, after: item }],
        },
      ],
    };
  }
  function update(state, id, input, actor, remove = false, ownOnly = false) {
    const item = requireItem(state, id, actor, ownOnly);
    const docx = id.startsWith('docx:');
    if (docx && ('resolved' in input || 'parentId' in input))
      throw new AppError('UNKNOWN_OP', 'Word 批注的回复和解决暂未开放。');
    const after = remove ? null : { ...item, updatedAt: nowIso() };
    if (after)
      for (const key of item.type === 'comment'
        ? ['text', 'resolved']
        : ['kind', 'value', 'sources', 'derivation', 'note'])
        if (key in input) after[key] = input[key];
    const locating =
      after && item.status === 'lost' && ['blockId', 'from', 'to'].some((key) => key in input);
    if (locating) {
      const { block, quote } = selection(state, input);
      Object.assign(after, {
        blockId: block.id,
        from: input.from,
        to: input.to,
        quote,
        versionId: state.session.baseVersionId,
        status: 'anchored',
      });
      if (docx) after.endBlockId = block.id;
    }
    if (
      after?.type === 'index' &&
      (!Array.isArray(after.sources) ||
        !after.sources.length ||
        after.sources.some((entry) => entry?.schema !== 1))
    )
      throw new AppError('DESK_SOURCE_REQUIRED', '索引至少需要一个 schema 1 来源引用。');
    const block = state.blocks.find(
      (entry) => entry.id === (locating ? after.blockId : item.blockId),
    );
    const writesDocument = docx && (locating || item.status !== 'lost');
    const inlines =
      docx && locating
        ? addCommentMarkers(state.document, block, after)
        : writesDocument && remove
          ? block.inlines.filter((inline) => commentIdentity(state.document, inline) !== id)
          : block?.inlines;
    const blocks =
      writesDocument && (remove || locating)
        ? state.blocks.map((entry) => (entry.id === block.id ? { ...entry, inlines } : entry))
        : state.blocks;
    const annotations = [{ before: item, after }];
    if (remove)
      for (const child of all(state))
        if (child.parentId === id) annotations.push({ before: child, after: null });
    return {
      blocks,
      inserted: {},
      item: after,
      records: [
        {
          blockId: locating ? after.blockId : item.blockId,
          op: writesDocument ? 'comment' : 'annotation',
          before: writesDocument ? block.inlines : null,
          after: writesDocument ? inlines : null,
          annotations,
        },
      ],
    };
  }
  function prepare(state, proposal, undo) {
    const explicit = new Set(
      proposal.records.flatMap((record) =>
        (record.annotations ?? []).map((delta) => (delta.after ?? delta.before).id),
      ),
    );
    if (undo) {
      for (const change of undo.annotations ?? []) {
        const item = change.after ?? change.before;
        const current = get(state, item.id) ?? null;
        const content = (value) =>
          value && { ...value, status: value.status ?? 'anchored', versionId: null };
        if (!isDeepStrictEqual(content(current), content(change.after)))
          throw new AppError(
            'DESK_UNDO_BLOCKED',
            '这条批注或索引后来已被修改，请先撤回后面的修改。',
            409,
          );
        explicit.add(item.id);
        (proposal.records[0].annotations ??= []).push({
          before: current,
          after: change.before
            ? {
                ...change.before,
                versionId:
                  undo.op === 'annotation-lost'
                    ? change.before.versionId
                    : state.session.baseVersionId,
                status:
                  undo.op === 'annotation-lost' ? 'lost' : (change.before.status ?? 'anchored'),
              }
            : null,
        });
      }
    }
    const ranges =
      state.document.format === 'docx' ? commentRanges(state.document, proposal.blocks) : new Map();
    for (const item of all(state)) {
      if (explicit.has(item.id) || item.status === 'lost') continue;
      const record = proposal.records.find((entry) => entry.blockId === item.blockId);
      if (!record) continue;
      const oldBlock = state.blocks.find((block) => block.id === item.blockId);
      const block = proposal.blocks.find((entry) => entry.id === item.blockId);
      const docx = item.id.startsWith('docx:');
      const range = docx
        ? ranges.get(item.id)
        : block && mapRange(annotationText(oldBlock), annotationText(block), item);
      const survives =
        !docx ||
        range?.endBlockId !== item.blockId ||
        (block && oldBlock && mapRange(annotationText(oldBlock), annotationText(block), item));
      const after =
        range && survives && (docx ? range.exact.length : range.to > range.from)
          ? {
              ...item,
              ...range,
              versionId: state.session.baseVersionId,
              quote: quoteAt(annotationText(block), range.from, range.to),
              updatedAt: nowIso(),
            }
          : null;
      if (after) {
        delete after.exact;
        if (!docx) delete after.endBlockId;
      }
      if (
        after &&
        item.from === after.from &&
        item.to === after.to &&
        isDeepStrictEqual(item.quote, after.quote)
      )
        continue;
      (record.annotations ??= []).push({ before: item, after });
      if (docx && !after && block) {
        block.inlines = block.inlines.filter(
          (part) => commentIdentity(state.document, part) !== item.id,
        );
        record.after = block.inlines;
      }
    }
    return proposal;
  }
  function applyDatabase(records) {
    for (const record of records) for (const delta of record.annotations ?? []) table.apply(delta);
  }
  function accept(state, records) {
    for (const record of records)
      for (const delta of record.annotations ?? []) {
        const item = delta.after ?? delta.before;
        if (!item.id.startsWith('docx:')) continue;
        if (delta.after) state.comments.set(item.id, delta.after);
        else state.comments.delete(item.id);
      }
  }
  async function reanchor(state) {
    const records = [];
    for (const item of table.rows(state.session.groupId)) {
      const found = relocate(state.blocks, item, state.document.format !== 'docx');
      // A user-restored lost record stays available until it can be located;
      // ordinary edits must not reuse its old offsets against unrelated text.
      if (!found && item.status === 'lost') continue;
      const block = found && state.blocks.find((entry) => entry.id === found.blockId);
      const after = found
        ? {
            ...item,
            ...found,
            quote: quoteAt(annotationText(block), found.from, found.to),
            versionId: state.session.baseVersionId,
            status: 'anchored',
            updatedAt: nowIso(),
          }
        : null;
      if (
        after &&
        item.blockId === after.blockId &&
        item.from === after.from &&
        item.to === after.to &&
        item.versionId === after.versionId &&
        item.status === after.status
      )
        continue;
      records.push({
        blockId: item.blockId,
        op: found ? 'annotation' : 'annotation-lost',
        before: null,
        after: null,
        annotations: [{ before: item, after }],
      });
    }
    const proposal = { blocks: state.blocks, inserted: {}, records };
    if (state.document.format === 'docx')
      await recoverDocx(core, state, proposal, hydrate, history);
    return proposal;
  }
  function inverse(state, record) {
    if (record.undoneBy) throw new AppError('DESK_UNDO_BLOCKED', '这条修改已撤回。', 409);
    return {
      blocks: state.blocks,
      inserted: {},
      records: [{ blockId: record.blockId, op: record.op, before: null, after: null }],
    };
  }
  async function forVersion(versionId) {
    const version = core.versionCatalog.get(versionId);
    const group = core.versionCatalog.group(version.groupId);
    const document = await readDocument(
      await readFile(core.versionCatalog.file(versionId)),
      group.format,
    );
    const state = {
      document,
      blocks: document.blocks,
      session: { groupId: group.id, baseVersionId: versionId },
    };
    hydrate(state, []);
    return list(state, versionId);
  }
  return {
    hydrate,
    list,
    create,
    update,
    prepare,
    applyDatabase,
    accept,
    reanchor,
    inverse,
    forVersion,
    get,
    table,
  };
}
