// One event subscriber maintains each meeting's minutes independently of its
// foreground sessions. Fresh summary sessions receive only prior minutes and
// uncovered raw messages; revision ancestry carries coverage through edits/undo.
import { closeKnowledgeTurn } from '../knowledge/versions.js';
import { AppError } from '../../core/errors.js';
import { createBackgroundRunner } from './background.js';
import {
  DEFAULT_SUMMARY,
  estimateTokens,
  isEligibleMessage,
  MINUTES_INSTRUCTIONS,
  summaryInput,
  summaryBatch,
  summarySettings,
} from './policy.js';
import { updateWorkbench } from './publish.js';
import { createMinutesStore } from './store.js';

export { DEFAULT_SUMMARY, estimateTokens };

/**
 * @param {{core:import('../../core/index.js').Core,runtime:import('../../runtime/port.js').Runtime,
 * defaultModel:(meeting?:any)=>Promise<import('../../runtime/port.js').ModelChoice|null>,
 * debounceMs?:number,pendingDelayMs?:number,modelCatalog?:any}} dependencies
 * @returns {{start:()=>void,close:()=>Promise<void>,idle:()=>Promise<void>,refresh:(meetingId:string,options?:{reason?:string})=>Promise<any>,status:(meetingId:string)=>Promise<any>,focus:(projectId:string|null)=>any,edit:(meetingId:string,text:string,expectedRevision:string|null)=>Promise<any>,coverage:(meetingId:string,revision?:any)=>number,coveredMessageIds:(meetingId:string,revision?:any)=>string[]}}
 */
