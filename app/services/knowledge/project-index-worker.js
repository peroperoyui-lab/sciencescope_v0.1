// Each worker publishes a complete copy/parser checkpoint, leaving unfinished
// catalog rows queued so the project scanner can reconstruct work after restart.
import path from 'node:path';
import { stat as fileStat } from 'node:fs/promises';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { snapshotProjectFile } from './project-copies.js';
import { hasSourceEdits } from './project-index-edits.js';

/**
 * @typedef {import('../research/store.js').ResearchSource} ResearchSource
 * @typedef {{fileSize:number,fileMtimeMs:number}} FileStamp
 * @typedef {{source:ResearchSource,previous:ResearchSource|null,file:string,
 * relative:string,stamp:FileStamp,created:boolean}} IndexJob
 * @typedef {{projectId:string,root:string,result:{added:number,updated:number,
 * unchanged:number,nameOnly:number,failed:number,moved:number,deleted:number},
 * missing:ResearchSource[],missingByHash:Map<string,ResearchSource[]>,moved:Set<string>,cancelled:boolean,
 * again:boolean,dirty:boolean}} IndexState
 */

function completed(source) {
  return source && !['queued', 'failed'].includes(source.contentStatus);
}

/**
 * Process one catalog job without deciding when absent files can be removed.
 * Claims of missing identities happen synchronously before either worker yields.
 * @param {{core:import('../../core/index.js').Core,
 * research:ReturnType<typeof import('../research/index.js').createResearch>,
 * copy?:typeof snapshotProjectFile,
 * isCurrent:(state:IndexState,job:IndexJob)=>Promise<boolean>}} dependencies
 * @param {IndexState} state
 * @param {IndexJob} job
 * @returns {Promise<ResearchSource|null>}
 */
export async function processIndexJob(
  { core, research, copy = snapshotProjectFile, isCurrent },
  state,
  job,
) {
  try {
    if (state.cancelled || !(await isCurrent(state, job))) return null;
    const snapshot = await copy(core.paths.library, state.projectId, job.file, job.stamp);
    if (state.cancelled || !(await isCurrent(state, job))) return null;
    const { contentHash, originalPath, fileSize, fileMtimeMs } = snapshot;
    const identity = { contentHash, originalPath, fileSize, fileMtimeMs };
    let source;
    if (completed(job.previous) && job.previous.contentHash === contentHash) {
      source = research.store.updateSource(job.source.id, {
        ...identity,
        contentStatus: job.previous.contentStatus,
        parseError: job.previous.parseError,
      });
      state.result.updated--;
      state.result.unchanged++;
    } else {
      const provisional = !job.source.contentHash && !job.source.originalPath;
      const matches = provisional ? state.missingByHash.get(contentHash) : null;
      let relocated;
      while (matches?.length && !relocated) {
        const candidate = matches.shift();
        if (state.moved.has(candidate.id)) continue;
        let latest;
        try {
          latest = research.store.getSource(candidate.id);
        } catch (error) {
          if (error.code === 'SOURCE_NOT_FOUND') continue;
          throw error;
        }
        if (
          latest.folderPath === candidate.folderPath &&
          latest.contentHash === candidate.contentHash
        )
          relocated = latest;
      }
      if (relocated && hasSourceEdits(core, research.store.getSource(job.source.id))) {
        // Both identities are already meaningful to the user. Keep references
        // where they are. Keep the last published projection and restore its
        // usable status synchronously (root rebinding can leave it queued),
        // so a concurrent reparse of the new
        // identity cannot leave the old one eligible for missing-file deletion.
        state.moved.add(relocated.id);
        const restoredStatus = research.store.chunks(relocated.id).length
          ? relocated.parseError
            ? 'partial'
            : 'parsed'
          : 'name-only';
        research.store.updateSource(
          relocated.id,
          {
            folderPath: null,
            ...(!completed(relocated) ? { contentStatus: restoredStatus } : {}),
            metadata: { originalFileMissing: true, missingFolderPath: relocated.folderPath },
          },
          { actorId: 'system' },
        );
        source = await research.parseProjectSource(
          job.source.id,
          {},
          { ...identity, isCurrent: () => isCurrent(state, job) },
        );
      } else if (relocated) {
        await research.deleteSource(job.source.id, { actorId: 'system', origin: 'system' });
        source = research.store.updateSource(relocated.id, {
          ...identity,
          folderPath: job.relative,
          name: path.basename(job.relative),
          ...(relocated.title === relocated.name ? { title: path.basename(job.relative) } : {}),
          ...(!completed(relocated) ? { contentStatus: 'queued' } : {}),
        });
        state.moved.add(relocated.id);
        if (job.created) state.result.added--;
        else state.result.updated--;
        state.result.moved++;
        if (!completed(relocated)) {
          // A rebound root or interrupted parse may leave the matching identity
          // queued. Keep that identity and finish its projection at the new path.
          job.source = source;
          source = await research.parseProjectSource(
            source.id,
            {},
            {
              ...identity,
              isCurrent: () => isCurrent(state, job),
            },
          );
        }
      } else {
        source = await research.parseProjectSource(
          job.source.id,
          {},
          { ...identity, isCurrent: () => isCurrent(state, job) },
        );
      }
    }
    if (source?.contentStatus === 'name-only') state.result.nameOnly++;
    return source ?? null;
  } catch (error) {
    // A changing/deleted file gets one follow-up listing. Files still changing
    // after that stay queued until the next scan instead of retrying forever.
    if (['INDEX_FILE_CHANGED', 'ENOENT', 'ENOTDIR'].includes(error.code)) {
      state.dirty = true;
      return null;
    }
    if (state.cancelled || !(await isCurrent(state, job))) return null;
    state.result.failed++;
    return research.store.updateSource(job.source.id, {
      contentStatus: 'failed',
      parseError: String(error.message),
    });
  }
}

