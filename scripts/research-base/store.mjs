// Research Base store: validated CRUD over the rb_* tables, FTS maintenance,
// the proposal inbox (agent write path) and usage receipts. Synchronous
// node:sqlite calls wrapped in short transactions; callers own concurrency.
import { randomUUID, createHash } from 'node:crypto';
import {
  applyResearchBaseSchema, SOURCE_KINDS, CONTENT_STATUS, CHUNK_KINDS, ITEM_TYPES, ITEM_SUBTYPES, ITEM_STATUS,
  CLAIM_STATUS, VISIBILITY, LINK_RELATIONS, REF_TYPES, PROPOSAL_OPS,
} from './schema.mjs';
import { indexText } from './text-index.mjs';

export class ResearchBaseError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const bad = (message, code = 'INVALID_RESEARCH_RECORD') => { throw new ResearchBaseError(code, message); };
const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const ID = /^[A-Za-z0-9_-]{1,160}$/u;
const id = (value, name = 'id') => (typeof value === 'string' && ID.test(value) ? value : bad(`无效的${name}。`));
const optionalId = (value, name) => (value == null ? null : id(value, name));
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const checkRecordSize = (value, name) => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_RECORD_BYTES)
    throw new ResearchBaseError('RESEARCH_RESOURCE_LIMIT', `${name}超过 64 MiB 资源上限；本次未保存，已有记录保持完整。请分成多条提议。`, 413);
};
const text = (value, name, max = Infinity, { required = false } = {}) => {
  if (value == null || value === '') { if (required) bad(`${name}不能为空。`); return null; }
  if (typeof value !== 'string') bad(`${name}须为文本。`);
  if (value.length > max) bad(`${name}须为不超过 ${max} 个字符的文本。`);
  return value;
};
const oneOf = (value, list, name) => (list.includes(value) ? value : bad(`${name}取值无效：${value}`));
const json = (value) => JSON.stringify(value ?? {});
const parse = (value, fallback) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const scopeOf = (value) => (value === 'personal' || value === 'project' || /^expert:[A-Za-z0-9_-]{1,80}$/u.test(value ?? '') ? value : bad('scope 须为 personal、project 或 expert:<id>。'));

// Typed payload validation per item type. Unknown keys are kept (forward
// compatible) but the listed ones are checked.
function validatePayload(type, subtype, payload = {}) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) bad('body_json 须为对象。');
  if (type === 'claim') {
    if (payload.claimStatus !== undefined) oneOf(payload.claimStatus, CLAIM_STATUS, '主张状态');
  }
  if (type === 'model') {
    if (payload.latex !== undefined) text(payload.latex, 'LaTeX');
    if (payload.variables !== undefined && !Array.isArray(payload.variables)) bad('variables 须为数组。');
    for (const variable of payload.variables ?? []) if (!variable || typeof variable.symbol !== 'string') bad('每个变量须有 symbol。');
    if (payload.assumptions !== undefined && !Array.isArray(payload.assumptions)) bad('assumptions 须为数组。');
    if (payload.steps !== undefined && !Array.isArray(payload.steps)) bad('steps 须为数组。');
  }
  return payload;
}

