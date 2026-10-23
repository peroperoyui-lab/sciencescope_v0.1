import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { AppError } from '../../core/errors.js';
import { renameWithRetry } from '../../core/rename.js';
import { validateTarget, reserveFolder } from './paths.js';

/** @typedef {{phase:string,done:number,total:number,bytes:number,folder:string,error?:string}} ExportStatus */

/**
 * Full exports are ephemeral host jobs. Only completed folders lose the marker;
 * cancellation and application shutdown leave all partial bytes identifiable.
 * @param {import('../../core/index.js').Core} core
 */
export function createFullExport(core) {
  const jobs = new Map();
  let active = null;
  let starting = null;
  let closed = false;

  function status(job) {
    return { ...job.status };
  }
  function publish(job) {
    const emit = () => {
      job.timer = null;
      job.lastProgress = performance.now();
      core.events.transient('export.progress', { jobId: job.id, ...status(job) });
    };
    const delay = Math.max(0, 1000 - (performance.now() - job.lastProgress));
    if (!delay) {
      clearTimeout(job.timer);
      emit();
    } else if (!job.timer) job.timer = setTimeout(emit, Math.ceil(delay));
  }
  function jobOf(id) {
    const job = jobs.get(id);
    if (!job) throw new AppError('EXPORT_NOT_FOUND', '找不到这个导出任务。', 404);
    return job;
  }
  async function execute(job, input) {
    /** @type {any} */
    let result = null;
    /** @type {any} */
    let failure = null;
    /** @type {Error|null} */
    let workerError = null;
    const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: input });
    job.worker = worker;
    await new Promise((resolve) => {
      worker.on('message', (message) => {
        if (message.type === 'progress') {
          Object.assign(job.status, message.value);
          publish(job);
        } else if (message.type === 'result') result = message.value;
        else if (message.type === 'failure') failure = message.value;
      });
      worker.once('error', (error) => {
        workerError = error;
      });
      worker.once('exit', () => resolve(undefined));
    });
    job.worker = null;
    try {
      const cancelled = Number(Atomics.load(job.flag, 0)) !== 0 || failure?.cancelled;
      if (cancelled) job.status.phase = 'cancelled';
      else if (workerError || failure || !result) {
        job.status.phase = 'failed';
        job.status.error = workerError?.message ?? failure?.error ?? '导出未完成，请重试。';
      } else {
        await renameWithRetry(job.status.folder, job.completed);
        job.status.folder = job.completed;
        job.status.phase = 'finished';
        job.status.bytes = result.bytes;
        job.status.done = result.files;
        job.status.total = result.files;
      }
    } catch (error) {
      job.status.phase = 'failed';
      job.status.error = error.message;
    } finally {
      publish(job);
      core.events.transient('export.finished', {
        jobId: job.id,
        folder: job.status.folder,
        files: result?.files ?? job.status.done,
        bytes: result?.bytes ?? job.status.bytes,
        skipped: result?.skipped ?? [],
        cancelled: job.status.phase === 'cancelled',
        ...(job.status.error ? { error: job.status.error } : {}),
      });
      if (active === job) active = null;
    }
  }

  /** @param {{target:string,includeProjectCopies?:boolean}} input */
  async function start({ target, includeProjectCopies = false }) {
    if (closed) throw new AppError('EXPORT_CLOSED', '导出服务已关闭。', 409);
    if (active) return { jobId: active.id, folder: active.status.folder };
    if (starting) return starting;
    starting = (async () => {
      const destination = await validateTarget(target, core.paths.root);
      const createdAt = new Date();
      let reserved;
      try {
        reserved = await reserveFolder(destination, createdAt);
      } catch (error) {
        throw new AppError('EXPORT_TARGET_INVALID', `无法写入导出位置：${error.message}`, 400);
      }
      if (closed) throw new AppError('EXPORT_CLOSED', '导出服务已关闭。', 409);
      const job = {
        id: `export_${randomUUID()}`,
        completed: reserved.completed,
        status: { phase: 'snapshot', done: 0, total: 0, bytes: 0, folder: reserved.folder },
        flag: new Int32Array(new SharedArrayBuffer(4)),
        timer: null,
        lastProgress: -Infinity,
        worker: null,
        promise: null,
      };
      jobs.set(job.id, job);
      active = job;
      publish(job);
      const pkg = await readFile(new URL('../../../package.json', import.meta.url), 'utf8')
        .then(JSON.parse)
        .catch(() => ({ version: 'unknown' }));
      job.promise = execute(job, {
        paths: core.paths,
        folder: reserved.folder,
        includeProjectCopies,
        createdAt: `${createdAt.toLocaleString('sv-SE', { hour12: false })}（本地时间）`,
        appVersion: pkg.version,
        cancelFlag: job.flag.buffer,
      });
      return { jobId: job.id, folder: job.status.folder };
    })();
    try {
      return await starting;
    } finally {
      starting = null;
    }
  }

  return {
    start,
    /** @param {string} id @returns {ExportStatus} */
    get(id) {
      return status(jobOf(id));
    },
    /** @param {string} id @returns {ExportStatus} */
    cancel(id) {
      const job = jobOf(id);
      if (active === job) {
        Atomics.store(job.flag, 0, 1);
        job.worker?.postMessage('cancel');
      }
      return status(job);
    },
    async close() {
      closed = true;
      await starting?.catch(() => {});
      if (active) {
        Atomics.store(active.flag, 0, 1);
        active.worker?.postMessage('cancel');
        await active.promise;
      }
      for (const job of jobs.values()) clearTimeout(job.timer);
    },
  };
}
