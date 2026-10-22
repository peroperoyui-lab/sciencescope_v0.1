// One FIFO serves background and requested comparisons. Files are immutable;
// only the reproducible diff projection is cached in SQLite, never originals.
import { AppError } from '../../core/errors.js';
import { nowIso } from '../../core/ids.js';
import { DIFF_ALGORITHM } from '../desk/diff.js';
import { runDiffWorker } from './diff-worker-client.js';

/**
 * @param {import('../../core/index.js').Core} core
 * @param {{compute?:typeof runDiffWorker,log?:(...args:any[])=>void}} [options]
 * @returns {any}
 */
export function createVersionDiffs(core, { compute = runDiffWorker, log = console.error } = {}) {
  const catalog = core.versionCatalog;
  const jobs = new Map();
  const queue = [];
  let running = false;
  let closed = false;
  let timer = null;
  let active = null;
  const available = () => !closed && core.db.raw.isOpen;
  function cached(before, after) {
    const row = core.db
      .prepare('SELECT algorithm,diff_json FROM version_diffs WHERE baseline_id=? AND version_id=?')
      .get(before, after);
    return row && Number(row.algorithm) >= DIFF_ALGORITHM
      ? JSON.parse(String(row.diff_json))
      : null;
  }
  const info = (version) => ({ id: version.id, number: version.number, branch: version.branch });
  async function calculate(id, baselineId) {
    const version = catalog.get(id);
    const baseline = catalog.get(baselineId);
    const stored = cached(baselineId, id);
    const controller = new AbortController();
    active = controller;
    const result = await compute(
      {
        before: { file: catalog.file(baselineId), name: baseline.name },
        after: { file: catalog.file(id), name: version.name },
        cached: stored,
      },
      controller.signal,
    );
    if (!available()) throw new AppError('VERSION_DIFF_CLOSED', '版本比较已关闭。');
    if (result.error) log('Version comparison could not parse originals:', result.error);
    if (!stored && result.diff.status !== 'originals-only')
      core.db
        .prepare(
          `INSERT INTO version_diffs (baseline_id,version_id,algorithm,diff_json,created_at) VALUES (?,?,?,?,?)
      ON CONFLICT(baseline_id,version_id) DO UPDATE SET algorithm=excluded.algorithm,diff_json=excluded.diff_json,created_at=excluded.created_at`,
        )
        .run(baselineId, id, DIFF_ALGORITHM, JSON.stringify(result.diff), nowIso());
    return {
      baseline: info(baseline),
      version: info(version),
      format: result.format ?? catalog.group(version.groupId).format,
      old: result.old,
      new: result.new,
      diff: result.diff,
    };
  }
  async function pump() {
    timer = null;
    if (running) return;
    running = true;
    while (queue.length) {
      const job = queue.shift();
      try {
        if (!available()) throw new AppError('VERSION_DIFF_CLOSED', '版本比较已关闭。');
        job.resolve(await calculate(job.id, job.baselineId));
      } catch (error) {
        job.reject(error);
      } finally {
        jobs.delete(job.key);
        active = null;
      }
    }
    running = false;
  }
  function diff(id, baselineId) {
    if (!available())
      return Promise.reject(new AppError('VERSION_DIFF_CLOSED', '版本比较已关闭。'));
    const version = catalog.get(id);
    const baseline = baselineId === undefined ? version.parentId : baselineId;
    if (!baseline) return Promise.resolve({ status: 'first' });
    if (catalog.get(baseline).groupId !== version.groupId)
      throw new AppError('INVALID_BASELINE', '请选择同一版本组的版本进行比较。');
    const key = JSON.stringify([baseline, id]);
    if (jobs.has(key)) return jobs.get(key);
    const promise = new Promise((resolve, reject) =>
      queue.push({ id, baselineId: baseline, key, resolve, reject }),
    );
    jobs.set(key, promise);
    if (!running && timer === null)
      timer = setImmediate(() => {
        pump().catch((error) => log('Version comparison queue failed:', error));
      });
    return promise;
  }
  return {
    diff,
    /** A successful writer calls this after commit, without awaiting calculation. */
    enqueue(versions) {
      for (const version of versions) {
        if (!version.parentId || !available()) continue;
        // Even a scheduling failure must not undo an already committed version.
        try {
          diff(version.id, version.parentId).catch((error) => {
            if (available()) log('Background version comparison failed:', error.message);
          });
        } catch (error) {
          log('Background version comparison failed:', error.message);
        }
      }
    },
    /** Deterministic acceptance hook: wait for work already queued. */
    idle: async () => {
      while (jobs.size) await Promise.allSettled([...jobs.values()]);
    },
    async close() {
      closed = true;
      if (timer) clearImmediate(timer);
      timer = null;
      active?.abort();
      for (const job of queue.splice(0)) {
        jobs.delete(job.key);
        job.reject(new AppError('VERSION_DIFF_CLOSED', '版本比较已关闭。'));
      }
      await Promise.allSettled([...jobs.values()]);
    },
  };
}
