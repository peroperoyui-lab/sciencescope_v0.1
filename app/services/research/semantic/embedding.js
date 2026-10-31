import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { AppError } from '../../../core/errors.js';
import { embeddingManifest, verifyEmbeddingFiles } from './model-assets.js';

/** One local worker keeps inference off the server thread. Loading never downloads.
 * @param {{modelDir:string,modelId?:string,modelVersion?:string,manifest?:any,workerUrl?:URL}} options
 */
export function createEmbedding({
  modelDir,
  modelId = 'Xenova/multilingual-e5-small',
  modelVersion,
  manifest,
  workerUrl = new URL('./embedding-worker.js', import.meta.url),
}) {
  let pinned = manifest;
  let worker = null;
  let state = 'cold';
  let reason = null;
  let warming = null;
  let requestId = 0;
  const pending = new Map();

  function fail(error) {
    if (state === 'closed') return;
    state = 'failed';
    reason = error.code ?? 'EMBEDDING_FAILED';
    for (const task of pending.values()) task.reject(error);
    pending.clear();
  }

  function dispatch(type, texts = []) {
    if (state === 'closed')
      return Promise.reject(new AppError('EMBEDDING_CLOSED', 'Embedding worker is closed.', 409));
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, texts });
    });
  }

  function startWorker() {
    if (worker) return;
    worker = new Worker(workerUrl, {
      workerData: { modelDir: path.resolve(modelDir), maxTokens: pinned.maxTokens ?? 512 },
    });
    worker.on('message', (message) => {
      const task = pending.get(message.id);
      if (!task) return;
      pending.delete(message.id);
      if (message.error) task.reject(new AppError(message.error.code, message.error.message));
      else task.resolve(message.result);
    });
    worker.on('error', fail);
    worker.on('exit', (code) => {
      if (state !== 'closed')
        fail(new AppError('EMBEDDING_WORKER_EXIT', `Embedding worker exited (${code}).`));
    });
  }

  function status() {
    return {
      state,
      ready: state === 'ready',
      reason,
      modelId: pinned?.modelId ?? modelId,
      modelVersion: pinned?.revision ?? modelVersion,
      dimensions: pinned?.dimensions ?? 384,
    };
  }

  async function warmup() {
    if (state === 'closed')
      throw new AppError('EMBEDDING_CLOSED', 'Embedding worker is closed.', 409);
    if (state === 'ready') return status();
    if (warming) return warming;
    warming = (async () => {
      state = 'warming';
      reason = null;
      pinned ??= await embeddingManifest();
      if (pinned.modelId !== modelId || (modelVersion && pinned.revision !== modelVersion))
        throw new AppError(
          'MODEL_MANIFEST_INVALID',
          'Embedding model version does not match the manifest.',
        );
      if (!(await verifyEmbeddingFiles(modelDir, pinned))) {
        state = 'missing';
        reason = 'model-missing';
        throw new AppError(
          'MODEL_MISSING',
          'Pinned local embedding files are missing or have changed.',
        );
      }
      startWorker();
      await dispatch('warmup');
      state = 'ready';
      return status();
    })()
      .catch((error) => {
        if (state !== 'missing') fail(error);
        throw error;
      })
      .finally(() => {
        warming = null;
      });
    return warming;
  }

  async function embed(texts, prefix) {
    if (state !== 'ready')
      throw new AppError('EMBEDDING_NOT_READY', 'Local embedding model is not ready.', 409);
    const vectors = [];
    const batchSize = pinned.batchSize ?? 8;
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const result = await dispatch(
        'embed',
        texts.slice(offset, offset + batchSize).map((text) => `${prefix}: ${text}`),
      );
      vectors.push(...result.vectors);
    }
    return vectors;
  }

  async function close() {
    if (state === 'closed') return;
    state = 'closed';
    for (const task of pending.values())
      task.reject(new AppError('EMBEDDING_CLOSED', 'Embedding worker is closed.', 409));
    pending.clear();
    await worker?.terminate();
  }

  return {
    warmup,
    close,
    status,
    modelId: () => pinned?.modelId ?? modelId,
    modelVersion: () => pinned?.revision ?? modelVersion,
    embedPassages: (texts) => embed(texts, 'passage'),
    embedQuery: async (text) => (await embed([text], 'query'))[0],
  };
}
