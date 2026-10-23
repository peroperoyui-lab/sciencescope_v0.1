// Listing writes only catalog/filename projections. Original bytes belong to the
// background stage. Unique size/mtime pairs retain identity immediately; ambiguous
// disappeared paths remain available for background hash-based moves.
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';

const excluded = new Set(['node_modules', '__pycache__', 'renv']);
/** ScienceScope's own workspace in a project's built-in folder: plans, notes,
 * minutes and editing-desk versions are not project files. */
const ownFolders = new Set(['workbench', 'notes', 'minutes', 'versions']);

function stampKey(stamp) {
  return stamp?.fileSize == null || stamp.fileMtimeMs == null
    ? null
    : `${stamp.fileSize}:${stamp.fileMtimeMs}`;
}

function groupStamp(groups, value, stamp) {
  const key = stampKey(stamp);
  if (key == null) return;
  const matches = groups.get(key) ?? [];
  matches.push(value);
  groups.set(key, matches);
}

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
  const entries = [];
  const freshByStamp = new Map();
  const missingByStamp = new Map();
  for (const source of state.missing) groupStamp(missingByStamp, source, source);
  // Uniqueness is global: do not claim an old identity before a later new path
  // with the same stamp has been seen. Each present file is stat'ed once.
  for (const relative of paths) {
    if (!current(state)) return;
    const source = previous.get(relative);
    const file = path.join(state.root, relative);
    const entry = { relative, file, source, stamp: null, error: null };
    try {
      const info = await stat(file);
      entry.stamp = { fileSize: info.size, fileMtimeMs: info.mtimeMs };
      if (!source && state.missing.length) groupStamp(freshByStamp, entry, entry.stamp);
    } catch (failure) {
      entry.error = failure.message;
    }
    entries.push(entry);
  }
  let batch = [];
  function flush() {
    if (!batch.length) return;
    const sources = research.store.queueSources(
      batch.map((job) => {
        // Listing yields during stat calls. Recheck the current display name
        // before following a rename so a newly curated title stays intact.
        const latest = job.move ? research.store.getSource(job.previous.id) : job.previous;
        return {
          id: job.previous?.id,
          patch: {
            projectId: state.projectId,
            folderPath: job.relative,
            ...(!job.previous || job.move
              ? {
                  name: path.basename(job.relative),
                  ...(!job.previous || latest.title === latest.name
                    ? { title: path.basename(job.relative) }
                    : {}),
                  ...(!job.previous ? { kind: 'file' } : {}),
                }
              : {}),
            ...job.stamp,
            contentStatus: job.error
              ? 'failed'
              : job.completedMove
                ? job.previous.contentStatus
                : 'queued',
            parseError: job.completedMove ? job.previous.parseError : (job.error ?? null),
          },
        };
      }),
    );
    batch.forEach((job, i) => {
      job.source = sources[i];
      if (job.move) state.moved.add(job.source.id);
      if (job.completedMove) {
        state.done++;
        if (job.source.contentStatus === 'name-only') state.result.nameOnly++;
      } else if (!job.error) state.jobs.push(job);
    });
    batch = [];
    progress(state);
  }
  for (const entry of entries) {
    if (!current(state)) return;
    const { relative, file, stamp, error } = entry;
    let source = entry.source;
    if (!error) {
      if (
        source &&
        !['queued', 'failed'].includes(source.contentStatus) &&
        source.fileSize === stamp.fileSize &&
        source.fileMtimeMs === stamp.fileMtimeMs
      ) {
        state.result.unchanged++;
        state.done++;
        if (source.contentStatus === 'name-only') state.result.nameOnly++;
        continue;
      }
    } else {
      state.result.failed++;
      state.done++;
    }
    if (!current(state)) return;
    let move = false;
    if (!source && !error) {
      const key = stampKey(stamp);
      const fresh = freshByStamp.get(key);
      const missing = missingByStamp.get(key);
      if (fresh?.length === 1 && missing?.length === 1) {
        source = missing[0];
        move = true;
      }
    }
    if (move) state.result.moved++;
    else if (source) state.result.updated++;
    else state.result.added++;
    // Restarted queued records already have their filename projection. Retain
    // them directly instead of rewriting the same catalog/FTS rows again.
    if (
      !error &&
      !move &&
      source?.contentStatus === 'queued' &&
      source.fileSize === stamp.fileSize &&
      source.fileMtimeMs === stamp.fileMtimeMs
    ) {
      state.jobs.push({ source, previous: source, relative, file, stamp, created: false });
      continue;
    }
    batch.push({
      previous: source ?? null,
      relative,
      file,
      stamp,
      error,
      created: !source,
      move,
      completedMove: move && !['queued', 'failed'].includes(source.contentStatus),
    });
    if (batch.length >= batchSize) {
      flush();
      await yieldLoop();
    }
  }
  if (current(state)) flush();
}
