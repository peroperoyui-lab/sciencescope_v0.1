// Original bytes are durable; parsed passages and keyword indexes are derived.
// This service owns imports. Storage/retrieval are usable without the parser.
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createResearchStore } from './store.js';
import { createResearchSearch } from './search.js';
import { parseDocument } from './parsers/index.js';
import { chunkBlocks } from './chunks.js';
import { openPath } from '../system.js';

/** @param {import('../../core/index.js').Core} core @param {{semantic?:any,open?:typeof openPath}} [options] */
export function createResearch(core, options = {}) {
  const store = createResearchStore({ db: core.db, events: core.events });
  const search = createResearchSearch(store);

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

  async function parseSource(source, bytes, actor, metadata = source.metadata) {
    let parsed;
    try {
      parsed = await parseDocument(bytes, { name: source.name });
    } catch (error) {
      return store.addChunks(
        source.id,
        [],
        {
          contentStatus: error.code === 'PARSER_UNSUPPORTED' ? 'unsupported' : 'failed',
          parseError: String(error.message),
        },
        actor,
      );
    }
    const chunks = chunkBlocks(parsed.blocks);
    return store.addChunks(
      source.id,
      chunks,
      {
        parser: parsed.parser,
        pages: parsed.pages ?? null,
        metadata: { ...parsed.metadata, ...metadata },
        contentStatus: !chunks.length ? 'failed' : parsed.warnings?.length ? 'partial' : 'parsed',
        parseError: chunks.length
          ? parsed.warnings?.join('; ') || null
          : '未提取到文字（可能是扫描件或空文件）。',
      },
      actor,
    );
  }

  /** @param {string} id @param {{actorId?:string,meetingId?:string}} [actor] */
  async function reparseSource(id, actor = {}) {
    const source = store.getSource(id);
    const bytes = await readFile(path.join(core.paths.library, source.originalPath));
    return parseSource(source, bytes, actor);
  }

  /** @param {string} id */
  async function openSource(id) {
    const source = store.getSource(id);
    await (options.open ?? openPath)(path.join(core.paths.library, source.originalPath));
    return { opened: true };
  }

  return {
    store,
    importSource,
    reparseSource,
    openSource,
    read: search.read,
    search: (query, input = {}) =>
      options.semantic
        ? options.semantic.search(query, input, search.search)
        : { ...search.search(query, input), mode: 'keyword' },
  };
}
