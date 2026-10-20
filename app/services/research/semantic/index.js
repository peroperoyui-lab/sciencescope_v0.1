// One opt-in local projection shared by GUI and tools. Cold models never hold up
// searches, and a failed vector phase falls back for the entire search request.
import path from 'node:path';
import { AppError } from '../../../core/errors.js';
import { createEmbedding } from './embedding.js';
import { createSemanticDocuments } from './documents.js';
import {
  embeddingManifest,
  embeddingHardware,
  verifyEmbeddingFiles,
  downloadEmbeddingFiles,
} from './model-assets.js';
import { createVectorStore } from './vector-store.js';
import { createHybridSearch } from './search.js';

/**
 * @param {import('../../../core/index.js').Core} core
 * @param {{embed?:any,manifest?:any,hardware?:(directory:string)=>Promise<any>,verifyFiles?:typeof verifyEmbeddingFiles,downloadFiles?:typeof downloadEmbeddingFiles,timeoutMs?:number}} [options]
 */
export function createSemantic(core, options = {}) {
  const projection = createSemanticDocuments(core);
  const modelDir = path.join(core.paths.models, 'multilingual-e5-small');
  let manifest = options.manifest ?? null;
  let enabled = false;
  let closed = false;
  let engine = options.embed ?? null;
  let vector = null;
  let initialization = null;
  let indexing = null;
  let downloading = null;
  let downloadActive = false;
  let controller = null;
  let timer = null;
  let dirty = false;
  let unsubscribe = null;
  let settingsVersion = 0;
  let lastDownloadEvent = 0;
  let progress = {
    state: 'disabled',
    indexed: 0,
    total: 0,
    error: null,
    hardware: null,
    download: null,
  };

  function status() {
    return {
      ...progress,
      enabled,
      model: manifest?.modelId ?? 'Xenova/multilingual-e5-small',
      version: manifest?.revision ?? null,
      modelDir,
    };
  }

  function update(changes) {
    if (closed) return;
    progress = { ...progress, ...changes };
    core.events.transient('research.semantic.changed', status());
  }

  function fail(error) {
    update({ state: 'error', error: String(error?.message ?? error) });
  }

  function busy() {
    return core.turns.running().length > 0;
  }

  function schedule() {
    if (closed || timer || !enabled || !vector || indexing || !dirty) return;
    if (busy()) {
      update({ state: 'paused' });
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, 20);
    timer.unref?.();
  }

  function rebuild() {
    dirty = true;
    schedule();
    return status();
  }

  async function drain() {
    if (closed || indexing || !enabled || !vector || !dirty) return;
    if (busy()) {
      update({ state: 'paused' });
      return;
    }
    dirty = false;
    indexing = (async () => {
      const documents = projection.documents();
      update({ state: 'indexing', total: documents.length, indexed: 0, error: null });
      for (let offset = 0; offset < documents.length; offset += 8) {
        if (closed || !enabled || downloadActive) return;
        if (busy()) {
          dirty = true;
          update({ state: 'paused' });
          return;
        }
        await vector.upsertDocuments(documents.slice(offset, offset + 8));
        update({ indexed: Math.min(offset + 8, documents.length) });
        // Yield between batches so dialogue requests can pause the next batch.
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (closed || !enabled || downloadActive) return;
      await vector.removeMissing(documents.map((document) => document.ref));
      update({ state: 'ready' });
    })()
      .catch(fail)
      .finally(() => {
        indexing = null;
        schedule();
      });
    return indexing;
  }

  async function initialize() {
    if (closed || downloadActive || initialization) return initialization;
    initialization = (async () => {
      manifest ??= await embeddingManifest();
      const hardware =
        progress.hardware ??
        (await (options.hardware ?? embeddingHardware)(path.join(modelDir, '.hardware')));
      if (downloadActive) return;
      update({ hardware });
      if (closed || !enabled) {
        update({ state: 'disabled' });
        return;
      }
      if (!hardware.supported) {
        update({ state: 'unsupported' });
        return;
      }
      if (
        !options.embed &&
        !(await (options.verifyFiles ?? verifyEmbeddingFiles)(modelDir, manifest))
      ) {
        if (downloadActive) return;
        update({ state: 'model-missing' });
        return;
      }
      if (closed || !enabled || downloadActive) return;
      if (!vector) {
        update({ state: 'warming', error: null });
        engine ??= createEmbedding({
          modelDir,
          modelId: manifest.modelId,
          modelVersion: manifest.revision,
          manifest,
        });
        await engine.warmup?.();
        if (closed || !enabled || downloadActive) return;
        vector = await createVectorStore({
          db: core.db,
          embedding: engine,
          modelId: manifest.modelId,
          modelVersion: manifest.revision,
          dimensions: manifest.dimensions,
          onRebuild: rebuild,
        });
      }
      rebuild();
    })()
      .catch(fail)
      .finally(() => {
        initialization = null;
      });
    return initialization;
  }

  async function refreshSettings() {
    const version = ++settingsVersion;
    const settings = await core.workspace.read({ resource: 'settings', key: 'app' });
    if (closed || version !== settingsVersion) return;
    enabled = Boolean(settings.value.semantic?.enabled);
    if (!enabled) {
      controller?.abort();
      update({ state: 'disabled' });
      return;
    }
    void initialize();
  }

  async function start() {
    if (closed) throw new AppError('SEMANTIC_CLOSED', 'Semantic service is closed.', 409);
    if (!unsubscribe) {
      unsubscribe = core.events.subscribe((event) => {
        if (event.type === 'research.changed') rebuild();
        if (event.type === 'resource.changed' && event.payload.resource === 'settings')
          void refreshSettings().catch(fail);
        if (event.type === 'turn.started' && enabled && dirty) update({ state: 'paused' });
        if (event.type === 'turn.ended') schedule();
      });
    }
    await refreshSettings();
    if (!manifest) void initialize();
    return status();
  }

  /** Download begins only through this explicit action; progress is event-driven. */
  async function download() {
    if (closed) throw new AppError('SEMANTIC_CLOSED', 'Semantic service is closed.', 409);
    if (downloadActive) return status();
    downloadActive = true;
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { semantic: { enabled: true } } },
    });
    enabled = true;
    manifest ??= await embeddingManifest();
    await initialization;
    const hardware =
      progress.hardware ??
      (await (options.hardware ?? embeddingHardware)(path.join(modelDir, '.hardware')));
    update({ hardware });
    if (!hardware.supported) {
      downloadActive = false;
      update({ state: 'unsupported' });
      return status();
    }
    controller = new AbortController();
    const current = controller;
    const sourceSettings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value
      .semantic;
    update({ state: 'downloading', error: null, download: null });
    downloading = (async () => {
      await (options.downloadFiles ?? downloadEmbeddingFiles)(modelDir, manifest, {
        signal: current.signal,
        downloadSource: sourceSettings.downloadSource,
        customDownloadUrl: sourceSettings.customDownloadUrl,
        onProgress: (value) => {
          progress = { ...progress, download: value };
          const now = Date.now();
          if (value.done || now - lastDownloadEvent >= 150) {
            lastDownloadEvent = now;
            update({ download: value });
          }
        },
      });
      downloadActive = false;
      if (!closed && enabled) await initialize();
    })()
      .catch((error) => {
        if (!current.signal.aborted) fail(error);
      })
      .finally(() => {
        downloadActive = false;
        controller = null;
        downloading = null;
      });
    return status();
  }

  /** @param {'enable'|'disable'|'download'|'rebuild'} action */
  async function configure(action) {
    if (closed) throw new AppError('SEMANTIC_CLOSED', 'Semantic service is closed.', 409);
    if (action === 'download') return download();
    if (action === 'rebuild') {
      if (!vector) await initialize();
      return rebuild();
    }
    if (!['enable', 'disable'].includes(action))
      throw new AppError('INVALID_SEMANTIC_ACTION', 'Unknown semantic action.');
    const nextEnabled = action === 'enable';
    settingsVersion++;
    enabled = nextEnabled;
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { semantic: { enabled } } },
    });
    enabled = nextEnabled;
    if (enabled) void initialize();
    else {
      controller?.abort();
      update({ state: 'disabled' });
    }
    return status();
  }

  const search = createHybridSearch({
    projection,
    isEnabled: () => enabled,
    state: () => progress.state,
    getVector: () => vector,
    rebuild,
    timeoutMs: options.timeoutMs,
  });
  async function idle() {
    await downloading;
    await initialization;
    clearTimeout(timer);
    timer = null;
    await indexing;
    if (dirty && enabled && vector && !busy()) await drain();
  }

  async function close() {
    closed = true;
    unsubscribe?.();
    clearTimeout(timer);
    controller?.abort();
    await downloading;
    await initialization;
    await indexing;
    await vector?.close();
    await engine?.close?.();
  }

  async function sourceNeighbors(ids, neighborOptions = {}) {
    if (!enabled || progress.state !== 'ready' || !vector) return null;
    return vector.sourceNeighbors(ids, { ...neighborOptions, pause: busy });
  }

  return { start, status, configure, download, rebuild, search, sourceNeighbors, idle, close };
}
