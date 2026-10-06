// Original bytes are durable; parsed passages and keyword indexes are derived.
// This service owns imports. Storage/retrieval are usable without the parser.
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createResearchStore } from './store.js';
import { createResearchSearch } from './search.js';
import { parseDocument } from './parsers/index.js';
import { chunkBlocks } from './chunks.js';

/** @param {import('../../core/index.js').Core} core */
export function createResearch(core) {
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
    let parsed;
    try {
      parsed = await parseDocument(input.bytes, { name });
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
        metadata: { ...parsed.metadata, ...input.metadata },
        contentStatus: !chunks.length ? 'failed' : parsed.warnings?.length ? 'partial' : 'parsed',
        parseError: chunks.length
          ? parsed.warnings?.join('; ') || null
          : '未提取到文字（可能是扫描件或空文件）。',
      },
      actor,
    );
  }

  return { store, importSource, ...search };
}
