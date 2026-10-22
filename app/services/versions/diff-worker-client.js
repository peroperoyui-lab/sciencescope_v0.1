import { Worker } from 'node:worker_threads';
import { AppError } from '../../core/errors.js';

/**
 * @param {any} input
 * @param {AbortSignal} signal
 * @returns {Promise<any>}
 */
export function runDiffWorker(input, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AppError('VERSION_DIFF_CLOSED', '版本比较已关闭。'));
    const worker = new Worker(new URL('./diff-worker.js', import.meta.url), { workerData: input });
    let result;
    let failure;
    const abort = () => {
      worker.terminate().catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.once('message', (value) => {
      result = value;
    });
    worker.once('error', (error) => {
      failure = error;
    });
    worker.once('exit', () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new AppError('VERSION_DIFF_CLOSED', '版本比较已关闭。'));
      else if (failure) reject(failure);
      else if (result) resolve(result);
      else reject(new AppError('VERSION_DIFF_FAILED', '版本比较未完成，请重试。'));
    });
  });
}
