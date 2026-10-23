// Original bytes are durable; parsed passages and keyword indexes are derived.
// This service owns imports. Storage/retrieval are usable without the parser.
import { mkdir, writeFile, unlink, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createResearchStore } from './store.js';
import { createResearchSearch } from './search.js';
import { parseDocument, parserFor } from './parsers/index.js';
import { chunkBlocks } from './chunks.js';
import { openPath } from '../system.js';
import { createProjectFiles } from '../project-files.js';
import { createSourceRemoval } from '../knowledge/source-removal.js';
import { createExpansionSearch } from '../knowledge/expansion.js';

/** @param {import('../../core/index.js').Core} core @param {{semantic?:any,open?:typeof openPath,recycle?:typeof import('../system.js').recyclePath,expansion?:Parameters<typeof createExpansionSearch>[2]}} [options] */
export function createResearch(core, options = {}) {
  const store = createResearchStore({ db: core.db, events: core.events });
  const search = createResearchSearch(store);
  const projectFiles = createProjectFiles(core);

  /**
   * Resolve original bytes independently of the parser projection. Project files
   * remain the first choice; the catalog's durable copy survives a moved folder.
   * @param {string} id
   * @returns {Promise<string>}
   */
  async function sourcePath(id) {
    const source = store.getSource(id);
    if (source.projectId && source.folderPath) {
      const file = projectFiles.locate(source.projectId, source.folderPath);
      try {
        if ((await stat(file)).isFile()) return file;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      }
    }
    return path.join(core.paths.library, source.originalPath);
  }

  /**
   * Project copies use a hash filename, so parsing uses the catalog display name.
   * Unsupported/empty/broken documents still have searchable file identity.
   * @param {string} id
   * @param {{actorId?:string,meetingId?:string}} [actor]
   * @param {{originalPath:string,contentHash:string,fileSize:number,fileMtimeMs:number,isCurrent?:()=>Promise<boolean>}} [snapshot]
   */
  async function parseProjectSource(id, actor = {}, snapshot) {
    const source = store.getSource(id);
    const save = async (chunks, parsed) => {
      if (snapshot?.isCurrent && !(await snapshot.isCurrent())) return null;
      return core.db.transaction(() => {
        if (snapshot) {
          const { originalPath, contentHash, fileSize, fileMtimeMs } = snapshot;
          store.updateSource(id, { originalPath, contentHash, fileSize, fileMtimeMs }, actor);
        }
        // Publish the immutable-copy identity and its parsed projection together.
        return store.addChunks(id, chunks, parsed, actor);
      });
    };
    const size = snapshot?.fileSize ?? source.fileSize;
    let reason;
    if (size > 200 * 1024 * 1024)
      reason = `File is ${size} bytes; content parsing is limited to 200 MB.`;
    else if (!parserFor(source.name)) reason = `Unsupported document format: ${source.name}`;
    if (reason) return save([], { contentStatus: 'name-only', parseError: reason });
    const file = snapshot
      ? path.join(core.paths.library, snapshot.originalPath)
      : await sourcePath(id);
    return parseSource(source, await readFile(file), actor, source.metadata, (chunks, parsed) =>
      save(chunks, {
        ...parsed,
        contentStatus: ['failed', 'unsupported'].includes(parsed.contentStatus)
          ? 'name-only'
          : parsed.contentStatus,
      }),
    );
  }

  /**
   * @param {{name:string,bytes:Uint8Array,projectId?:string|null,title?:string,kind?:string,metadata?:any,mime?:string}} input
   * @param {{actorId?:string,meetingId?:string}} [actor]
   */
  async function importSource(input, actor = {}) {
    if (input.projectId) core.projects.get(input.projectId);
    const name = path.basename(input.name.replaceAll('\\', '/'));
    const originalPath = path.join('originals', `${randomUUID()}${path.extname(name)}`);
    const originalFile = path.join(core.paths.library, originalPath);
    await mkdir(path.dirname(originalFile), { recursive: true });
    await writeFile(originalFile, input.bytes);
    let source;
    try {
      source = store.createSource(
        { ...input, name, originalPath, title: input.title ?? name, contentStatus: 'queued' },
        actor,
      );
    } catch (error) {
      await unlink(originalFile);
      throw error;
    }
    return parseSource(source, input.bytes, actor, input.metadata);
  }

  /**
   * @param {any} source
   * @param {Uint8Array} bytes
   * @param {any} actor
   * @param {any} [metadata]
   * @param {(chunks:any[],parsed:any)=>any} [save]
   */
  async function parseSource(
    source,
    bytes,
    actor,
    metadata = source.metadata,
    save = (chunks, parsed) => store.addChunks(source.id, chunks, parsed, actor),
  ) {
    let parsed;
    try {
      parsed = await parseDocument(bytes, { name: source.name });
    } catch (error) {
      return save([], {
        contentStatus: error.code === 'PARSER_UNSUPPORTED' ? 'unsupported' : 'failed',
        parseError: String(error.message),
      });
    }
    const chunks = chunkBlocks(parsed.blocks);
    // A fresh untyped file with a reference list or a DOI is a paper, so it gets
    // similarity edges and a paper card; a kind the user chose is kept.
    const paper =
      source.kind === 'file' &&
      source.contentStatus === 'queued' &&
      (Boolean(parsed.metadata?.doi) || chunks.some((chunk) => chunk.kind === 'reference'));
    return save(chunks, {
      ...(paper ? { kind: 'paper' } : {}),
      parser: parsed.parser,
      pages: parsed.pages ?? null,
      metadata: { ...parsed.metadata, ...metadata },
      contentStatus: !chunks.length ? 'failed' : parsed.warnings?.length ? 'partial' : 'parsed',
      parseError: chunks.length
        ? parsed.warnings?.join('; ') || null
        : '未提取到文字（可能是扫描件或空文件）。',
    });
  }

  /** @param {string} id @param {{actorId?:string,meetingId?:string}} [actor] */
  async function reparseSource(id, actor = {}) {
    const source = store.getSource(id);
    if (source.folderPath) return parseProjectSource(id, actor);
    const bytes = await readFile(await sourcePath(id));
    return parseSource(source, bytes, actor);
  }

  /** @param {string} id */
  async function openSource(id) {
    await (options.open ?? openPath)(await sourcePath(id));
    return { opened: true };
  }

  return {
    store,
    deleteSource: createSourceRemoval(core, store, { recycle: options.recycle }),
    importSource,
    reparseSource,
    parseProjectSource,
    sourcePath,
    openSource,
    read: search.read,
    search: createExpansionSearch(
      core,
      (query, input = {}) =>
        options.semantic
          ? options.semantic.search(query, input, search.search)
          : { ...search.search(query, input), mode: 'keyword' },
      options.expansion,
    ),
  };
}
