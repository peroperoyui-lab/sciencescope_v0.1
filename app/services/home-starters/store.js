// Project caches are reusable projections. The global slot is a snapshot, so
// finishing an older project cannot silently replace what the home page shows.
import { nowIso } from '../../core/ids.js';

/**
 * @param {import('../../core/index.js').Core} core
 */
export function createHomeStartersStore(core) {
  const { db, events } = core;
  const state = () => db.prepare('SELECT * FROM home_starters_state WHERE id=1').get();
  const cache = (projectId) =>
    db.prepare('SELECT * FROM home_starters WHERE project_id=?').get(projectId);

  function project(projectId) {
    return db.prepare('SELECT id,name,archived FROM projects WHERE id=?').get(projectId);
  }

  function slot() {
    const snapshot = state();
    if (!snapshot.slot_project_id || !snapshot.slot_result_json) return { slot: null };
    const owner = project(snapshot.slot_project_id);
    if (!owner || owner.archived) return { slot: null };
    const value = JSON.parse(String(snapshot.slot_result_json));
    const experts = new Set(
      core.participants
        .list()
        .filter((entry) => entry.kind === 'ai')
        .map((entry) => entry.id),
    );
    return {
      slot: {
        projectId: String(owner.id),
        projectName: String(owner.name),
        progress: value.progress,
        cards: value.cards.map((card) => ({
          ...card,
          expertId: experts.has(card.expertId) ? card.expertId : null,
        })),
        writtenAt: String(snapshot.slot_written_at),
      },
    };
  }

  function enqueue(projectId) {
    return db.transaction(() => {
      const owner = project(projectId);
      if (!owner || owner.archived) return null;
      const sequence = Number(state().request_seq) + 1;
      db.prepare('UPDATE home_starters_state SET request_seq=? WHERE id=1').run(sequence);
      db.prepare(
        `INSERT INTO home_starters(project_id,pending_seq) VALUES (?,?)
        ON CONFLICT(project_id) DO UPDATE SET pending_seq=excluded.pending_seq`,
      ).run(projectId, sequence);
      return sequence;
    });
  }

  function focus(projectId, focused) {
    return db.transaction(() => {
      const previous = state().focused_project_id;
      if (focused) {
        if (previous === projectId) return;
        if (previous) enqueue(String(previous));
        db.prepare('UPDATE home_starters_state SET focused_project_id=? WHERE id=1').run(projectId);
      } else {
        enqueue(projectId);
        if (previous === projectId)
          db.prepare('UPDATE home_starters_state SET focused_project_id=NULL WHERE id=1').run();
      }
    });
  }

  function recoverFocus() {
    return db.transaction(() => {
      const focused = state().focused_project_id;
      if (!focused) return;
      enqueue(String(focused));
      db.prepare('UPDATE home_starters_state SET focused_project_id=NULL WHERE id=1').run();
    });
  }

  function pending() {
    return db
      .prepare(
        `SELECT project_id,pending_seq FROM home_starters
      WHERE pending_seq IS NOT NULL ORDER BY pending_seq`,
      )
      .all()
      .map((row) => ({
        projectId: String(row.project_id),
        sequence: Number(row.pending_seq),
      }));
  }

  function current(projectId, sequence) {
    return Number(cache(projectId)?.pending_seq) === sequence;
  }

  function finish(projectId, sequence, value, fingerprint, writtenAt = nowIso()) {
    return db.transaction(() => {
      const owner = project(projectId);
      if (!owner || owner.archived || !current(projectId, sequence)) return false;
      const json = JSON.stringify(value);
      db.prepare(
        `UPDATE home_starters SET result_json=?,input_hash=?,written_at=?,error=NULL,
        pending_seq=NULL WHERE project_id=? AND pending_seq=?`,
      ).run(json, fingerprint, writtenAt, projectId, sequence);
      if (Number(state().request_seq) === sequence) {
        db.prepare(
          `UPDATE home_starters_state SET slot_project_id=?,slot_result_json=?,
          slot_written_at=? WHERE id=1`,
        ).run(projectId, json, writtenAt);
        events.record(
          'home.starters.updated',
          { projectId, writtenAt },
          { projectId, actorId: 'agent_secretary' },
        );
      }
      return true;
    });
  }

  function discard(projectId, sequence) {
    db.prepare(
      'UPDATE home_starters SET pending_seq=NULL WHERE project_id=? AND pending_seq=?',
    ).run(projectId, sequence);
  }

  function fail(projectId, sequence, error, turnId) {
    db.transaction(() => {
      if (!current(projectId, sequence)) return;
      db.prepare(
        'UPDATE home_starters SET pending_seq=NULL,error=? WHERE project_id=? AND pending_seq=?',
      ).run(error, projectId, sequence);
      events.record(
        'home.starters.failed',
        { projectId, error, turnId: turnId ?? null },
        { projectId, actorId: 'agent_secretary' },
      );
    });
  }

  return {
    slot,
    cache,
    project,
    enqueue,
    focus,
    recoverFocus,
    pending,
    current,
    finish,
    discard,
    fail,
  };
}