export function createResearchStore({ db }) {
  applyResearchBaseSchema(db);
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const out = fn(); db.exec('COMMIT'); return out; } catch (error) { db.exec('ROLLBACK'); throw error; } };

  // ---------- FTS maintenance ----------
  const ftsDelete = (docType, docId) => db.prepare('DELETE FROM rb_fts WHERE doc_type=? AND doc_id=?').run(docType, docId);
  const ftsPut = (docType, docId, projectId, title, body) => { ftsDelete(docType, docId); db.prepare('INSERT INTO rb_fts(doc_type,doc_id,project_id,title,body) VALUES(?,?,?,?,?)').run(docType, docId, projectId ?? '', indexText(title), indexText(body)); };

  // ---------- sources ----------
  const sourceRow = (r) => r && ({
    id: r.id, projectId: r.project_id, number: r.number, label: `S${r.number}`, kind: r.kind, title: r.title,
    authors: parse(r.authors_json, []), year: r.year, venue: r.venue, doi: r.doi, arxivId: r.arxiv_id, pmid: r.pmid, isbn: r.isbn,
    url: r.url, abstract: r.abstract, language: r.language, citekey: r.citekey, csl: parse(r.csl_json, null), resourceId: r.resource_id,
    tags: parse(r.tags_json, []), readStatus: r.read_status, rating: r.rating, contentStatus: r.content_status, parser: r.parser,
    parseError: r.parse_error, pages: r.pages, addedAt: r.added_at, updatedAt: r.updated_at,
  });
  const SOURCE_FIELDS = { title: 1000, venue: 500, doi: 200, arxivId: 60, pmid: 30, isbn: 30, url: 2000, abstract: 20000, language: 20, citekey: 120 };
  function normalizeSource(input, existing = {}) {
    const out = {};
    if (input.kind !== undefined) out.kind = oneOf(input.kind, SOURCE_KINDS, '来源类型');
    for (const [key, max] of Object.entries(SOURCE_FIELDS)) if (input[key] !== undefined) out[key] = text(input[key], key, max);
    if (input.title !== undefined && !out.title) bad('标题不能为空。');
    if (input.doi) out.doi = out.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//iu, '').trim().toLowerCase();
    if (input.authors !== undefined) {
      if (!Array.isArray(input.authors) || input.authors.length > 500) bad('作者须为数组。');
      out.authors = input.authors.map((a) => (typeof a === 'string' ? { literal: a.slice(0, 200) } : { ...(a.family ? { family: String(a.family).slice(0, 120) } : {}), ...(a.given ? { given: String(a.given).slice(0, 120) } : {}), ...(a.literal ? { literal: String(a.literal).slice(0, 200) } : {}) }));
    }
    if (input.year !== undefined) out.year = input.year === null ? null : Number.isInteger(input.year) && input.year > 0 && input.year < 3000 ? input.year : bad('年份无效。');
    if (input.tags !== undefined) { if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string' || t.length > 60)) bad('标签无效。'); out.tags = [...new Set(input.tags)].slice(0, 50); }
    if (input.readStatus !== undefined) out.readStatus = oneOf(input.readStatus, ['unread', 'reading', 'read'], '阅读状态');
    if (input.rating !== undefined) out.rating = input.rating === null ? null : Number.isInteger(input.rating) && input.rating >= 0 && input.rating <= 5 ? input.rating : bad('评分须为 0–5。');
    if (input.csl !== undefined) { if (input.csl !== null && typeof input.csl !== 'object') bad('CSL 须为对象。'); out.csl = input.csl; }
    if (input.resourceId !== undefined) out.resourceId = optionalId(input.resourceId, '资源标识');
    if (input.contentStatus !== undefined) out.contentStatus = oneOf(input.contentStatus, CONTENT_STATUS, '内容状态');
    return { ...existing, ...out };
  }
  function addSource(input = {}) {
    const projectId = optionalId(input.projectId ?? null, '项目标识');
    const value = normalizeSource({ kind: 'file', ...input });
    if (!value.title) bad('标题不能为空。');
    return tx(() => {
      if (value.doi) { const same = db.prepare('SELECT id FROM rb_sources WHERE doi=? AND ifnull(project_id,\'\')=ifnull(?,\'\')').get(value.doi, projectId); if (same) throw new ResearchBaseError('DUPLICATE_SOURCE', `已存在相同 DOI 的来源（${same.id}）。`, 409); }
      if (value.resourceId) { const same = db.prepare('SELECT id FROM rb_sources WHERE resource_id=?').get(value.resourceId); if (same) return getSource(same.id); }
      const sourceId = input.id ? id(input.id) : newId('src');
      const number = (db.prepare("SELECT max(number) n FROM rb_sources WHERE ifnull(project_id,'')=ifnull(?,'')").get(projectId).n ?? 0) + 1;
      const t = now();
      db.prepare(`INSERT INTO rb_sources(id,project_id,number,kind,title,authors_json,year,venue,doi,arxiv_id,pmid,isbn,url,abstract,language,citekey,csl_json,resource_id,tags_json,read_status,rating,content_status,added_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sourceId, projectId, number, value.kind, value.title, json(value.authors ?? []), value.year ?? null, value.venue ?? null,
        value.doi ?? null, value.arxivId ?? null, value.pmid ?? null, value.isbn ?? null, value.url ?? null, value.abstract ?? null, value.language ?? null, value.citekey ?? null,
        value.csl ? JSON.stringify(value.csl) : null, value.resourceId ?? null, json(value.tags ?? []), value.readStatus ?? 'unread', value.rating ?? null, value.contentStatus ?? 'none', t, t);
      ftsPut('source', sourceId, projectId, value.title, [value.abstract, value.venue, (value.authors ?? []).map((a) => a.literal || `${a.given ?? ''} ${a.family ?? ''}`).join(' '), value.doi].filter(Boolean).join('\n'));
      return getSource(sourceId);
    });
  }
  function updateSource(sourceId, patch = {}) {
    const current = sourceRow(db.prepare('SELECT * FROM rb_sources WHERE id=?').get(id(sourceId)));
    if (!current) throw new ResearchBaseError('SOURCE_NOT_FOUND', '来源不存在。', 404);
    const value = normalizeSource(patch, current);
    return tx(() => {
      db.prepare(`UPDATE rb_sources SET kind=?,title=?,authors_json=?,year=?,venue=?,doi=?,arxiv_id=?,pmid=?,isbn=?,url=?,abstract=?,language=?,citekey=?,csl_json=?,tags_json=?,read_status=?,rating=?,updated_at=? WHERE id=?`)
        .run(value.kind, value.title, json(value.authors), value.year ?? null, value.venue ?? null, value.doi ?? null, value.arxivId ?? null, value.pmid ?? null, value.isbn ?? null, value.url ?? null,
          value.abstract ?? null, value.language ?? null, value.citekey ?? null, value.csl ? JSON.stringify(value.csl) : null, json(value.tags), value.readStatus, value.rating ?? null, now(), current.id);
      ftsPut('source', current.id, current.projectId, value.title, [value.abstract, value.venue, (value.authors ?? []).map((a) => a.literal || `${a.given ?? ''} ${a.family ?? ''}`).join(' '), value.doi].filter(Boolean).join('\n'));
      return getSource(current.id);
    });
  }
  const getSource = (sourceId) => sourceRow(db.prepare('SELECT * FROM rb_sources WHERE id=?').get(sourceId));
  const sourceByResource = (resourceId) => sourceRow(db.prepare('SELECT * FROM rb_sources WHERE resource_id=?').get(resourceId));
  const sourceByLabel = (projectId, number) => sourceRow(db.prepare("SELECT * FROM rb_sources WHERE ifnull(project_id,'')=ifnull(?,'') AND number=?").get(projectId ?? null, number));
  const sourceFilters = ({ projectId, includePersonal = true, kind, readStatus, tag } = {}) => {
    const where = []; const params = [];
    if (projectId !== undefined) { where.push(includePersonal && projectId ? '(project_id=? OR project_id IS NULL)' : projectId ? 'project_id=?' : 'project_id IS NULL'); if (projectId) params.push(projectId); }
    if (kind) { where.push('kind=?'); params.push(oneOf(kind, SOURCE_KINDS, '来源类型')); }
    if (readStatus) { where.push('read_status=?'); params.push(readStatus); }
    if (tag) { where.push("EXISTS (SELECT 1 FROM json_each(tags_json) WHERE value=?)"); params.push(tag); }
    return { where, params };
  };
  const SOURCE_SORTS = Object.freeze({ addedAt: 'added_at', title: 'title COLLATE NOCASE', year: 'year', author: "json_extract(authors_json,'$[0].literal') COLLATE NOCASE", venue: 'venue COLLATE NOCASE', kind: 'kind', contentStatus: 'content_status', readStatus: 'read_status' });
  function listSources({ projectId, includePersonal = true, kind, readStatus, tag, limit = 100, offset = 0, sort = 'addedAt', direction = 'desc' } = {}) {
    const { where, params } = sourceFilters({ projectId, includePersonal, kind, readStatus, tag });
    const sortColumn = SOURCE_SORTS[sort] ?? bad('来源排序字段无效。');
    if (!['asc', 'desc'].includes(direction)) bad('来源排序方向无效。');
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0;
    const rows = db.prepare(`SELECT * FROM rb_sources ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${sortColumn} ${direction.toUpperCase()}, added_at DESC, number ASC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset);
    return rows.map(sourceRow);
  }
  function countSources(filters = {}) {
    const { where, params } = sourceFilters(filters);
    return db.prepare(`SELECT count(*) AS total FROM rb_sources ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).total;
  }
  function removeSource(sourceId) {
    return tx(() => {
      const chunkIds = db.prepare('SELECT id FROM rb_chunks WHERE source_id=?').all(sourceId).map((r) => r.id);
      for (const chunkId of chunkIds) ftsDelete('chunk', chunkId);
      ftsDelete('source', sourceId);
      db.prepare("DELETE FROM rb_links WHERE (from_type='source' AND from_id=?) OR (to_type='source' AND to_id=?)").run(sourceId, sourceId);
      return db.prepare('DELETE FROM rb_sources WHERE id=?').run(sourceId).changes > 0;
    });
  }

  // ---------- chunks ----------
  const chunkRow = (r) => r && ({ id: r.id, sourceId: r.source_id, ordinal: r.ordinal, page: r.page, section: r.section, kind: r.kind, text: r.text, charStart: r.char_start, charEnd: r.char_end, anchor: parse(r.anchor_json, null) });
  /** Replace all passages of a source with parser output (already chunked). */
  function replaceChunks(sourceId, chunks, { parser, pages = null, contentStatus = 'parsed', parseError = null } = {}) {
    const source = getSource(sourceId); if (!source) throw new ResearchBaseError('SOURCE_NOT_FOUND', '来源不存在。', 404);
    if (!Array.isArray(chunks) || chunks.length > 50000) bad('分段结果无效。');
    checkRecordSize(chunks, '解析分段');
    const passages = [];
    const hasSplitPassages = chunks.some(chunk => typeof chunk?.text === 'string' && chunk.text.length > 20000);
    chunks.forEach((chunk, sourceOrdinal) => {
      if (!chunk || typeof chunk.text !== 'string' || !chunk.text.trim()) return;
      const split = chunk.text.length > 20000;
      const absoluteOffsets = Number.isSafeInteger(chunk.charStart) && chunk.charStart >= 0 && Number.isSafeInteger(chunk.charEnd) && chunk.charEnd - chunk.charStart === chunk.text.length;
      for (let start = 0; start < chunk.text.length;) {
        let end = Math.min(start + 20000, chunk.text.length);
        if (end < chunk.text.length && /[\uD800-\uDBFF]/u.test(chunk.text[end - 1]) && /[\uDC00-\uDFFF]/u.test(chunk.text[end])) end--;
        passages.push({...chunk, text:chunk.text.slice(start,end),
          charStart:split ? (absoluteOffsets ? chunk.charStart + start : null) : chunk.charStart ?? null,
          charEnd:split ? (absoluteOffsets ? chunk.charStart + end : null) : chunk.charEnd ?? null,
          anchor:hasSplitPassages ? {...chunk.anchor, split:{sourceOrdinal,start,end}} : chunk.anchor});
        start = end;
      }
    });
    checkRecordSize(passages, '解析分段投影');
    return tx(() => {
      for (const row of db.prepare('SELECT id FROM rb_chunks WHERE source_id=?').all(sourceId)) ftsDelete('chunk', row.id);
      db.prepare('DELETE FROM rb_chunks WHERE source_id=?').run(sourceId);
      const insert = db.prepare('INSERT INTO rb_chunks(id,source_id,ordinal,page,section,kind,text,char_start,char_end,anchor_json) VALUES(?,?,?,?,?,?,?,?,?,?)');
      passages.forEach((chunk, ordinal) => {
        const chunkId = `${sourceId}-c${ordinal}`;
        insert.run(chunkId, sourceId, ordinal, Number.isInteger(chunk.page) ? chunk.page : null, chunk.section ? String(chunk.section).slice(0, 500) : null,
          CHUNK_KINDS.includes(chunk.kind) ? chunk.kind : 'paragraph', chunk.text, chunk.charStart ?? null, chunk.charEnd ?? null, chunk.anchor ? JSON.stringify(chunk.anchor) : null);
        ftsPut('chunk', chunkId, source.projectId, chunk.section || '', chunk.text);
      });
      db.prepare('UPDATE rb_sources SET content_status=?, parser=?, parse_error=?, pages=?, updated_at=? WHERE id=?').run(contentStatus, parser ?? null, parseError, pages, now(), sourceId);
      return db.prepare('SELECT count(*) n FROM rb_chunks WHERE source_id=?').get(sourceId).n;
    });
  }
  function markContent(sourceId, contentStatus, { parser = null, parseError = null } = {}) {
    db.prepare('UPDATE rb_sources SET content_status=?, parser=?, parse_error=?, updated_at=? WHERE id=?').run(oneOf(contentStatus, CONTENT_STATUS, '内容状态'), parser, parseError, now(), sourceId);
  }
  const getChunk = (chunkId) => chunkRow(db.prepare('SELECT * FROM rb_chunks WHERE id=?').get(chunkId));
  function chunksOf(sourceId, { page, fromOrdinal = 0, limit = 200 } = {}) {
    const rows = page != null
      ? db.prepare('SELECT * FROM rb_chunks WHERE source_id=? AND page=? ORDER BY ordinal LIMIT ?').all(sourceId, page, limit)
      : db.prepare('SELECT * FROM rb_chunks WHERE source_id=? AND ordinal>=? ORDER BY ordinal LIMIT ?').all(sourceId, fromOrdinal, limit);
    return rows.map(chunkRow);
  }

  // ---------- items ----------
  const itemRow = (r) => r && ({
    id: r.id, type: r.type, subtype: r.subtype, projectId: r.project_id, scope: r.scope, title: r.title, body: r.body, payload: parse(r.body_json, {}),
    status: r.status, visibility: r.visibility, pinned: r.pinned === 1, confidence: r.confidence, importance: r.importance,
    validFrom: r.valid_from, validTo: r.valid_to, supersededBy: r.superseded_by, revision: r.revision, createdBy: r.created_by,
    origin: parse(r.origin_json, {}), legacyId: r.legacy_id, createdAt: r.created_at, updatedAt: r.updated_at, lastUsedAt: r.last_used_at, useCount: r.use_count,
  });
  function normalizeItem(input, existing = null) {
    const type = oneOf(input.type ?? existing?.type, ITEM_TYPES, '条目类型');
    const subtype = oneOf(input.subtype ?? existing?.subtype ?? ITEM_SUBTYPES[type][0], ITEM_SUBTYPES[type], '条目子类型');
    const scope = scopeOf(input.scope ?? existing?.scope ?? (input.projectId ?? existing?.projectId ? 'project' : 'personal'));
    const projectId = input.projectId !== undefined ? optionalId(input.projectId, '项目标识') : existing?.projectId ?? null;
    if (scope === 'project' && !projectId) bad('项目范围的条目需要项目标识。');
    const title = text(input.title ?? existing?.title, '标题', undefined, { required: true });
    const body = text(input.body ?? existing?.body ?? '', '正文') ?? '';
    const payload = validatePayload(type, subtype, input.payload ?? existing?.payload ?? {});
    const visibility = oneOf(input.visibility ?? existing?.visibility ?? 'shared', VISIBILITY, '可见性');
    const confidence = input.confidence ?? existing?.confidence ?? null;
    if (confidence !== null && !(typeof confidence === 'number' && confidence >= 0 && confidence <= 1)) bad('置信度须在 0–1 之间。');
    const importance = input.importance ?? existing?.importance ?? 3;
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) bad('重要性须为 1–5。');
    const pinned = input.pinned ?? existing?.pinned ?? false;
    const validFrom = text(input.validFrom ?? existing?.validFrom ?? null, 'validFrom', 40);
    const value = { type, subtype, scope, projectId, title, body, payload, visibility, confidence, importance, pinned: !!pinned, validFrom };
    checkRecordSize(value, '研究条目');
    return value;
  }
  function createItem(input = {}, { status = 'active', createdBy = 'user', origin = {}, legacyId = null } = {}) {
    const value = normalizeItem(input);
    oneOf(status, ITEM_STATUS, '状态');
    return tx(() => {
      const itemId = input.id ? id(input.id) : newId('itm'); const t = now();
      db.prepare(`INSERT INTO rb_items(id,type,subtype,project_id,scope,title,body,body_json,status,visibility,pinned,confidence,importance,valid_from,created_by,origin_json,legacy_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(itemId, value.type, value.subtype, value.projectId, value.scope, value.title, value.body, json(value.payload), status, value.visibility,
        value.pinned ? 1 : 0, value.confidence, value.importance, value.validFrom ?? (value.type === 'memory' ? t : null), String(createdBy).slice(0, 120), json(origin), legacyId, t, t);
      if (status !== 'rejected') ftsPut('item', itemId, value.projectId, value.title, `${value.body}\n${payloadText(value.payload)}`);
      return getItem(itemId);
    });
  }
  function updateItem(itemId, patch = {}, { changedBy = 'user' } = {}) {
    const current = getItem(id(itemId)); if (!current) throw new ResearchBaseError('ITEM_NOT_FOUND', '条目不存在。', 404);
    if (patch.expectedRevision !== undefined && patch.expectedRevision !== current.revision) throw new ResearchBaseError('REVISION_CONFLICT', '条目已被修改，请刷新后再编辑。', 409);
    const value = normalizeItem(patch, current);
    const status = patch.status !== undefined ? oneOf(patch.status, ITEM_STATUS, '状态') : current.status;
    return tx(() => {
      db.prepare('INSERT INTO rb_revisions VALUES(?,?,?,?,?)').run(current.id, current.revision, JSON.stringify(current), String(changedBy).slice(0, 120), now());
      db.prepare(`UPDATE rb_items SET type=?,subtype=?,project_id=?,scope=?,title=?,body=?,body_json=?,status=?,visibility=?,pinned=?,confidence=?,importance=?,valid_from=?,revision=revision+1,updated_at=? WHERE id=?`)
        .run(value.type, value.subtype, value.projectId, value.scope, value.title, value.body, json(value.payload), status, value.visibility, value.pinned ? 1 : 0, value.confidence, value.importance, value.validFrom, now(), current.id);
      if (status === 'rejected') ftsDelete('item', current.id); else ftsPut('item', current.id, value.projectId, value.title, `${value.body}\n${payloadText(value.payload)}`);
      return getItem(current.id);
    });
  }
  /** Temporal supersession: the old record stays (for provenance), marked invalid from now. */
  function supersedeItem(oldId, replacement, options = {}) {
    const old = getItem(id(oldId)); if (!old) throw new ResearchBaseError('ITEM_NOT_FOUND', '条目不存在。', 404);
    if (options.expectedRevision !== undefined && options.expectedRevision !== old.revision) throw new ResearchBaseError('REVISION_CONFLICT', '条目已被修改，请刷新后再编辑。', 409);
    if (old.status !== 'active') bad('只能取代有效的条目。', 'NOT_ACTIVE');
    const next = createItem({ type: old.type, subtype: old.subtype, projectId: old.projectId, scope: old.scope, visibility: old.visibility, pinned: old.pinned, ...replacement }, options);
    const t = now();
    tx(() => {
      db.prepare('INSERT INTO rb_revisions VALUES(?,?,?,?,?)').run(old.id, old.revision, JSON.stringify(old), String(options.createdBy ?? 'user'), t);
      db.prepare("UPDATE rb_items SET status='superseded', valid_to=?, superseded_by=?, pinned=0, revision=revision+1, updated_at=? WHERE id=?").run(t, next.id, t, old.id);
      db.prepare('INSERT OR IGNORE INTO rb_links VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(newId('lnk'), 'item', next.id, 'item', old.id, 'supersedes', null, null, null, null, String(options.createdBy ?? 'user'), t);
    });
    return { item: next, superseded: getItem(old.id) };
  }
  const getItem = (itemId) => itemRow(db.prepare('SELECT * FROM rb_items WHERE id=?').get(itemId));
  const evidenceCount = (itemId) => db.prepare("SELECT count(*) AS count FROM rb_links WHERE relation IN ('supports','contradicts','qualifies') AND ((from_type='item' AND from_id=?) OR (to_type='item' AND to_id=?))").get(itemId, itemId).count;
  function listItems({ projectId, includePersonal = true, type, subtype, status = 'active', scope, pinned, visibility, limit = 100, offset = 0 } = {}) {
    const where = []; const params = [];
    if (projectId !== undefined) { where.push(includePersonal && projectId ? '(project_id=? OR project_id IS NULL)' : projectId ? 'project_id=?' : 'project_id IS NULL'); if (projectId) params.push(projectId); }
    if (type) { where.push('type=?'); params.push(oneOf(type, ITEM_TYPES, '条目类型')); }
    if (subtype) { where.push('subtype=?'); params.push(subtype); }
    if (status && status !== 'any') { where.push('status=?'); params.push(oneOf(status, ITEM_STATUS, '状态')); }
    if (scope) { where.push('scope=?'); params.push(scope); }
    if (pinned !== undefined) { where.push('pinned=?'); params.push(pinned ? 1 : 0); }
    if (visibility) { where.push('visibility=?'); params.push(visibility); }
    return db.prepare(`SELECT * FROM rb_items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pinned DESC, importance DESC, updated_at DESC LIMIT ? OFFSET ?`).all(...params, Math.min(500, limit), Math.max(0, offset)).map(itemRow);
  }
  const revisionsOf = (itemId) => db.prepare('SELECT * FROM rb_revisions WHERE item_id=? ORDER BY revision DESC').all(itemId).map((r) => ({ revision: r.revision, snapshot: parse(r.snapshot_json, null), changedBy: r.changed_by, changedAt: r.changed_at }));

  // ---------- links ----------
  const linkRow = (r) => r && ({ id: r.id, from: { type: r.from_type, id: r.from_id }, to: { type: r.to_type, id: r.to_id }, relation: r.relation, note: r.note, quote: r.quote, locator: parse(r.locator_json, null), strength: r.strength, createdBy: r.created_by, createdAt: r.created_at });
  const ref = (value, name) => { if (!value || !REF_TYPES.includes(value.type)) bad(`${name} 引用类型无效。`); return { type: value.type, id: id(value.id, `${name} 标识`) }; };
  function link({ from, to, relation, note = null, quote = null, locator = null, strength = null }, { createdBy = 'user' } = {}) {
    const a = ref(from, 'from'); const b = ref(to, 'to'); oneOf(relation, LINK_RELATIONS, '关系');
    text(note, '备注'); text(quote, '引文');
    checkRecordSize({from:a,to:b,relation,note,quote,locator,strength}, '证据链接');
    const linkId = newId('lnk');
    db.prepare('INSERT INTO rb_links VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(from_type,from_id,to_type,to_id,relation) DO UPDATE SET note=excluded.note, quote=excluded.quote, locator_json=excluded.locator_json, strength=excluded.strength')
      .run(linkId, a.type, a.id, b.type, b.id, relation, note, quote, locator ? JSON.stringify(locator) : null, strength, String(createdBy).slice(0, 120), now());
    return linkRow(db.prepare('SELECT * FROM rb_links WHERE from_type=? AND from_id=? AND to_type=? AND to_id=? AND relation=?').get(a.type, a.id, b.type, b.id, relation));
  }
  const unlink = (linkId) => db.prepare('DELETE FROM rb_links WHERE id=?').run(id(linkId)).changes > 0;
  function linksOf(target, { direction = 'both', relation } = {}) {
    const r = ref(target, 'target'); const out = [];
    if (direction !== 'in') out.push(...db.prepare(`SELECT * FROM rb_links WHERE from_type=? AND from_id=? ${relation ? 'AND relation=?' : ''}`).all(r.type, r.id, ...(relation ? [relation] : [])));
    if (direction !== 'out') out.push(...db.prepare(`SELECT * FROM rb_links WHERE to_type=? AND to_id=? ${relation ? 'AND relation=?' : ''}`).all(r.type, r.id, ...(relation ? [relation] : [])));
    return out.map(linkRow);
  }

  // ---------- proposals (agent write path) ----------
  const proposalRow = (r) => r && ({ id: r.id, projectId: r.project_id, op: r.op, targetId: r.target_id, payload: parse(r.payload_json, {}), rationale: r.rationale, origin: parse(r.origin_json, {}), status: r.status, resultId: r.result_id, createdAt: r.created_at, decidedAt: r.decided_at, decidedBy: r.decided_by });
  /** Validate now so a bad proposal fails for the agent, not later for the user. */
  function propose({ op, targetId = null, payload = {}, rationale = null, projectId = null }, { origin = {} } = {}) {
    oneOf(op, PROPOSAL_OPS, '操作');
    text(rationale, '理由');
    checkRecordSize({op,targetId,payload,rationale,projectId}, '研究提议');
    if (op === 'create' || op === 'supersede') normalizeItem({ projectId, ...payload.item, projectId: payload.item?.projectId ?? projectId });
    if (op === 'update') { if (!getItem(targetId)) bad('要修改的条目不存在。'); normalizeItem(payload.item ?? {}, getItem(targetId)); }
    if (op === 'supersede' || op === 'archive') { const target = getItem(targetId); if (!target || target.status !== 'active') bad('目标条目不存在或已失效。'); }
    for (const evidence of payload.evidence ?? []) { ref(evidence.ref, 'evidence'); oneOf(evidence.relation ?? 'supports', LINK_RELATIONS, '证据关系'); }
    if (op === 'link') { ref(payload.from, 'from'); ref(payload.to, 'to'); oneOf(payload.relation, LINK_RELATIONS, '关系'); }
    const dedupeKey = createHash('sha256').update(JSON.stringify([projectId, op, targetId, payload])).digest('hex');
    const existing = db.prepare("SELECT * FROM rb_proposals WHERE dedupe_key=? AND status='pending'").get(dedupeKey);
    if (existing) return { ...proposalRow(existing), duplicate: true };
    const proposalId = newId('prp');
    db.prepare('INSERT INTO rb_proposals(id,project_id,op,target_id,payload_json,rationale,origin_json,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(proposalId, optionalId(projectId, '项目标识'), op, targetId, JSON.stringify(payload), rationale, json(origin), dedupeKey, now());
    return proposalRow(db.prepare('SELECT * FROM rb_proposals WHERE id=?').get(proposalId));
  }
  const getProposal = (proposalId) => proposalRow(db.prepare('SELECT * FROM rb_proposals WHERE id=?').get(proposalId));
  function listProposals({ projectId, status = 'pending', limit = 100 } = {}) {
    const where = ['status=?']; const params = [status];
    if (projectId !== undefined) { where.push(projectId ? '(project_id=? OR project_id IS NULL)' : 'project_id IS NULL'); if (projectId) params.push(projectId); }
    return db.prepare(`SELECT * FROM rb_proposals WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...params, Math.min(500, limit)).map(proposalRow);
  }
  /** Accept (optionally with the user's edits) or reject. Accepting applies the change. */
  function decide(proposalId, { accept, edits = null, decidedBy = 'user' } = {}) {
    const proposal = getProposal(id(proposalId));
    if (!proposal) throw new ResearchBaseError('PROPOSAL_NOT_FOUND', '提议不存在。', 404);
    if (proposal.status !== 'pending') throw new ResearchBaseError('PROPOSAL_DECIDED', '这条提议已经处理过。', 409);
    const finish = (status, resultId = null) => { db.prepare('UPDATE rb_proposals SET status=?, result_id=?, decided_at=?, decided_by=? WHERE id=?').run(status, resultId, now(), decidedBy, proposal.id); return { proposal: getProposal(proposal.id), resultId }; };
    if (!accept) return finish('rejected');
    const payload = edits ? { ...proposal.payload, ...edits, item: { ...proposal.payload.item, ...edits.item } } : proposal.payload;
    checkRecordSize({payload,rationale:proposal.rationale}, '研究提议');
    const origin = { ...proposal.origin, proposalId: proposal.id };
    const author = proposal.origin.role ? `agent:${proposal.origin.role}${proposal.origin.expertId ? ':' + proposal.origin.expertId : ''}` : 'agent';
    let resultId = null;
    if (proposal.op === 'create') resultId = createItem({ projectId: proposal.projectId, ...payload.item }, { createdBy: author, origin }).id;
    else if (proposal.op === 'update') resultId = updateItem(proposal.targetId, payload.item ?? {}, { changedBy: `${author} (accepted by ${decidedBy})` }).id;
    else if (proposal.op === 'supersede') resultId = supersedeItem(proposal.targetId, payload.item ?? {}, { createdBy: author, origin }).item.id;
    else if (proposal.op === 'archive') resultId = updateItem(proposal.targetId, { status: 'archived' }, { changedBy: author }).id;
    else if (proposal.op === 'link') resultId = link({ from: payload.from, to: payload.to, relation: payload.relation, note: payload.note, quote: payload.quote }, { createdBy: author }).id;
    if (resultId && proposal.op !== 'link') for (const evidence of payload.evidence ?? []) link({ from: evidence.ref, to: { type: 'item', id: resultId }, relation: evidence.relation ?? 'supports', quote: evidence.quote ?? null, note: evidence.note ?? null }, { createdBy: author });
    return finish('accepted', resultId);
  }

  // ---------- usage receipts ----------
  function recordUsage({ chatId, messageId, refs = [], how }) {
    const t = now(); const insert = db.prepare('INSERT OR IGNORE INTO rb_usage VALUES(?,?,?,?,?,?)');
    const touch = db.prepare('UPDATE rb_items SET last_used_at=?, use_count=use_count+1 WHERE id=?');
    tx(() => { for (const r of refs) { insert.run(chatId, messageId, r.type, r.id, how, t); if (r.type === 'item') touch.run(t, r.id); } });
  }
  const usageOf = (chatId, messageId) => db.prepare('SELECT ref_type type, ref_id id, how FROM rb_usage WHERE chat_id=? AND message_id=? ORDER BY at').all(chatId, messageId);

  return {
    db, tx,
    addSource, updateSource, getSource, sourceByResource, sourceByLabel, listSources, countSources, removeSource,
    replaceChunks, markContent, getChunk, chunksOf,
    createItem, updateItem, supersedeItem, getItem, listItems, evidenceCount, revisionsOf,
    link, unlink, linksOf,
    propose, getProposal, listProposals, decide,
    recordUsage, usageOf,
  };
}

/** Searchable text of a typed payload (formula variables, claim statement…). */
export function payloadText(payload = {}) {
  const parts = [];
  if (payload.statement) parts.push(payload.statement);
  if (payload.latex) parts.push(payload.latex);
  for (const v of payload.variables ?? []) parts.push(`${v.symbol} ${v.meaning ?? ''} ${v.unit ?? ''}`);
  for (const a of payload.assumptions ?? []) parts.push(String(a));
  for (const s of payload.steps ?? []) parts.push(String(s));
  if (payload.domain) parts.push(payload.domain);
  if (payload.keywords) parts.push([].concat(payload.keywords).join(' '));
  return parts.join('\n');
}
