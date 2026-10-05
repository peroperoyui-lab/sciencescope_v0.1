import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { embeddingManifest, verifyEmbeddingFiles } from './model-assets.mjs';

const WORKER_COUNT = 1;
const MAX_BATCH = 8;
const MAX_TOKENS = 512;

function invalid(message, code = 'INVALID_EMBEDDING_INPUT') {
  throw Object.assign(new Error(message), { code });
}

/** Local-only multilingual-e5-small worker. Call warmup explicitly. */
export function createEmbedding({ modelDir, modelId = 'Xenova/multilingual-e5-small', modelVersion, manifest } = {}) {
  const modelPath = path.resolve(modelDir || path.join(process.cwd(), '.sciencescope-local', 'models', 'multilingual-e5-small'));
  let activeManifest = manifest ?? null;
  let state = 'cold';
  let reason = null;
  let warmupPromise = null;
  let closed = false;
  let nextWorker = 0;
  let nextRequestId = 1;
  const workers = [];
  const pending = new Map();

  function settleWorker(info, error) {
    info.failed = error;
    for (const [id, task] of pending) {
      if (task.worker === info) {
        pending.delete(id);
        task.reject(error);
      }
    }
    if (!closed) {
      state = 'failed';
      reason = error?.code || 'worker-failed';
    }
  }

  function ensureWorkers() {
    if (workers.length) return;
    for (let index = 0; index < WORKER_COUNT; index += 1) {
      const worker = new Worker(new URL('./embedding-worker.mjs', import.meta.url), {
        workerData: { modelDir: modelPath, maxTokens: MAX_TOKENS },
      });
      const info = { worker, failed: null };
      worker.on('message', (message) => {
        const task = pending.get(message.id);
        if (!task || task.worker !== info) return;
        pending.delete(message.id);
        if (message.error) task.reject(Object.assign(new Error(message.error.message), { code: message.error.code || 'EMBEDDING_FAILED' }));
        else task.resolve(message.result);
      });
      worker.on('error', (error) => settleWorker(info, error));
      worker.on('exit', (code) => {
        if (!closed && code !== 0) settleWorker(info, Object.assign(new Error(`Embedding worker exited (${code}).`), { code: 'EMBEDDING_WORKER_EXIT' }));
      });
      workers.push(info);
    }
  }

  function dispatch(info, type, texts = []) {
    if (closed) return Promise.reject(Object.assign(new Error('Embedding engine is closed.'), { code: 'EMBEDDING_CLOSED' }));
    if (info.failed) return Promise.reject(info.failed);
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { worker: info, resolve, reject });
      info.worker.postMessage({ id, type, texts });
    });
  }

  async function embedPrefixed(texts, prefix) {
    if (state !== 'ready') throw Object.assign(new Error('Local embedding model is not warmed up.'), { code: state === 'missing' ? 'MODEL_MISSING' : 'EMBEDDING_NOT_READY' });
    if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string')) invalid('Embedding input must be an array of strings.');
    const jobs = [];
    const batches = [];
    for (let offset = 0; offset < texts.length; offset += MAX_BATCH) batches.push(texts.slice(offset, offset + MAX_BATCH));
    for (const batch of batches) {
      const info = workers[nextWorker++ % workers.length];
      jobs.push(dispatch(info, 'embed', batch.map((text) => `${prefix}: ${text}`)));
    }
    const results = await Promise.all(jobs);
    return results.flatMap((result) => result.vectors);
  }

  async function warmup() {
    if (closed) invalid('Embedding engine is closed.', 'EMBEDDING_CLOSED');
    if (state === 'ready') return status();
    if (warmupPromise) return warmupPromise;
    warmupPromise = (async () => {
      state = 'warming'; reason = null;
      const pinned = activeManifest ?? await embeddingManifest();
      activeManifest = pinned;
      if (pinned.modelId !== modelId || !pinned.revision || (modelVersion && pinned.revision !== modelVersion)) invalid('Embedding model manifest does not match the requested model version.', 'MODEL_MANIFEST_INVALID');
      if (!(await verifyEmbeddingFiles(modelPath, pinned))) {
        state = 'missing'; reason = 'model-missing';
        throw Object.assign(new Error('Pinned local embedding model files are missing or have changed.'), { code: 'MODEL_MISSING' });
      }
      ensureWorkers();
      await Promise.all(workers.map((info) => dispatch(info, 'warmup')));
      state = 'ready';
      reason = null;
      return status();
    })().catch((error) => {
      if (state !== 'missing') { state = 'failed'; reason = error?.code || 'warmup-failed'; }
      throw error;
    }).finally(() => { warmupPromise = null; });
    return warmupPromise;
  }

  function status() {
    return { state, ready: state === 'ready', reason, modelId: activeManifest?.modelId || 'Xenova/multilingual-e5-small', modelVersion: activeManifest?.revision || null, dimensions: activeManifest?.dimensions || 384 };
  }

  async function close() {
    if (closed) return;
    closed = true; state = 'closed'; reason = null;
    for (const task of pending.values()) task.reject(Object.assign(new Error('Embedding engine is closed.'), { code: 'EMBEDDING_CLOSED' }));
    pending.clear();
    await Promise.allSettled(workers.map(({ worker }) => worker.terminate()));
    workers.length = 0;
  }

  return {
    modelId: () => activeManifest?.modelId || 'Xenova/multilingual-e5-small',
    modelVersion: () => activeManifest?.revision || null,
    dimensions: () => activeManifest?.dimensions || 384,
    status,
    warmup,
    embedPassages: (texts) => embedPrefixed(texts, 'passage'),
    embedQuery: async (text) => {
      if (typeof text !== 'string') invalid('Embedding query must be a string.');
      return (await embedPrefixed([text], 'query'))[0];
    },
    close,
  };
}

export const createEmbeddingEngine = createEmbedding;
