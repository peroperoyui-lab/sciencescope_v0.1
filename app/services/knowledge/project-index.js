// One listing per project and one coalesced follow-up. Catalog rows and immutable
// copies outlive folder moves; queued rows reconstruct background work on restart.
import { stat as fileStat } from 'node:fs/promises';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { snapshotProjectFile, createProjectCopies } from './project-copies.js';
import { listProjectFiles } from './project-index-listing.js';
import { processIndexJob, removeMissingSources } from './project-index-worker.js';
import { createIndexProgress } from './project-index-progress.js';

export const INDEX_CONCURRENCY = 2;
const counts = () => ({
  added: 0,
  updated: 0,
  unchanged: 0,
  nameOnly: 0,
  failed: 0,
  moved: 0,
  deleted: 0,
});

/**
 * @param {{core:import('../../core/index.js').Core,
 * research:ReturnType<typeof import('../research/index.js').createResearch>,
 * files:ReturnType<typeof import('../project-files.js').createProjectFiles>,
 * copy?:typeof snapshotProjectFile,stat?:(file:string)=>Promise<import('node:fs').Stats>,concurrency?:number,batchSize?:number}} deps
 */
export function createProjectIndex({
  core,
  research,
  files,
  copy = snapshotProjectFile,
  stat = fileStat,
  concurrency = INDEX_CONCURRENCY,
  batchSize = 500,
}) {
  const running = new Map();
  const finished = new Map();
  const results = new Map();
  const maintenance = new Map();
  const copies = createProjectCopies(core, research.store);
  const notifications = createIndexProgress(core);
  const parallelism = Math.max(1, Math.floor(concurrency));
  let activeWorkers = 0;
  const waitingWorkers = [];
  const roots = new Map(
    core.projects
      .list({ includeArchived: true })
      .map((project) => [project.id, files.rootOf(project.id)]),
  );
  let closed = false;

  // All projects share the disk/parse budget. Queued projects take turns as each
  // file finishes, rather than multiplying concurrency for every open project.
  async function takeWorker() {
    if (activeWorkers < parallelism) activeWorkers++;
    else await new Promise((resolve) => waitingWorkers.push(resolve));
  }

  function releaseWorker() {
    const next = waitingWorkers.shift();
    if (next) next();
    else activeWorkers--;
  }

  function summary(state) {
    return {
      phase: state.phase,
      total: state.total,
      done: state.done,
      queued: Math.max(0, state.total - state.done),
      failed: state.result.failed,
    };
  }
  const progress = (state) => notifications.publish(state.projectId, summary(state));

  function current(state) {
    if (closed || state.cancelled) return false;
    const project = core.projects.get(state.projectId);
    if (project.archived || files.rootOf(state.projectId) !== state.root) {
      state.cancelled = true;
      state.again = !project.archived;
      return false;
    }
    return true;
  }

  // Recheck after asynchronous copying/parsing, before publishing its projection.
  async function isCurrent(state, job) {
    if (!current(state)) return false;
    let source;
    try {
      source = research.store.getSource(job.source.id);
    } catch (error) {
      if (error.code === 'SOURCE_NOT_FOUND') return false;
      throw error;
    }
    if (
      source.contentStatus !== 'queued' ||
      source.folderPath !== job.relative ||
      source.fileSize !== job.stamp.fileSize ||
      source.fileMtimeMs !== job.stamp.fileMtimeMs
    )
      return false;
    try {
      const info = await fileStat(job.file);
      if (info.size === job.stamp.fileSize && info.mtimeMs === job.stamp.fileMtimeMs)
        return current(state);
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) return current(state);
    }
    state.dirty = true;
    return false;
  }

  async function processQueue(state) {
    let cursor = 0;
    async function worker() {
      while (current(state) && cursor < state.jobs.length) {
        const job = state.jobs[cursor++];
        await takeWorker();
        let result;
        try {
          result = await processIndexJob({ core, research, copy, isCurrent }, state, job);
        } finally {
          releaseWorker();
        }
        if (result) state.done++;
        progress(state);
        // Parsing stays in its existing service; yield between files for other work.
        await yieldLoop();
      }
    }
    const settled = await Promise.allSettled(Array.from({ length: parallelism }, worker));
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    await removeMissingSources({ core, research, files, current }, state);
  }

  function start(projectId, retryChanges = true) {
    const state = {
      projectId,
      root: files.rootOf(projectId),
      phase: 'listing',
      total: 0,
      done: 0,
      result: counts(),
      jobs: [],
      missing: [],
      missingByHash: new Map(),
      moved: new Set(),
      cancelled: false,
      again: false,
      dirty: false,
      listing: null,
      promise: null,
    };
    roots.set(projectId, state.root);
    running.set(projectId, state);
    progress(state);
    state.listing = (async () => {
      if (current(state))
        await listProjectFiles({ core, research, stat, batchSize, current, progress }, state);
      state.phase = 'indexing';
      progress(state);
      return { ...state.result, queued: state.jobs.length };
    })();
    state.promise = (async () => {
      try {
        await state.listing;
        // Returning listing never starts a content read in the caller's microtask.
        await yieldLoop();
        await processQueue(state);
        if (
          (state.again || (state.dirty && retryChanges)) &&
          !closed &&
          !core.projects.get(projectId).archived
        ) {
          running.delete(projectId);
          // A continuously written file must not keep cleanup/full-scan callers
          // waiting forever. It stays queued for the next request or restart.
          return await start(projectId, state.again).promise;
        }
        return { ...state.result, queued: catalogStatus(projectId).queued };
      } finally {
        if (running.get(projectId) === state) {
          state.phase = 'idle';
          const catalog = catalogStatus(projectId);
          state.total = catalog.total;
          state.done = catalog.done;
          finished.set(projectId, summary(state));
          results.set(projectId, { ...state.result, queued: summary(state).queued });
          running.delete(projectId);
          progress(state);
        }
      }
    })();
    // Background failures must be observable even when callers only awaited listing.
    void state.promise.catch((error) => {
      if (!closed)
        core.events.transient('research.index.failed', { error: error.message }, { projectId });
    });
    return state;
  }

  /**
   * Return after catalog/filename indexing, independently of content processing.
   * @param {string} projectId
   */
  function scan(projectId) {
    if (closed) return Promise.reject(new Error('Project index is closed.'));
    if (maintenance.has(projectId)) return maintenance.get(projectId).then(() => scan(projectId));
    const existing = running.get(projectId);
    if (existing?.phase === 'listing') return existing.listing;
    if (existing) {
      existing.again = true;
      return existing.listing;
    }
    return start(projectId).listing;
  }

  // Capture only the queue present at construction, not rows a new manual scan
  // creates before this startup callback runs.
  const resumeIds = core.db
    .prepare(
      "SELECT DISTINCT project_id FROM rb_sources WHERE folder_path IS NOT NULL AND content_status='queued'",
    )
    .all()
    .map((row) => String(row.project_id));
  const startup = yieldLoop().then(() => {
    for (const id of resumeIds)
      if (!closed && !running.has(id) && !core.projects.get(id).archived) request(id);
  });

  /**
   * Wait for current work (and a coalesced follow-up), without starting a scan.
   * @param {string} projectId
   */
  async function idle(projectId) {
    await startup;
    return running.get(projectId)?.promise;
  }

  /**
   * Explicit full-completion API for tests and non-interactive callers.
   * @param {string} projectId
   */
  async function scanAndWait(projectId) {
    await scan(projectId);
    return (await idle(projectId)) ?? results.get(projectId);
  }

  /**
   * @param {string} projectId
   */
  function status(projectId) {
    core.projects.get(projectId);
    if (running.has(projectId)) return summary(running.get(projectId));
    if (finished.has(projectId)) return { ...finished.get(projectId) };
    return catalogStatus(projectId);
  }

  function catalogStatus(projectId) {
    const row = core.db
      .prepare(
        `SELECT COUNT(*) AS total,
      SUM(content_status='queued') AS queued, SUM(content_status='failed') AS failed
      FROM rb_sources WHERE project_id=? AND folder_path IS NOT NULL`,
      )
      .get(projectId);
    const total = Number(row.total);
    const queued = Number(row.queued ?? 0);
    return { phase: 'idle', total, done: total - queued, queued, failed: Number(row.failed ?? 0) };
  }

  /**
   * @param {string} projectId
   */
  function request(projectId) {
    if (closed) return;
    void scan(projectId).catch((error) => {
      core.events.transient('research.index.failed', { error: error.message }, { projectId });
    });
  }

  const unsubscribe = core.events.subscribe((event) => {
    if (event.type !== 'project.updated' || closed) return;
    const root = files.rootOf(event.projectId);
    const rebound = roots.has(event.projectId) && roots.get(event.projectId) !== root;
    roots.set(event.projectId, root);
    if (rebound) {
      research.store.queueProjectSources(event.projectId);
      finished.delete(event.projectId);
    }
    const state = running.get(event.projectId);
    if (state && (event.payload.archived || files.rootOf(event.projectId) !== state.root)) {
      state.cancelled = true;
      state.again = !event.payload.archived;
    } else if (state?.cancelled && !event.payload.archived) state.again = true;
    else if (
      !state &&
      !event.payload.archived &&
      (rebound || catalogStatus(event.projectId).queued)
    )
      request(event.projectId);
  });

  /**
   * Copies referenced by in-flight parsers must not be cleaned up.
   * @param {string} projectId
   */
  function cleanupCopies(projectId) {
    if (closed) return Promise.reject(new Error('Project index is closed.'));
    if (maintenance.has(projectId)) return maintenance.get(projectId);
    const operation = (async () => {
      await idle(projectId);
      return copies.cleanup(projectId);
    })().finally(() => maintenance.delete(projectId));
    maintenance.set(projectId, operation);
    return operation;
  }

  /**
   * @param {string} projectId
   * @param {string} relative
   * @returns {{status:string,sourceId:string|null,error:string|null}}
   */
  function entry(projectId, relative) {
    const row = core.db
      .prepare(
        'SELECT id, content_status, parse_error FROM rb_sources WHERE project_id=? AND folder_path=?',
      )
      .get(projectId, relative);
    const value = {
      parsed: 'parsed',
      partial: 'parsed',
      queued: 'parsing',
      'name-only': 'name-only',
      failed: 'failed',
    };
    return {
      status: value[String(row?.content_status)] ?? 'unindexed',
      sourceId: row ? String(row.id) : null,
      error: row?.parse_error == null ? null : String(row.parse_error),
    };
  }

  return {
    scan,
    scanAndWait,
    idle,
    status,
    request,
    entry,
    copyUsage: copies.all,
    cleanupCopies,
    async close() {
      closed = true;
      unsubscribe();
      await startup;
      await Promise.allSettled([...running.values()].map((state) => state.promise));
      await Promise.allSettled([...maintenance.values()]);
      notifications.close();
    },
  };
}
