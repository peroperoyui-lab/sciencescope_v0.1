// Each leave is durable, but only the newest leave may publish the global
// snapshot. Cards follow refreshed minutes and never advance a chat session.
import { AppError } from '../../core/errors.js';
import { createBackgroundRunner } from '../secretary/background.js';
import { summarySettings } from '../secretary/policy.js';
import { createHomeStartersStore } from './store.js';
import { readStarterInput, parseStarterResult, STARTER_INSTRUCTIONS } from './input.js';

/**
 * @param {{core:import('../../core/index.js').Core,
 * minutes:Pick<ReturnType<typeof import('../secretary/minutes.js').createMinutesService>,'settled'>,
 * runtime:import('../../runtime/port.js').Runtime,
 * defaultModel:(meeting?:any)=>Promise<import('../../runtime/port.js').ModelChoice|null>,
 * modelCatalog?:any}} dependencies
 */
export function createHomeStarters({ core, minutes, runtime, defaultModel, modelCatalog }) {
  const store = createHomeStartersStore(core);
  const runner = createBackgroundRunner({ core, runtime, defaultModel, modelCatalog });
  const abort = new AbortController();
  /** @type {Set<() => void>} */
  const waiting = new Set();
  const recovering = new Set();
  let started = false;
  let closed = false;
  let running;
  let unsubscribe;
  let foregroundGeneration = 0;

  function wake() {
    for (const done of waiting) done();
    waiting.clear();
  }

  function foregroundActive() {
    return core.turns.running().some((turn) => turn.participantId !== 'agent_secretary');
  }

  async function enabled() {
    const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
    return summarySettings(settings.value.summary).onLeaveProject;
  }

  async function waitForForeground() {
    while (!closed && foregroundActive())
      await new Promise((resolve) => waiting.add(() => resolve(undefined)));
    return !closed;
  }

  async function process(projectId, sequence) {
    let turnId;
    try {
      if (!(await enabled())) {
        store.discard(projectId, sequence);
        return;
      }
      while (await waitForForeground()) {
        const settled = await minutes.settled(projectId, {
          signal: abort.signal,
          recover: recovering.has(projectId),
        });
        if (closed || settled.closed) return;
        recovering.delete(projectId);
        if (settled.errors.length)
          throw new AppError('HOME_MINUTES_FAILED', '纪要尚未整理成功，已保留上一次首页建议。');
        if (foregroundActive()) continue;
        if (!store.current(projectId, sequence)) return;
        const generation = foregroundGeneration;
        const input = await readStarterInput(core, projectId);
        if (closed) return;
        if (!(await enabled())) {
          store.discard(projectId, sequence);
          return;
        }
        if (closed || !store.current(projectId, sequence)) return;
        if (foregroundActive() || generation !== foregroundGeneration) continue;
        const cached = store.cache(projectId);
        if (cached?.input_hash === input.fingerprint && cached.result_json) {
          store.finish(
            projectId,
            sequence,
            JSON.parse(String(cached.result_json)),
            input.fingerprint,
            String(cached.written_at),
          );
          return;
        }
        if (!input.meetingId)
          throw new AppError(
            'HOME_MEETING_REQUIRED',
            '这个项目还没有可用的对话，已保留上一次首页建议。',
          );
        const prepared = await runner.prepare(input.meetingId);
        if (closed || !store.current(projectId, sequence)) return;
        // Preparation may yield while the person begins another foreground turn.
        if (foregroundActive() || generation !== foregroundGeneration) continue;
        const response = await runner.run(
          input.meetingId,
          STARTER_INSTRUCTIONS,
          input.input,
          prepared,
        );
        turnId = response.turnId;
        if (closed) return;
        const expertIds = core.participants
          .list()
          .filter((entry) => entry.kind === 'ai')
          .map((entry) => entry.id);
        const value = parseStarterResult(response.text, expertIds);
        if (!(await enabled())) {
          store.discard(projectId, sequence);
          return;
        }
        if (!closed) store.finish(projectId, sequence, value, input.fingerprint);
        return;
      }
    } catch (error) {
      if (!closed)
        store.fail(projectId, sequence, String(error.message ?? error), turnId ?? error.turnId);
    }
  }

  async function drain() {
    while (!closed) {
      const next = store.pending()[0];
      if (!next) return;
      const project = store.project(next.projectId);
      if (!project || project.archived) {
        store.discard(next.projectId, next.sequence);
        continue;
      }
      await process(next.projectId, next.sequence);
    }
  }

  function kick() {
    if (!started || closed || running) return;
    running = drain().finally(() => {
      running = null;
      if (!closed && store.pending().length) kick();
    });
  }

  function start() {
    if (started || closed) return;
    started = true;
    store.recoverFocus();
    for (const pending of store.pending()) recovering.add(pending.projectId);
    unsubscribe = core.events.subscribe((event) => {
      if (
        ['turn.started', 'turn.ended'].includes(event.type) &&
        event.actorId !== 'agent_secretary'
      )
        foregroundGeneration++;
      if (event.type === 'turn.ended') wake();
    });
    kick();
  }

  function focus(projectId, focused) {
    if (closed) return;
    core.projects.get(projectId);
    store.focus(projectId, focused);
    kick();
  }

  async function idle() {
    while (running) await running;
  }

  async function close() {
    if (closed) return;
    closed = true;
    store.recoverFocus();
    abort.abort();
    wake();
    unsubscribe?.();
    await runner.close();
    await idle();
  }

  return { start, focus, idle, close, slot: store.slot };
}
