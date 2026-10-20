// One scan per project, with one coalesced follow-up. Catalog rows and immutable
// copies outlive folder moves; parsing/search remain research-service projections.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileHash, copyProjectFile } from './project-copies.js';

const excluded = new Set(['node_modules', '__pycache__', 'renv']);

async function* walk(root, folder = '') {
  for (const entry of await readdir(path.join(root, folder), { withFileTypes: true })) {
    const relative = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && !excluded.has(entry.name)) yield* walk(root, relative);
    } else if (entry.isFile()) yield relative;
  }
}

/**
 * @param {{core:import('../../core/index.js').Core,
 * research:ReturnType<typeof import('../research/index.js').createResearch>,
 * files:ReturnType<typeof import('../project-files.js').createProjectFiles>}} deps
 */
export function createProjectIndex({ core, research, files }) {
  const running = new Map();
  let closed = false;

  async function scanOnce(projectId) {
    const root = files.rootOf(projectId);
    const previous = new Map(
      research.store
        .listSources({ projectId, includePersonal: false })
        .filter((source) => source.folderPath)
        .map((source) => [source.folderPath, source]),
    );
    const result = { added: 0, updated: 0, unchanged: 0, nameOnly: 0, failed: 0 };
    for await (const relative of walk(root)) {
      if (closed) break;
      let source = previous.get(relative);
      const file = path.join(root, relative);
      try {
        const current = await stat(file);
        const stamp = { fileSize: current.size, fileMtimeMs: current.mtimeMs };
        if (
          source &&
          !['queued', 'failed'].includes(source.contentStatus) &&
          source.fileSize === current.size &&
          source.fileMtimeMs === current.mtimeMs
        ) {
          result.unchanged++;
        } else {
          const hash = await fileHash(file);
          if (
            source?.contentHash === hash &&
            !['queued', 'failed'].includes(source.contentStatus)
          ) {
            source = research.store.updateSource(source.id, stamp);
            result.unchanged++;
          } else {
            const originalPath = await copyProjectFile(core.paths.library, projectId, file, hash);
            const patch = {
              ...stamp,
              contentHash: hash,
              originalPath,
              contentStatus: 'queued',
              parseError: null,
            };
            if (source) {
              source = research.store.updateSource(source.id, patch);
              result.updated++;
            } else {
              source = research.store.createSource({
                projectId,
                folderPath: relative,
                title: path.basename(relative),
                name: path.basename(relative),
                kind: 'file',
                ...patch,
              });
              result.added++;
            }
            source = await research.parseProjectSource(source.id);
          }
        }
        if (source.contentStatus === 'name-only') result.nameOnly++;
      } catch (error) {
        result.failed++;
        const patch = { contentStatus: 'failed', parseError: error.message };
        if (source) research.store.updateSource(source.id, patch);
        else
          research.store.createSource({
            projectId,
            folderPath: relative,
            title: path.basename(relative),
            name: path.basename(relative),
            kind: 'file',
            ...patch,
          });
      }
    }
    return result;
  }

  /**
   * Every caller waits for the coalesced follow-up as well.
   * @param {string} projectId
   * @returns {Promise<{added:number,updated:number,unchanged:number,nameOnly:number,failed:number}>}
   */
  function scan(projectId) {
    if (closed) return Promise.reject(new Error('Project index is closed.'));
    const existing = running.get(projectId);
    if (existing) {
      existing.again = true;
      return existing.promise;
    }
    const state = { again: false, promise: null };
    state.promise = (async () => {
      let result;
      do {
        state.again = false;
        result = await scanOnce(projectId);
      } while (state.again && !closed);
      return result;
    })().finally(() => running.delete(projectId));
    running.set(projectId, state);
    return state.promise;
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
    const status =
      {
        parsed: 'parsed',
        partial: 'parsed',
        queued: 'parsing',
        'name-only': 'name-only',
        failed: 'failed',
      }[String(row?.content_status)] ?? 'unindexed';
    return {
      status,
      sourceId: row ? String(row.id) : null,
      error: row?.parse_error == null ? null : String(row.parse_error),
    };
  }

  return {
    scan,
    request,
    entry,
    async close() {
      closed = true;
      await Promise.allSettled([...running.values()].map((state) => state.promise));
    },
  };
}