export function createMinutesService({
  core,
  runtime,
  defaultModel,
  modelCatalog,
  debounceMs = 1500,
  pendingDelayMs = 30000,
}) {
  const store = createMinutesStore(core);
  const runner = createBackgroundRunner({ core, runtime, defaultModel, modelCatalog });
  const timers = new Map();
  const running = new Map();
  const deferred = new Map();
  let unsubscribe;
  let closed = false;
  let focusedProject = null;
  let pendingTimer;
  let pendingWork = Promise.resolve();

  function eligibleMeeting(meetingId) {
    const meeting = core.meetings.get(meetingId);
    return (
      !meeting.archived &&
      !meeting.temporary &&
      !meeting.attachedToMeetingId &&
      meeting.policy.respondent !== 'agent_assistant'
    );
  }

  async function settings() {
    return summarySettings(
      (await core.workspace.read({ resource: 'settings', key: 'app' })).value.summary,
    );
  }

  /**
   * @param {string} meetingId
   * @param {any} [revision]
   * @returns {number}
   */
  function coverage(meetingId, revision) {
    return store.state(meetingId, revision).throughSeq;
  }

  /**
   * @param {string} meetingId
   * @param {any} [revision]
   * @returns {string[]}
   */
  function coveredMessageIds(meetingId, revision) {
    return store.state(meetingId, revision).coveredMessageIds;
  }

  function uncoveredMessages(meetingId, revision) {
    const covered = store.state(meetingId, revision);
    const ids = new Set(covered.coveredMessageIds);
    return core.messages
      .since(meetingId, 0)
      .filter(
        (message) =>
          isEligibleMessage(message) && (message.seq > covered.throughSeq || !ids.has(message.id)),
      );
  }

  /**
   * @param {string} meetingId
   * @returns {Promise<any>}
   */
  async function status(meetingId) {
    core.meetings.get(meetingId);
    const file = await core.workspace.read({ resource: 'minutes', key: meetingId });
    const revision = file.revisionId
      ? core.db.prepare('SELECT * FROM revisions WHERE id = ?').get(file.revisionId)
      : null;
    const rule = await settings();
    const pending = uncoveredMessages(meetingId, revision);
    const estimatedTokens = pending.reduce(
      (total, message) => total + estimateTokens(message.text),
      0,
    );
    const latestSeq = core.messages.since(meetingId, 0).at(-1)?.seq ?? 0;
    const revisionNumber = Number(
      core.db
        .prepare('SELECT COUNT(*) AS count FROM revisions WHERE resource_key = ?')
        .get(`minutes:${meetingId}`).count,
    );
    return {
      meetingId,
      text: file.text ?? '',
      revision: revision?.id == null ? null : String(revision.id),
      revisionNumber,
      author: revision?.actor_id === 'agent_secretary' ? 'secretary' : 'user',
      throughSeq: coverage(meetingId, revision),
      latestSeq,
      updating: running.has(meetingId) || timers.has(meetingId) || deferred.has(meetingId),
      newMessages: pending.length,
      estimatedTokens,
      messagesRemaining: rule.everyMessages.enabled
        ? Math.max(0, rule.everyMessages.n - pending.length)
        : null,
      tokensRemaining: rule.everyTokens.enabled
        ? Math.max(0, rule.everyTokens.n - estimatedTokens)
        : null,
      ...store.status(meetingId),
    };
  }

  function foregroundActive(meetingId) {
    return (
      core.turns
        .running()
        .some((turn) => turn.meetingId === meetingId && turn.participantId !== 'agent_secretary') ||
      core.messages.since(meetingId, 0).some((message) => message.status === 'streaming')
    );
  }

  async function shouldRefresh(meetingId, reason) {
    const state = await status(meetingId);
    if (!state.newMessages) return false;
    const rule = await settings();
    if (reason === 'discussion') return rule.afterDiscussion;
    if (reason === 'enter') return rule.onEnterProject;
    if (reason === 'leave' || reason === 'pending') return rule.onLeaveProject;
    if (reason === 'manual') return true;
    return (
      (rule.everyMessages.enabled && state.newMessages >= rule.everyMessages.n) ||
      (rule.everyTokens.enabled && state.estimatedTokens >= rule.everyTokens.n)
    );
  }

  async function update(meetingId, reason) {
    if (closed || !eligibleMeeting(meetingId) || !(await shouldRefresh(meetingId, reason)))
      return status(meetingId);
    if (closed) return status(meetingId);
    if (foregroundActive(meetingId)) {
      deferred.set(meetingId, reason);
      return status(meetingId);
    }
    let previous = await status(meetingId);
    let pending = uncoveredMessages(meetingId, previous.revision);
    if (!pending.length || closed) return previous;
    const names = new Map(
      core.participants.list().map((participant) => [participant.id, participant.name]),
    );
    store.patchStatus(meetingId, { error: null, incompleteOutput: null });
    try {
      while (pending.length && !closed) {
        if (foregroundActive(meetingId)) {
          deferred.set(meetingId, reason);
          return status(meetingId);
        }
        const prepared = await runner.prepare(meetingId);
        const batch = summaryBatch(prepared, previous, pending, (id) => names.get(id) ?? id);
        const response = await runner.run(
          meetingId,
          MINUTES_INSTRUCTIONS,
          summaryInput(previous, batch, (id) => names.get(id) ?? id),
          prepared,
        );
        if (closed) return status(meetingId);
        const saved = await core.workspace.edit(
          {
            resource: 'minutes',
            key: meetingId,
            op: 'write',
            args: { text: response.text },
            expectedRevisionId: previous.revision,
            forceRevision: true,
          },
          { actorId: 'agent_secretary', meetingId, turnId: response.turnId },
        );
        if (!saved.revisionId) return status(meetingId);
        const ids = [
          ...new Set([
            ...coveredMessageIds(meetingId, previous.revision),
            ...batch.map((message) => message.id),
          ]),
        ];
        const throughSeq = Math.max(previous.throughSeq, ...batch.map((message) => message.seq));
        store.save(meetingId, saved.revisionId, throughSeq, ids);
        core.workspace.captureTurnSnapshots(response.turnId);
        closeKnowledgeTurn(core, response.turnId);
        core.messages.recordConsumption(
          batch.filter((message) => message.adopted).map((message) => message.id),
          response.turnId,
        );
        const rule = await settings();
        core.events.record(
          'minutes.updated',
          { meetingId, revision: saved.revisionId, throughSeq },
          {
            meetingId,
            projectId: core.meetings.get(meetingId).projectId,
            actorId: 'agent_secretary',
          },
        );
        if (!closed) {
          try {
            await updateWorkbench({
              core,
              runner,
              store,
              meetingId,
              minutesRevisionId: saved.revisionId,
              minutes: response.text,
              modes: rule.workbench,
            });
          } catch (error) {
            store.patchStatus(meetingId, { workbenchError: String(error.message ?? error) });
          }
        }
        previous = await status(meetingId);
        pending = pending.slice(batch.length);
      }
      return status(meetingId);
    } catch (error) {
      // Concurrent user/external edits win. Their next refresh starts with their text.
      if (error.code === 'REVISION_CONFLICT') return status(meetingId);
      store.patchStatus(meetingId, {
        error: String(error.message ?? error),
        incompleteOutput: error.incompleteOutput || null,
      });
      if (reason === 'manual' && !closed) throw error;
      return status(meetingId);
    }
  }

  function clearScheduled(meetingId) {
    const scheduled = timers.get(meetingId);
    if (!scheduled) return;
    clearTimeout(scheduled.timer);
    timers.delete(meetingId);
    scheduled.resolve();
  }

  /**
   * @param {string} meetingId
   * @param {{reason?:string}} [options]
   * @returns {Promise<any>}
   */
  function refresh(meetingId, { reason = 'manual' } = {}) {
    clearScheduled(meetingId);
    if (closed) return status(meetingId);
    if (running.has(meetingId))
      return running
        .get(meetingId)
        .catch(() => {})
        .then(() => refresh(meetingId, { reason }));
    const work = update(meetingId, reason).finally(() => running.delete(meetingId));
    running.set(meetingId, work);
    return work;
  }

  function schedule(meetingId, reason) {
    if (closed || !eligibleMeeting(meetingId)) return;
    const existing = timers.get(meetingId);
    if (existing) {
      if (reason === 'threshold' && existing.reason !== 'threshold') reason = existing.reason;
      clearScheduled(meetingId);
    }
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    const timer = setTimeout(() => {
      timers.delete(meetingId);
      void refresh(meetingId, { reason })
        .catch(() => {})
        .finally(resolve);
    }, debounceMs);

    timers.set(meetingId, { timer, promise, resolve, reason });
  }

  function projectMeetings(projectId, reason) {
    for (const meeting of core.meetings.list({ projectId })) schedule(meeting.id, reason);
  }

  /**
   * @param {string|null} projectId
   * @returns {{projectId:string|null,previous?:string|null,changed:boolean}}
   */
  function focus(projectId) {
    if (projectId) core.projects.get(projectId);
    if (closed || projectId === focusedProject)
      return { projectId: focusedProject, changed: false };
    const previous = focusedProject;
    focusedProject = projectId;
    if (previous) projectMeetings(previous, 'leave');
    if (projectId) projectMeetings(projectId, 'enter');
    return { projectId, previous, changed: true };
  }

  /**
   * @param {string} meetingId
   * @param {string} text
   * @param {string|null} expectedRevision
   * @returns {Promise<any>}
   */
  async function edit(meetingId, text, expectedRevision) {
    if (closed) throw new AppError('MINUTES_CLOSED', '纪要服务已关闭。', 409);
    const previous = await status(meetingId);
    if (previous.revision !== expectedRevision)
      throw new AppError('REVISION_CONFLICT', '纪要已更新，请重新读取后再编辑。', 409);
    const saved = await core.workspace.edit(
      {
        resource: 'minutes',
        key: meetingId,
        op: 'write',
        args: { text },
        expectedRevisionId: expectedRevision,
      },
      { actorId: 'person_user', meetingId },
    );
    const current = await status(meetingId);
    core.events.record(
      'minutes.updated',
      { meetingId, revision: saved.revisionId ?? current.revision, throughSeq: current.throughSeq },
      { meetingId, projectId: core.meetings.get(meetingId).projectId, actorId: 'person_user' },
    );
    return status(meetingId);
  }

  async function processPending() {
    const rows = core.db
      .prepare('SELECT project_id FROM secretary_pending_projects ORDER BY created_at')
      .all();
    for (const row of rows) {
      if (closed) return;
      const projectId = String(row.project_id);
      let complete = true;
      for (const meeting of core.meetings.list({ projectId })) {
        if (!eligibleMeeting(meeting.id)) continue;
        await refresh(meeting.id, { reason: 'pending' });
        if (uncoveredMessages(meeting.id).length) complete = false;
      }
      if (complete)
        core.db
          .prepare('DELETE FROM secretary_pending_projects WHERE project_id = ?')
          .run(projectId);
    }
  }

  function start() {
    if (closed || unsubscribe) return;
    unsubscribe = core.events.subscribe((event) => {
      if (!event.meetingId || closed) return;
      if (event.type === 'discussion.finished' && !event.payload?.cancelled)
        schedule(event.meetingId, 'discussion');
      if (['message.created', 'message.updated'].includes(event.type))
        schedule(event.meetingId, 'threshold');
      if (event.type === 'turn.ended' && event.actorId !== 'agent_secretary') {
        const reason = deferred.get(event.meetingId) ?? 'threshold';
        deferred.delete(event.meetingId);
        schedule(event.meetingId, reason);
      }
    });
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      pendingWork = processPending().catch(() => {});
    }, pendingDelayMs);
    pendingTimer.unref?.();
  }

  async function idle() {
    while (timers.size || running.size) {
      await Promise.allSettled(
        [...timers.values()].map((entry) => entry.promise).concat([...running.values()]),
      );
    }
    await pendingWork;
  }

  async function close() {
    if (closed) return;
    const pendingProjects = new Set(focusedProject ? [focusedProject] : []);
    // A rapid project switch can leave the previous project's debounced work
    // queued when the window closes; persist those projects as well.
    for (const meetingId of new Set([...timers.keys(), ...deferred.keys(), ...running.keys()])) {
      const projectId = core.meetings.get(meetingId).projectId;
      if (projectId) pendingProjects.add(projectId);
    }
    if ((await settings()).onLeaveProject) {
      for (const projectId of pendingProjects) {
        const dirty = core.meetings
          .list({ projectId })
          .some((meeting) => eligibleMeeting(meeting.id) && uncoveredMessages(meeting.id).length);
        if (!dirty) continue;
        core.db
          .prepare(
            `INSERT INTO secretary_pending_projects (project_id, created_at) VALUES (?, ?)
           ON CONFLICT(project_id) DO UPDATE SET created_at = excluded.created_at`,
          )
          .run(projectId, new Date().toISOString());
      }
    }
    closed = true;
    unsubscribe?.();
    clearTimeout(pendingTimer);
    for (const meetingId of timers.keys()) clearScheduled(meetingId);
    deferred.clear();
    await runner.close();
    await Promise.allSettled(running.values());
    await pendingWork;
  }

  return { start, close, idle, refresh, status, focus, edit, coverage, coveredMessageIds };
}
