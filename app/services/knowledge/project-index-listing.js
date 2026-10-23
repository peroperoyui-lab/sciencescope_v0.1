// Listing writes only catalog/filename projections. Original bytes belong to the
// background stage; disappeared paths remain available for hash-based moves.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';

const excluded = new Set(['node_modules', '__pycache__', 'renv']);
/** ScienceScope's own workspace in a project's built-in folder: plans, notes,
 * minutes and editing-desk versions are not project files. */
const ownFolders = new Set(['workbench', 'notes', 'minutes', 'versions']);

/**
 * @param {string} root
 * @param {Set<string>} skip Top-level folders to leave out.
 */
async function* walk(root, skip, folder = '') {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
      if (!folder && skip.has(entry.name)) continue;
      yield* walk(root, skip, relative);
    } else if (entry.isFile()) yield relative;
  }
}

/**
 * @param {any} deps
 * @param {any} state
 */
export async function listProjectFiles(
  { core, research, stat, batchSize, current, progress },
  state,
) {
  const previous = new Map(
    research.store
      .listSources({ projectId: state.projectId, includePersonal: false })
      .filter((source) => source.folderPath)
      .map((source) => [source.folderPath, source]),
  );
  // Finish enumeration first. An unavailable root is not an empty project,
  // and moves must be detected independently of directory traversal order.
  const skip = core.projects.get(state.projectId).folder == null ? ownFolders : new Set();
  const paths = [];
  for await (const relative of walk(state.root, skip)) {
    if (!current(state)) return;
    paths.push(relative);
  }
  const present = new Set(paths);
  state.missing = [...previous.values()].filter((source) => !present.has(source.folderPath));
  for (const source of state.missing) {
    if (!source.contentHash) continue;
    const matches = state.missingByHash.get(source.contentHash) ?? [];
    matches.push(source);
    state.missingByHash.set(source.contentHash, matches);
  }
  state.total = paths.length;
  let batch = [];
  function flush() {
    if (!batch.length) return;
    const sources = research.store.queueSources(
      batch.map((job) => ({
        id: job.previous?.id,
        patch: {
          projectId: state.projectId,
          folderPath: job.relative,
          ...(!job.previous
            ? {
                name: path.basename(job.relative),
                title: path.basename(job.relative),
                kind: 'file',
              }
            : {}),
          ...job.stamp,
          contentStatus: job.error ? 'failed' : 'queued',
          parseError: job.error ?? null,
        },
      })),
    );
    batch.forEach((job, i) => {
      job.source = sources[i];
      if (!job.error) state.jobs.push(job);
    });
    batch = [];
    progress(state);
  }
  for (const relative of paths) {
    if (!current(state)) return;
    const source = previous.get(relative);
    const file = path.join(state.root, relative);
    let stamp;
    let error;
    try {
      const info = await stat(file);
      stamp = { fileSize: info.size, fileMtimeMs: info.mtimeMs };
      if (
        source &&
        !['queued', 'failed'].includes(source.contentStatus) &&
        source.fileSize === info.size &&
        source.fileMtimeMs === info.mtimeMs
      ) {
        state.result.unchanged++;
        state.done++;
        if (source.contentStatus === 'name-only') state.result.nameOnly++;
        continue;
      }
    } catch (failure) {
      error = failure.message;
      state.result.failed++;
      state.done++;
    }
    if (!current(state)) return;
    if (source) state.result.updated++;
    else state.result.added++;
    // Restarted queued records already have their filename projection. Retain
    // them directly instead of rewriting the same catalog/FTS rows again.
    if (
      !error &&
      source?.contentStatus === 'queued' &&
      source.fileSize === stamp.fileSize &&
      source.fileMtimeMs === stamp.fileMtimeMs
    ) {
      state.jobs.push({ source, previous: source, relative, file, stamp, created: false });
      continue;
    }
    batch.push({ previous: source ?? null, relative, file, stamp, error, created: !source });
    if (batch.length >= batchSize) {
      flush();
      await yieldLoop();
    }
  }
  if (current(state)) flush();
}
