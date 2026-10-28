// Consolidation is a resumable background workflow. Only verified proposals are
// saved; confirmation remains a user action. Source checkpoints and cursor commits
// are durable, and request budgets stop between complete stages without truncation.
import { estimateTokens } from '../secretary/policy.js';
import { AppError } from '../../core/errors.js';
import { createMemoryItems } from './items.js';
import { createMemoryStore, hash } from './store.js';
import { createMemorySources } from './sources.js';
import { EXTRACTION_INSTRUCTIONS, VERIFICATION_INSTRUCTIONS, requestMemory } from './request.js';
import { extractCandidates, verification, saveCandidate } from './candidates.js';

// Room kept for one memory reply. Reserving the model's whole maximum
// output (384k on some models) put every request over the default budget.
export const MEMORY_OUTPUT_TOKENS = 32768;

/** The prepared model with its reply room capped to what a memory stage needs. @param {any} prepared */
export function memoryModel(prepared) {
  const outputTokens = Math.min(
    prepared.outputTokens || MEMORY_OUTPUT_TOKENS,
    MEMORY_OUTPUT_TOKENS,
  );
  return { ...prepared, outputTokens };
}

export const DEFAULT_MEMORY_SETTINGS = {
  enabled: true,
  idleMinutes: 10,
  model: null,
  tokenLimit: 100000,
};

/**
 * @param {{core:import('../../core/index.js').Core,minutes:any,research:any,runner:any,now?:()=>string,idleDelayMs?:number}} dependencies
 * @returns {any}
 */
