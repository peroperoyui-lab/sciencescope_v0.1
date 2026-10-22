// Manuscripts use desk sessions and their change journal, not workspace text
// revisions. All participants share this adapter and the existing approval rules.
import { AppError } from '../../core/errors.js';
import { createDeskStore } from './storage.js';
import { createProjectFiles } from '../project-files.js';
import { readDiffBlocks } from './diff-blocks.js';
import {
  manuscriptText,
  findText,
  replaceInlines,
  editText,
  plainInsertion,
} from './manuscript-text.js';
import { toolRange } from './annotation-tools.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('./index.js').createDesk>} desk
 * @param {ReturnType<typeof import('../approvals.js').createApprovals>} approvals
 * @returns {any}
 */
export function createManuscriptTools(core, desk, approvals) {
  const catalog = core.versionCatalog;
  const store = createDeskStore(core);
  const files = createProjectFiles(core);
  const latest = (group) =>
    catalog.list(group.projectId).find((entry) => entry.id === group.id).versions[0];
  const visible = (block) =>
    block
      ? { id: block.id, kind: block.kind, level: block.level ?? null, text: manuscriptText(block) }
      : null;
  async function groupOf(key) {
    const separator = String(key).indexOf('/');
    const projectId = String(key).slice(0, separator);
    const item = String(key).slice(separator + 1);
    const group = item.startsWith('path:')
      ? await desk.registerDocument({ projectId, path: item.slice(5) })
      : catalog.group(item);
    if (separator < 0 || group.projectId !== projectId)
      throw new AppError('INVALID_MANUSCRIPT_KEY', '请使用文稿列表返回的项目和版本组 key。');
    return group;
  }
  async function list(projectId) {
    const result = await desk.listDocuments(projectId);
    const summary = (entry, group) => ({
      key: `${projectId}/${group?.id ?? 'path:' + entry.path}`,
      name: entry.name,
      format: entry.format,
      versionNumber: group?.latest?.number ?? null,
      sessionId: group ? (store.open(group.id)?.id ?? null) : null,
    });
    return {
      documents: [
        ...result.files.map((entry) => summary(entry, entry.group)),
        ...result.groups.map((entry) => summary(entry, entry)),
      ],
      truncated: result.truncated,
    };
  }
  async function read(args, context) {
    if (!args.key) return list(args.scope ?? core.meetings.get(context.meetingId).projectId);
    const group = await groupOf(args.key);
    const open = args.version ? null : store.open(group.id);
    let blocks,
      versionId,
      seq = 0;
    if (open) {
      const current = await desk.getSession(open.id);
      blocks = current.blocks;
      versionId = current.session.baseVersionId;
      seq = current.session.seq;
    } else {
      const version = args.version ? catalog.get(args.version) : latest(group);
      if (version.groupId !== group.id)
        throw new AppError('INVALID_VERSION', '请选择这个版本组里的版本。');
      const parsed = await readDiffBlocks({ file: catalog.file(version.id), name: version.name });
      if (!parsed) throw new AppError('DESK_FORMAT', '这份文稿暂时不能按块读取。');
      blocks = parsed.items.map((item) => item.block);
      versionId = version.id;
    }
    const offset = Math.max(0, Math.trunc(args.offset ?? 0));
    const limit = Math.max(1, Math.min(200, Math.trunc(args.limit ?? 40)));
    const page = blocks.slice(offset, offset + limit);
    const annotations = (
      open ? await desk.listAnnotations(open.id) : await desk.versionAnnotations(versionId)
    ).items;
    return {
      groupId: group.id,
      versionId,
      sessionId: open?.id ?? null,
      seq,
      blocks: page.map((block) => ({
        ...visible(block),
        annotations: annotations
          .filter((item) => item.blockId === block.id)
          .map((item) => ({
            id: item.id,
            type: item.type,
            quote: item.quote,
            summary:
              item.type === 'comment'
                ? item.text.slice(0, 60)
                : [item.value, item.note].filter(Boolean).join(' · '),
          })),
      })),
      remaining: Math.max(0, blocks.length - offset - page.length),
    };
  }
  function actorOf(context) {
    const turn = core.turns.get(context.turnId);
    return {
      actorId: context.participantId,
      meetingId: context.meetingId,
      turnId: context.turnId,
      instruction: turn.triggerMessageId
        ? core.messages.get(turn.triggerMessageId).text.slice(0, 200)
        : '',
    };
  }
  async function resultOf(id, before, result, blockId) {
    const current = await desk.getSession(id);
    return {
      revisionIds:
        result.seq === before
          ? []
          : current.changes
              .filter((record) => record.seq === result.seq)
              .map((record) => record.id),
      seq: result.seq,
      removedAnnotations: result.removedAnnotations ?? 0,
      block: visible(current.blocks.find((block) => block.id === blockId)),
    };
  }
  async function edit(args, context) {
    if (
      ![
        'replace',
        'insertBlock',
        'removeBlock',
        'save',
        'comment',
        'bind',
        'unbind',
        'uncomment',
      ].includes(args.op)
    )
      throw new AppError('UNKNOWN_OP', '这项文稿操作尚未提供。');
    const group = await groupOf(args.key);
    const actor = actorOf(context);
    const existing = store.open(group.id);
    const current = existing
      ? await desk.getSession(existing.id)
      : await desk.openSession({ groupId: group.id, meetingId: context.meetingId });
    const input = args.args ?? {};
    const id = current.session.id;
    if (['unbind', 'uncomment'].includes(args.op)) {
      const item = (await desk.listAnnotations(id)).items.find((entry) => entry.id === input.id);
      if (!item)
        throw new AppError('DESK_ANNOTATION_NOT_FOUND', '这份文稿中找不到这条批注或索引。', 404);
      const result = await desk.updateAnnotation(input.id, {}, actor, {
        remove: true,
        ownOnly: true,
      });
      return resultOf(id, current.session.seq, result, null);
    }
    if (args.op === 'save') {
      if (input.to === 'project') {
        if (!group.sourcePath)
          throw new AppError('DESK_SOURCE_REQUIRED', '这个版本组还没有关联项目文件。');
        const version = catalog.get(current.session.baseVersionId);
        const decision = await approvals.request('workspace_edit', args, {
          ...context,
          manuscript: {
            path: files.locate(group.projectId, group.sourcePath),
            version: version.number,
          },
        });
        if (decision) return decision;
      }
      // Confirmation of an external/newer project copy belongs to the user.
      const saved = await desk.save(
        id,
        { to: input.to, label: input.label, tier: input.tier },
        actor,
      );
      return {
        revisionIds: [],
        seq: saved.session.seq,
        block: null,
        version: saved.version ?? null,
      };
    }
    const blockId = input.block ?? input.after;
    const block = current.blocks.find((entry) => entry.id === blockId);
    if (!block && !(args.op === 'insertBlock' && input.after === '^'))
      throw new AppError('DOCX_BLOCK_NOT_FOUND', '这段正文已不存在，请重新读取文稿。');
    if (['comment', 'bind'].includes(args.op)) {
      const found = findText(
        block,
        typeof input.quote === 'string' ? input.quote : input.quote?.exact,
      );
      const range = toolRange(block, found.from, found.to);
      const result = await desk.createAnnotation(
        id,
        {
          ...input,
          type: args.op === 'comment' ? 'comment' : 'index',
          blockId: block.id,
          ...range,
        },
        actor,
      );
      return {
        ...(await resultOf(id, current.session.seq, result, block.id)),
        annotation: result.item,
      };
    }
    let result,
      editedId = input.block;
    if (group.format === 'docx') {
      const change = { baseSeq: current.session.seq };
      if (args.op === 'replace')
        change.blocks = { [input.block]: replaceInlines(block, input.find, input.with) };
      else if (args.op === 'removeBlock') change.removed = [input.block];
      else {
        plainInsertion(input.text);
        change.inserted = [{ id: 'inserted', after: input.after, inlines: [{ text: input.text }] }];
      }
      result = await desk.updateBlocks(id, change, actor);
      editedId ??= result.inserted.inserted;
    } else {
      result = await desk.updateText(
        id,
        { baseSeq: current.session.seq, text: editText(current, group.format, args.op, input) },
        actor,
      );
      if (args.op === 'insertBlock')
        editedId = store
          .changes(id)
          .find((record) => record.seq === result.seq && record.op === 'insert-block')?.blockId;
    }
    return resultOf(id, current.session.seq, result, editedId);
  }
  async function undo(id, context) {
    const record = store.change(id);
    const before = store.get(record.sessionId).seq;
    const result = await desk.undoChange(id, actorOf(context));
    return resultOf(record.sessionId, before, result, record.blockId);
  }
  function suggest(args, context) {
    const previous = core.db
      .prepare(
        "SELECT created_at FROM events WHERE type='desk.suggested' AND meeting_id=? ORDER BY seq DESC LIMIT 1",
      )
      .get(context.meetingId);
    if (!previous || Date.now() - Date.parse(String(previous.created_at)) >= 10 * 60 * 1000) {
      core.db.transaction(() =>
        core.events.record(
          'desk.suggested',
          { meetingId: context.meetingId, reason: args.reason, key: args.document ?? null },
          {
            meetingId: context.meetingId,
            projectId: core.meetings.get(context.meetingId).projectId,
            actorId: context.participantId,
          },
        ),
      );
    }
    return { suggested: true };
  }
  return {
    handles: (name, args) =>
      name === 'desk_suggest' ||
      (name === 'workspace_read' && args?.target === 'manuscript') ||
      (name === 'workspace_edit' && args?.resource === 'manuscript') ||
      (name === 'workspace_undo' && args?.revisionId?.startsWith('chg_')),
    async run(name, args, context) {
      try {
        if (name === 'workspace_read') return await read(args, context);
        if (name === 'workspace_edit') return await edit(args, context);
        if (name === 'workspace_undo') return await undo(args.revisionId, context);
        return suggest(args, context);
      } catch (error) {
        // Preserve actionable codes and the current block for the model; the
        // generic runtime would otherwise reduce thrown errors to a string.
        if (!(error instanceof AppError)) throw error;
        return { code: error.code, error: error.message, .../** @type {any} */ (error).details };
      }
    },
  };
}