/**
 * Reconcile missing identities only after every background job has settled.
 * @param {{core:import('../../core/index.js').Core,
 * research:ReturnType<typeof import('../research/index.js').createResearch>,
 * files:ReturnType<typeof import('../project-files.js').createProjectFiles>,
 * current:(state:IndexState)=>boolean}} dependencies
 * @param {IndexState} state
 * @returns {Promise<void>}
 */
export async function removeMissingSources({ core, research, files, current }, state) {
  // A failed read may be the missing file at its new path. Never delete while
  // a scan is cancelled, changed underneath us, or has an unreadable candidate.
  if (current(state) && !state.again && !state.dirty && !state.result.failed) {
    // Check every absent path before deleting any catalog identities: a root
    // moved outside the app or a failed read is not a confirmed empty folder.
    try {
      if (!(await fileStat(state.root)).isDirectory())
        throw new Error('Project folder is unavailable.');
      for (const source of state.missing) {
        if (state.moved.has(source.id)) continue;
        try {
          await fileStat(files.locate(state.projectId, source.folderPath));
          state.dirty = true;
        } catch (error) {
          if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
        }
      }
    } catch (error) {
      state.result.failed++;
      core.events.transient(
        'research.index.failed',
        { error: error.message },
        { projectId: state.projectId },
      );
      return;
    }
    if (state.dirty) return;
    for (const source of state.missing) {
      if (!current(state)) break;
      if (state.moved.has(source.id)) continue;
      let latest;
      try {
        latest = research.store.getSource(source.id);
      } catch (error) {
        if (error.code === 'SOURCE_NOT_FOUND') continue;
        throw error;
      }
      if (latest.folderPath !== source.folderPath || latest.contentHash !== source.contentHash)
        continue;
      await research.deleteSource(source.id, { actorId: 'system', origin: 'system' });
      state.result.deleted++;
      await yieldLoop();
    }
  }
}
