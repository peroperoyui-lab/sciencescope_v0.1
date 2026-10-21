import { Worker } from 'node:worker_threads';
import { AppError } from '../../core/errors.js';
import { NODES_SQL } from './layout-data.js';
import { CARD_ACTOR_ID } from './card-writer.js';

/**
 * One worker owns layout I/O and computation; foreground turns pause iteration
 * slices. User drags use optimistic timestamps so late layouts cannot undo them.
 * @param {import('../../core/index.js').Core} core
 * @param {{delay?:number}} options
 * @returns {any}
 */
export function createKnowledgeLayout(core, { delay = 2000 } = {}) {
  let worker = null,
    timer = null,
    running = null,
    closed = false,
    dirty = false,
    serial = 0;
  const requests = new Map(),
    reruns = new Set();
  const busy = () => core.turns.running().some((turn) => turn.participantId !== CARD_ACTOR_ID);
  function call(action, input) {
    if (closed) return Promise.reject(new Error('Knowledge layout is closed.'));
    if (!worker) {
      worker = new Worker(new URL('./layout-worker.js', import.meta.url), {
        workerData: { file: core.paths.database },
      });
      worker.on('message', ({ id, value, error }) => {
        const pending = requests.get(id);
        requests.delete(id);
        if (error) pending?.reject(new AppError('KNOWLEDGE_LAYOUT_FAILED', error, 500));
        else pending?.resolve(value);
      });
      const failed = (error) => {
        for (const pending of requests.values()) pending.reject(error);
        requests.clear();
        worker = null;
      };
      worker.on('error', failed);
      worker.on('exit', (code) => {
        if (code && !closed) failed(new Error('Knowledge layout worker exited.'));
      });
      worker.postMessage({ action: 'pause', input: busy() });
    }
    const id = ++serial;
    return new Promise((resolve, reject) => {
      requests.set(id, { resolve, reject });
      worker.postMessage({ id, action, input });
    });
  }
  function notify(value) {
    core.events.transient('knowledge.layout.changed', value);
  }
  function schedule() {
    if (closed || running || busy()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
    timer.unref?.();
  }
  async function drain() {
    if (closed || running || busy()) return running;
    running = (async () => {
      while (!closed && !busy() && (dirty || reruns.size)) {
        const rerun = reruns.size > 0;
        const projectId = rerun ? reruns.values().next().value : null;
        if (rerun) reruns.delete(projectId);
        else dirty = false;
        try {
          const result = await call('arrange', { rerun, projectId });
          if (!closed && (result.full || result.refs.length))
            notify(result.full ? { all: true } : { refs: result.refs });
        } catch (error) {
          if (!closed) notify({ error: String(error.message) });
        }
      }
    })().finally(() => {
      running = null;
      if (dirty || reruns.size) schedule();
    });
    return running;
  }
  function request() {
    dirty = true;
    schedule();
  }
  const unsubscribe = core.events.subscribe((event) => {
    if (['knowledge.changed', 'research.changed', 'project.deleted'].includes(event.type))
      request();
    if (event.type === 'turn.started' || event.type === 'turn.ended') {
      worker?.postMessage({ action: 'pause', input: busy() });
      if (!busy() && (dirty || reruns.size)) schedule();
    }
  });
  function save(positions) {
    const active = core.db.prepare(`SELECT ref FROM (${NODES_SQL}) WHERE ref=?`);
    const write = core.db
      .prepare(`INSERT INTO kb_positions(ref,x,y,pinned,updated_at) VALUES(?,?,?,?,?)
      ON CONFLICT(ref) DO UPDATE SET x=excluded.x,y=excluded.y,pinned=coalesce(?,kb_positions.pinned),updated_at=excluded.updated_at`);
    const refs = [];
    core.db.transaction(() => {
      for (const position of positions) {
        if (!active.get(position.ref)) continue;
        write.run(
          position.ref,
          position.x,
          position.y,
          Number(position.pinned ?? false),
          new Date().toISOString(),
          position.pinned == null ? null : Number(position.pinned),
        );
        refs.push(position.ref);
      }
    });
    if (refs.length) notify({ refs });
    return { refs };
  }
  async function close() {
    closed = true;
    unsubscribe();
    clearTimeout(timer);
    for (const pending of requests.values()) pending.reject(new Error('Knowledge layout closed.'));
    requests.clear();
    await worker?.terminate();
    await running;
  }
  request();
  return {
    index: (projectId = null) => call('index', projectId),
    viewport: (input) => call('viewport', input),
    save,
    rerun(projectId = null) {
      reruns.add(projectId);
      schedule();
      return { queued: true };
    },
    request,
    async idle() {
      clearTimeout(timer);
      timer = null;
      await running;
      await drain();
    },
    close,
  };
}
