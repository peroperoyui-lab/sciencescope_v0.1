import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { parserFor, decodeText } from './research-base/parsers/index.mjs';
import { convertDocx } from './research-base/parsers/docx.mjs';

const TEXT = new Set(['txt','log','json','js','mjs','cjs','ts','tsx','jsx','py','r','sql','yaml','yml','toml','xml','html','css','sh','ps1','c','cpp','h','java','rs']);
const error = (code, message, status = 400) => Object.assign(new Error(message), {code,status});
const formatOf = kind => ['pdf','docx','csv'].includes(kind) ? kind
  : ['md','markdown','qmd','rmd'].includes(kind) ? 'markdown'
    : ['tex','ltx'].includes(kind) ? 'latex' : TEXT.has(kind) ? 'text' : 'original';

// Reader-only projection. It neither modifies originals nor changes the
// existing attachment compiler's 64k prompt budget. Indexing remains an
// explicit call to the existing research/sources/ingest application endpoint.
export function createDocumentPreview({database, resolveResourcePath, research}) {
  async function original(id) {
    const resource = typeof id === 'string' && id ? await database.getResource(id) : null;
    if (!resource) throw error('RESOURCE_NOT_FOUND', '资料不存在。', 404);
    const file = await realpath(await resolveResourcePath(resource));
    const info = await stat(file);
    if (!info.isFile()) throw error('NOT_A_FILE', '资料不是普通文件。');
    if (info.size > 100 * 1024 * 1024) throw error('PREVIEW_TOO_LARGE', '文件超过 100 MB，请打开原件。', 413);
    return {resource, bytes:await readFile(file)};
  }
  async function document(id) {
    const {resource,bytes} = await original(id);
    const kind = path.extname(resource.title).slice(1).toLowerCase();
    const format = formatOf(kind);
    const source = research.store.sourceByResource(resource.id);
    const result = {
      id:resource.id, title:resource.title, kind, format,
      sourceId:source?.id ?? null,
      parseStatus:source?.contentStatus ?? 'unparsed',
      parseError:source?.parseError ?? null,
    };
    if (format === 'docx') {
      const converted = await convertDocx(bytes);
      result.html = converted.html;
      result.warnings = converted.warnings ?? [];
    } else if (['markdown','latex','text','csv'].includes(format)) {
      result.text = decodeText(bytes);
      if (format === 'latex') result.blocks = (await parserFor(resource.title).parse(bytes, {name:resource.title})).blocks;
    }
    return result;
  }
  async function content(id) {
    const result = await original(id);
    const format = formatOf(path.extname(result.resource.title).slice(1).toLowerCase());
    if (!['pdf','docx'].includes(format)) throw error('UNSUPPORTED_READER_CONTENT', '此格式请打开原件。');
    return {bytes:result.bytes, type:format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};
  }
  return {document, content};
}
