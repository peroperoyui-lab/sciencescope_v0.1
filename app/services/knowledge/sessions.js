import { AppError } from '../../core/errors.js';

const user = { actorId: 'person_user', origin: 'user' };

/**
 * One HTTP edit is one step, even when a merge changes several records.
 * Revision identities, not timestamps, distinguish our undo from a concurrent edit.
 * Stacks are disposable; the durable version remains recoverable after a restart.
 * @param {import('../../core/index.js').Core} core
 * @param {any} knowledge
 * @returns {any}
 */
export function createKnowledgeSessions(core, knowledge) {
  const { versions } = knowledge;
  const stacks = new Map();
  const head = (ref, before = Number.MAX_SAFE_INTEGER) =>
    core.db
      .prepare('SELECT id FROM kb_revisions WHERE ref=? AND rowid<? ORDER BY rowid DESC LIMIT 1')
      .get(ref, before)?.id ?? null;

  function open(input = {}) {
    const version = versions.open({ projectId: input.projectId, ...user, source: 'leave-page' });
    stacks.set(version.id, { undo: [], redo: [] });
    return { id: version.id };
  }
  function stack(id) {
    versions.begin({ versionId: id });
    const value = stacks.get(id);
    if (!value)
      throw new AppError(
        'KNOWLEDGE_SESSION_NOT_FOUND',
        'Open a new knowledge editing session.',
        409,
      );
    return value;
  }
  function edit(sessionId, work) {
    if (!sessionId)
      return core.db.transaction(() => {
        const version = versions.open({ ...user, source: 'leave-page' });
        const result = work({ ...user, versionId: version.id });
        versions.close(version.id);
        return result;
      });
    return core.db.transaction(() => {
      const id = sessionId;
      const state = stack(id);
      const previous = versions.changes(id).at(-1)?.rowid ?? 0;
      const result = work({ ...user, versionId: id });
      const changed = new Map();
      for (const row of versions.changes(id).filter((revision) => revision.rowid > previous)) {
        const entry = changed.get(row.ref) ?? {
          ref: row.ref,
          before: row.before,
          beforeHead: head(row.ref, row.rowid),
        };
        Object.assign(entry, { after: row.after, afterHead: row.id });
        changed.set(row.ref, entry);
      }
      state.redo = [];
      if (changed.size) state.undo.push([...changed.values()]);
      return result;
    });
  }
  function replay(id, op) {
    return core.db.transaction(() => {
      const state = stack(id);
      const undo = op === 'undo';
      const source = undo ? state.undo : state.redo;
      const destination = undo ? state.redo : state.undo;
      const step = source.at(-1) ?? [];
      const applied = [],
        skipped = [];
      // Each record is coalesced to its first before-state and last after-state.
      for (const entry of [...step].reverse()) {
        const expected = undo ? 'afterHead' : 'beforeHead';
        const target = undo ? 'beforeHead' : 'afterHead';
        if (head(entry.ref) !== entry[expected]) {
          skipped.push(entry.ref);
          continue;
        }
        const revisionId = versions.replayRecord(
          id,
          entry.ref,
          undo ? entry.before : entry.after,
          op,
          user,
        );
        const targetHead = entry[target];
        // An earlier step becomes undoable again only if this step really
        // returned to its revision; never walk backwards across another author.
        for (const other of [...state.undo, ...state.redo].flat()) {
          if (other.ref !== entry.ref) continue;
          for (const key of ['beforeHead', 'afterHead'])
            if (other[key] === targetHead) other[key] = revisionId;
        }
        entry[target] = revisionId;
        applied.unshift(entry);
      }
      source.pop();
      if (applied.length) destination.push(applied);
      const refs = applied.map((entry) => entry.ref);
      versions.invalidateDerived(refs);
      versions.changed(refs, user);
      return { refs, skipped, canUndo: !!state.undo.length, canRedo: !!state.redo.length };
    });
  }
  function close(id) {
    const result = versions.close(id);
    stacks.delete(id);
    return result;
  }
  function recover() {
    const ids = core.db
      .prepare("SELECT id FROM kb_versions WHERE source='leave-page' AND closed_at IS NULL")
      .all();
    return ids.map((row) => close(row.id));
  }
  return {
    open,
    edit,
    close,
    recover,
    undo: (id) => replay(id, 'undo'),
    redo: (id) => replay(id, 'redo'),
  };
}