export function createMemoryService({
  core,
  minutes,
  research,
  runner,
  now = () => new Date().toISOString(),
  idleDelayMs,
}) {
  const store = createMemoryStore(core, now);
  const items = createMemoryItems({ core, research, now });
  const sources = createMemorySources({ core, minutes, research });
  const running = new Map();
  const timers = new Map();
  const generations = new Map();
  let unsubscribe;
  let closed = false;

  function eligible(meetingId) {
    const meeting = core.meetings.get(meetingId);
    return (
      Boolean(meeting.projectId) &&
      !meeting.attachedToMeetingId &&
      !meeting.temporary &&
      !meeting.archived
    );
  }

  function busy(meetingId) {
    return (
      core.turns.running().some((turn) => turn.meetingId === meetingId) ||
      core.messages.since(meetingId, 0).some((message) => message.status === 'streaming')
    );
  }

  async function settings() {
    const value = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
    return { ...DEFAULT_MEMORY_SETTINGS, ...value.memory };
  }

  /**
   * @param {string} meetingId
   * @returns {Promise<any>}
   */
  async function status(meetingId) {
    core.meetings.get(meetingId);
    const checkpoint = store.checkpoint(meetingId);
    const configured = await settings();
    return {
      meetingId,
      state: 'idle',
      error: null,
      usage: { tokens: 0, requests: 0, estimatedRequests: 0 },
      retainedOutputs: [],
      ...store.savedStatus(meetingId),
      ...store.cursor(meetingId),
      running: running.has(meetingId),
      tokenLimit: configured.tokenLimit,
      pending: checkpoint
        ? {
            stage: checkpoint.stage,
            pageIndex: checkpoint.pageIndex,
            pages: checkpoint.pages.length,
            verificationIndex: checkpoint.verificationIndex,
            candidates: checkpoint.candidates.length,
            minutesRevision: checkpoint.input.minutesRevision,
          }
        : null,
    };
  }

  async function run(meetingId, reason) {
    if (!eligible(meetingId))
      throw new AppError('MEMORY_MEETING_UNAVAILABLE', '此会议不能整理项目记忆。', 409);
    const configured = await settings();
    const usage = { tokens: 0, requests: 0, estimatedRequests: 0, source: 'none' };
    const result = {
      meetingId,
      state: 'running',
      error: null,
      usage,
      tokenLimit: configured.tokenLimit,
      proposalIds: [],
      retainedOutputs: [],
    };
    if (reason === 'idle' && !configured.enabled) return status(meetingId);
    if (busy(meetingId)) {
      store.saveStatus(meetingId, { ...result, state: 'waiting' });
      return status(meetingId);
    }
    const maximumRowid = Number(
      core.db
        .prepare('SELECT MAX(rowid) AS rowid FROM revisions WHERE resource_key = ?')
        .get('minutes:' + meetingId).rowid ?? 0,
    );
    let checkpoint = store.checkpoint(meetingId);
    store.saveStatus(meetingId, result);
    try {
      const prepared = memoryModel(await runner.prepare(meetingId, { model: configured.model }));
      if (checkpoint && hash(checkpoint.model) !== hash(prepared.model)) {
        core.db.prepare('DELETE FROM memory_checkpoints WHERE meeting_id = ?').run(meetingId);
        checkpoint = null;
      }
      while (!closed) {
        if (!checkpoint)
          checkpoint = sources.plan(
            meetingId,
            store.cursor(meetingId),
            prepared,
            EXTRACTION_INSTRUCTIONS,
            maximumRowid,
          );
        if (!checkpoint) break;
        sources.validate(checkpoint);
        store.saveCheckpoint(meetingId, checkpoint);
        const context = {
          runner,
          store,
          meetingId,
          checkpoint,
          prepared,
          usage,
          tokenLimit: configured.tokenLimit,
        };
        while (checkpoint.stage === 'extract' && checkpoint.pageIndex < checkpoint.pages.length) {
          if (closed || busy(meetingId)) {
            store.saveStatus(meetingId, { ...result, state: 'waiting' });
            return status(meetingId);
          }
          const page = checkpoint.pages[checkpoint.pageIndex];
          const input = JSON.stringify({
            meetingId,
            minutesRevision: checkpoint.input.minutesRevision,
            delta: {
              authorId: checkpoint.input.delta.authorId,
              previousRevision: checkpoint.input.delta.previousRevision,
              minutesRevision: checkpoint.input.delta.minutesRevision,
            },
            sources: page,
          });
          const response = await requestMemory(context, EXTRACTION_INSTRUCTIONS, input, 'extract');
          if (response.skipped) return skip('budget', response.requiredTokens);
          let candidates;
          try {
            candidates = extractCandidates(response.parsed, checkpoint, page, sources);
          } catch (error) {
            const retained = checkpoint.outputs.findLast(
              (output) =>
                output.stage === 'extract' &&
                output.completed &&
                (output.pageIndex ?? 0) === checkpoint.pageIndex,
            );
            if (retained) {
              retained.validationFailed = true;
              store.saveCheckpoint(meetingId, checkpoint);
            }
            throw error;
          }
          const known = new Set(checkpoint.candidates.map((candidate) => candidate.candidateHash));
          checkpoint.candidates.push(
            ...candidates.filter((candidate) => !known.has(candidate.candidateHash)),
          );
          checkpoint.pageIndex += 1;
          store.saveCheckpoint(meetingId, checkpoint);
        }
        checkpoint.stage = 'verify';
        store.saveCheckpoint(meetingId, checkpoint);
        while (checkpoint.verificationIndex < checkpoint.candidates.length) {
          if (closed || busy(meetingId)) {
            store.saveStatus(meetingId, { ...result, state: 'waiting' });
            return status(meetingId);
          }
          const active = research.store.listItems({
            projectId: core.meetings.get(meetingId).projectId,
            includePersonal: false,
            type: 'memory',
            status: 'active',
            visibility: 'shared',
          });
          const remaining = checkpoint.candidates.slice(checkpoint.verificationIndex);
          const batch = [];
          let verificationInput;
          const buildInput = (values) =>
            JSON.stringify({
              candidates: values.map((candidate, candidateIndex) => ({
                candidateIndex,
                candidate,
              })),
              delta: checkpoint.input.delta,
              sources: checkpoint.input.messages,
              currentMemories: active.map(({ id, title, body, revision }) => ({
                id,
                title,
                body,
                revision,
              })),
            });
          for (const candidate of remaining) {
            const input = buildInput([...batch, candidate]);
            const required =
              estimateTokens(`${prepared.prompt}\n${VERIFICATION_INSTRUCTIONS}\n${input}`) +
              (prepared.outputTokens || 32768);
            if (batch.length && prepared.contextWindow && required > prepared.contextWindow) break;
            batch.push(candidate);
            verificationInput = input;
          }
          const response = await requestMemory(
            context,
            VERIFICATION_INSTRUCTIONS,
            verificationInput,
            'verify',
          );
          if (response.skipped) return skip('budget', response.requiredTokens);
          const decisions = verification(response.parsed, active, batch.length);
          sources.validate(checkpoint);
          core.db.transaction(() => {
            for (const decision of decisions) {
              if (!decision.supported || decision.duplicateOf) continue;
              const item = saveCandidate(
                { core, items, checkpoint },
                batch[decision.candidateIndex],
                response.turnId,
              );
              if (item) result.proposalIds.push(item.id);
            }
            checkpoint.verificationIndex += batch.length;
            store.saveCheckpoint(meetingId, checkpoint);
          });
        }
        core.db.transaction(() =>
          store.commit(meetingId, checkpoint.input.minutesRevision, checkpoint.input.throughSeq),
        );
        result.retainedOutputs.push(...checkpoint.outputs);
        checkpoint = null;
        store.saveStatus(meetingId, result);
      }
      result.state = closed ? 'waiting' : 'completed';
      store.saveStatus(meetingId, result);
      return status(meetingId);
    } catch (error) {
      if (error.code === 'MEMORY_SOURCE_CHANGED')
        core.db.prepare('DELETE FROM memory_checkpoints WHERE meeting_id = ?').run(meetingId);
      result.state = error.code === 'MODEL_CONTEXT_EXCEEDED' ? 'skipped' : 'failed';
      result.error = {
        code: error.code ?? 'MEMORY_FAILED',
        message: String(error.message ?? error),
      };
      result.retainedOutputs.push(...(checkpoint?.outputs ?? []));
      store.saveStatus(meetingId, result);
      if (reason === 'manual') throw error;
      return status(meetingId);
    }
    function skip(reasonName, requiredTokens) {
      store.saveStatus(meetingId, {
        ...result,
        state: 'skipped',
        skipReason: reasonName,
        requiredTokens,
        retainedOutputs: [...result.retainedOutputs, ...checkpoint.outputs],
      });
      return status(meetingId);
    }
  }

  /**
   * @param {string} meetingId
   * @param {{reason?:string}} [options]
   * @returns {Promise<any>}
   */
  function consolidate(meetingId, { reason = 'manual' } = {}) {
    if (closed) return Promise.reject(new AppError('MEMORY_CLOSED', '记忆整理服务已关闭。', 409));
    if (running.has(meetingId)) return running.get(meetingId);
    const work = run(meetingId, reason).finally(() => running.delete(meetingId));
    running.set(meetingId, work);
    return work.then(() => status(meetingId));
  }

  async function schedule(meetingId) {
    if (closed || !eligible(meetingId)) return;
    const generation = (generations.get(meetingId) ?? 0) + 1;
    generations.set(meetingId, generation);
    clearTimeout(timers.get(meetingId));
    timers.delete(meetingId);
    const configured = await settings();
    if (closed || !configured.enabled || generation !== generations.get(meetingId)) return;
    const latest =
      core.db
        .prepare('SELECT created_at FROM events WHERE meeting_id = ? ORDER BY seq DESC LIMIT 1')
        .get(meetingId)?.created_at ?? core.meetings.get(meetingId).updatedAt;
    const delay =
      idleDelayMs ??
      Math.max(
        0,
        configured.idleMinutes * 60000 - (Date.parse(now()) - Date.parse(String(latest))),
      );
    const timer = setTimeout(async () => {
      timers.delete(meetingId);
      if (closed) return;
      if (busy(meetingId)) return;
      core.events.transient(
        'meeting.idle',
        { meetingId },
        { meetingId, projectId: core.meetings.get(meetingId).projectId },
      );
      await consolidate(meetingId, { reason: 'idle' }).catch(() => {});
    }, delay);
    timer.unref?.();
    timers.set(meetingId, timer);
  }

  function start() {
    if (closed || unsubscribe) return;
    unsubscribe = core.events.subscribe((event) => {
      if (
        running.has(event.meetingId) &&
        event.actorId === 'agent_secretary' &&
        ['turn.started', 'turn.ended'].includes(event.type)
      )
        return;
      if (
        [
          'message.created',
          'message.updated',
          'turn.started',
          'turn.ended',
          'minutes.updated',
        ].includes(event.type) &&
        event.meetingId
      )
        void schedule(event.meetingId).catch(() => {});
      if (event.type === 'resource.changed' && event.payload.resource === 'settings')
        for (const meeting of core.meetings.list()) void schedule(meeting.id).catch(() => {});
    });
    for (const meeting of core.meetings.list()) void schedule(meeting.id).catch(() => {});
  }

  async function idle() {
    await Promise.allSettled(running.values());
  }
  async function close() {
    closed = true;
    unsubscribe?.();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    await runner.close();
    await idle();
  }
  return { start, close, idle, consolidate, status, ...items };
}
