// Ingest pipeline: library resource → source record → parser → passages →
// index. Runs one file at a time in the background; status is visible on the
// source (content_status / parse_error). Originals are never modified.
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { parserFor, ParserUnsupported } from './parsers/index.mjs';

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const TARGET_CHARS = 1200;
const MAX_CHARS = 2400;

/**
 * Merge parser blocks into retrieval passages: consecutive blocks of one page
 * and section are joined up to ~TARGET_CHARS; headings travel with the text
 * they introduce; equations and tables stay whole (split only if huge).
 */
export function chunkBlocks(blocks) {
  const chunks = []; let current = null; let heading = null; let offset = 0;
  const push = () => { if (current?.text.trim()) chunks.push(current); current = null; };
  for (const block of blocks) {
    const text = String(block.text ?? '').trim(); if (!text) continue;
    const start = offset; offset += text.length + 2;
    if (block.kind === 'heading') { push(); heading = { text, block, start }; continue; }
    const standalone = ['equation', 'table', 'code'].includes(block.kind);
    const sameSpan = current && current.page === block.page && current.section === block.section;
    if (current && !standalone && current.kind === 'paragraph' && sameSpan && current.text.length + text.length <= TARGET_CHARS) {
      current.text += `\n\n${text}`; current.charEnd = start + text.length; continue;
    }
    push();
    for (let i = 0; i < text.length; i += MAX_CHARS) {
      const part = text.slice(i, i + MAX_CHARS);
      const lead = i === 0 && heading ? `${heading.text}\n` : '';
      current = { kind: block.kind ?? 'paragraph', text: lead + part, page: block.page, section: block.section, charStart: lead ? heading.start : start + i, charEnd: start + i + part.length, anchor: anchorOf(block, part) };
      if (standalone || i + MAX_CHARS < text.length) push();
    }
    heading = null;
  }
  push();
  if (heading) chunks.push({ kind: 'paragraph', text: heading.text, page: heading.block.page, section: heading.block.section, charStart: heading.start, charEnd: heading.start + heading.text.length, anchor: anchorOf(heading.block, heading.text) });
  return chunks;
}
const anchorOf = (block, text) => ({ ...(block.anchor ?? {}), ...(block.page ? { page: block.page } : {}), quote: block.anchor?.quote ?? { exact: text.slice(0, 160) } });

export function createIngestor({ store, database, resolveResourcePath, onProgress = () => {} }) {
  let tail = Promise.resolve();

  /** The source record for a library resource, created on first use. */
  async function ensureSource(resourceId) {
    const existing = store.sourceByResource(resourceId);
    if (existing) return existing;
    const resource = await database.getResource(resourceId);
    if (!resource) throw Object.assign(new Error('资料不存在。'), { status: 404, code: 'RESOURCE_NOT_FOUND' });
    return store.addSource({ projectId: resource.projectId ?? null, kind: 'file', title: resource.title, resourceId });
  }

  async function ingestNow(sourceId) {
    const source = store.getSource(sourceId);
    if (!source?.resourceId) throw Object.assign(new Error('此来源没有原件可解析。'), { status: 409, code: 'NO_ORIGINAL' });
    const resource = await database.getResource(source.resourceId);
    const parser = parserFor(resource?.title ?? '');
    if (!parser) { store.markContent(source.id, 'unsupported', { parseError: `尚不支持解析 ${path.extname(resource?.title ?? '') || '此格式'}。` }); return store.getSource(source.id); }
    try {
      const file = await realpath(await resolveResourcePath(resource));
      if ((await stat(file)).size > MAX_FILE_BYTES) throw new ParserUnsupported('文件超过 100 MB，未解析。');
      const result = await parser.parse(await readFile(file), { name: resource.title });
      const chunks = chunkBlocks(result.blocks ?? []);
      store.replaceChunks(source.id, chunks, { parser: parser.id, pages: result.pages ?? null, contentStatus: chunks.length ? (result.warnings?.length ? 'partial' : 'parsed') : 'failed', parseError: chunks.length ? (result.warnings ?? []).join('; ').slice(0, 1000) || null : '未提取到文字（可能是扫描件或空文件）。' });
      // Fill bibliographic fields the parser found, never overwriting the user's.
      const meta = result.metadata ?? {}; const patch = {};
      if (meta.title && source.title === resource.title) patch.title = meta.title.slice(0, 1000);
      for (const key of ['authors', 'year', 'doi', 'arxivId', 'abstract', 'venue', 'language']) if (meta[key] != null && (source[key] == null || (Array.isArray(source[key]) && !source[key].length))) patch[key] = meta[key];
      if (Object.keys(patch).length) store.updateSource(source.id, patch);
    } catch (error) {
      const unsupported = error instanceof ParserUnsupported || error?.code === 'PARSER_UNSUPPORTED';
      store.markContent(source.id, unsupported ? 'unsupported' : 'failed', { parser: parser.id, parseError: String(error?.message ?? error).slice(0, 1000) });
    }
    const done = store.getSource(source.id);
    onProgress(done);
    return done;
  }

  /** Queue a source; resolves when it has been processed. */
  function enqueue(sourceId) {
    store.markContent(sourceId, 'queued');
    const job = tail.then(() => ingestNow(sourceId));
    tail = job.catch(() => {});
    return job;
  }

  /** Register and queue every library resource of a project (or the personal library). */
  async function syncResources({ projectId = null } = {}) {
    const resources = await database.listResources({ projectId, limit: 1000 });
    const queued = [];
    for (const resource of resources) {
      const source = await ensureSource(resource.id);
      if (source.contentStatus === 'none') queued.push(enqueue(source.id));
    }
    return { total: resources.length, queued: queued.length, done: Promise.all(queued) };
  }

  return { ensureSource, ingestNow, enqueue, syncResources, idle: () => tail };
}
