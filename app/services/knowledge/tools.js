import { AppError } from '../../core/errors.js';
import { createKnowledgeStore } from './store.js';
import { createKnowledgeGraph } from './graph.js';
import { createRecords } from './records.js';

/**
 * Tool adapters reuse catalog mutations and turn history rather than maintaining another store.
 * Each operation has its own transaction so a failed label/merge cannot leave half an operation.
 * @param {import('../../core/index.js').Core} core
 * @param {any} research
 * @returns {any}
 */
export function createKnowledgeTools(core, research) {
  const store = createKnowledgeStore(core);
  const records = createRecords(core.db);
  const graph = createKnowledgeGraph(core, research);
  function edgeInput(input) {
    // Models sometimes send one evidence object. Keep the catalog's array shape
    // without rejecting a valid quote or adding an evidence-content gate.
    if (input.evidence && !Array.isArray(input.evidence))
      return { ...input, evidence: [input.evidence] };
    return input;
  }
  function writable(ref) {
    const row = records.requireNode(ref);
    if (row.layer === 'derived')
      throw new AppError(
        'KNOWLEDGE_DERIVED_READ_ONLY',
        'Derived relationships are computed; edit a curated relationship instead.',
      );
    if (row.visibility === 'private')
      throw new AppError('KNOWLEDGE_NODE_NOT_FOUND', 'Knowledge node does not exist.', 404);
  }
  function write(ops, actor) {
    const version = store.versions.open({ ...actor, source: 'ai-turn-end' });
    const context = { ...actor, origin: 'ai', versionId: version.id };
    const keys = new Map();
    const resolve = (ref) => {
      if (!String(ref).startsWith('$')) return ref;
      if (!keys.has(ref))
        throw new AppError('KNOWLEDGE_REF_INVALID', `Unknown batch reference: ${ref}`);
      return keys.get(ref);
    };
    const idOf = (ref, type) => String(resolve(ref)).replace(new RegExp(`^${type}:`, 'u'), '');
    function apply(op) {
      if (op.layer === 'derived' || op.patch?.layer === 'derived')
        throw new AppError(
          'KNOWLEDGE_DERIVED_READ_ONLY',
          'The derived layer is computed, not writable.',
        );
      if (op.op === 'createEntity') {
        const entity = store.createEntity(op, context);
        return { id: entity.id, ref: 'entity:' + entity.id };
      }
      if (op.op === 'updateEntity' || op.op === 'updateEdge') {
        const type = op.op === 'updateEntity' ? 'entity' : 'edge';
        const id = idOf(op.id, type);
        writable(`${type}:${id}`);
        const patch = { ...edgeInput(op.patch ?? {}) };
        for (const field of ['fromRef', 'toRef'])
          if (patch[field]) {
            patch[field] = resolve(patch[field]);
            writable(patch[field]);
          }
        store[op.op](id, patch, context);
        return { id, ref: `${type}:${id}` };
      }
      if (op.op === 'createEdge') {
        const input = { ...edgeInput(op), fromRef: resolve(op.fromRef), toRef: resolve(op.toRef) };
        writable(input.fromRef);
        writable(input.toRef);
        const edge = store.createEdge(input, context);
        return { id: edge.id, ref: 'edge:' + edge.id };
      }
      if (op.op === 'merge') {
        const input = {
          into: idOf(op.into, 'entity'),
          from: op.from.map((ref) => idOf(ref, 'entity')),
        };
        for (const id of [input.into, ...input.from]) writable('entity:' + id);
        const merged = store.mergeEntities(input, context);
        return {
          id: merged.entity.id,
          ref: 'entity:' + merged.entity.id,
          relationCount: merged.relationCount,
        };
      }
      const ref = resolve(op.ref);
      writable(ref);
      if (op.op === 'remove') {
        if (ref.startsWith('entity:')) store.removeEntity(ref.slice(7), context);
        else if (ref.startsWith('edge:')) store.removeEdge(ref.slice(5), context);
        else
          throw new AppError(
            'KNOWLEDGE_REF_INVALID',
            'remove expects an entity or edge reference.',
          );
      } else if (op.op === 'label') {
        for (const label of op.add ?? []) store.label(ref, label, true, context);
        for (const label of op.remove ?? []) store.label(ref, label, false, context);
      } else if (op.op === 'member') {
        store.membership(op.projectId, ref, !op.remove, context);
      } else throw new AppError('UNKNOWN_OP', `Unknown knowledge operation: ${op.op}`);
      return { ref };
    }
    const results = ops.map((op, index) => {
      try {
        const result = core.db.transaction(() => apply(op));
        if (op.key && result.ref) keys.set('$' + op.key, result.ref);
        return { index, op: op.op, ...result };
      } catch (error) {
        return {
          index,
          op: op.op,
          error: error.message,
          code: error.code ?? 'KNOWLEDGE_WRITE_FAILED',
        };
      }
    });
    return { versionId: version.id, results };
  }
  function writeResearch({ op, args }, actor) {
    const input = args ?? {};
    if (
      ['updateItem', 'supersedeItem'].includes(op) &&
      research.store.getItem(input.id).visibility === 'private'
    )
      throw new AppError('ITEM_NOT_AVAILABLE', 'Private research items are unavailable.', 404);
    const payload =
      op === 'createItem' ? input : op === 'supersedeItem' ? input.replacement : input.patch;
    if (op !== 'updateSource' && payload?.visibility === 'private')
      throw new AppError(
        'ITEM_NOT_AVAILABLE',
        'Private research items cannot be written by agents.',
      );
    if (op === 'createItem')
      return research.store.createItem({ projectId: actor.projectId, ...input }, actor);
    if (op === 'updateItem') return research.store.updateItem(input.id, input.patch, actor);
    if (op === 'supersedeItem')
      return research.store.supersedeItem(input.id, input.replacement, actor);
    if (op === 'updateSource') return research.store.updateSource(input.id, input.patch, actor);
    throw new AppError('UNKNOWN_OP', `Unknown research operation: ${op}`);
  }
  function versions(args, actor) {
    if (args.action === 'list')
      return store.versions.list({
        projectId: args.projectId ?? (args.meetingId ? undefined : (actor.projectId ?? undefined)),
        meetingId: args.meetingId,
        limit: args.limit,
        offset: args.offset,
      });
    if (args.action === 'read')
      return { version: store.versions.get(args.id), changes: store.versions.changes(args.id) };
    if (args.action === 'restore') {
      const result = store.versions.restore(args.id, { ...actor, origin: 'ai' });
      return {
        ...result,
        skippedReason: result.skipped.length
          ? 'These records were changed after this version and were not restored.'
          : null,
      };
    }
    throw new AppError('UNKNOWN_OP', 'Unknown knowledge history operation.');
  }
  return { graph, write, writeResearch, versions };
}
