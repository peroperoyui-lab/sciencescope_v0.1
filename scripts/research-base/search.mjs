// Retrieval over the Research Base: keyword search, hybrid search, bounded
// reading, citation labels and the project brief.
import { matchExpression, snippet } from './text-index.mjs';
import { ResearchBaseError } from './store.mjs';
import { parseCitationLabel } from './citations.mjs';
import {
  fuseHybridRankings, HYBRID_FALLBACK_REASONS, HYBRID_RRF_K, HYBRID_VECTOR_LIMIT,
  HYBRID_VECTOR_TIMEOUT_MS, hybridRefKey, normalizeHybridQueries, runVectorPhase,
} from './hybrid.mjs';

const REF_TYPES = new Set(['chunk', 'source', 'item']);
export const itemHandle = (itemId) => String(itemId).replace(/^itm_/u, '').slice(0, 8);
export const citeOf = {
  source: (source) => `[${source.label}]`,
  chunk: (source, chunk) => `[${source.label}${chunk.page ? ` p.${chunk.page}` : ''}]`,
  item: (item) => `[@${itemHandle(item.id)}]`,
};

/**
 * Who is asking decides what is visible: 'user' sees everything in scope;
 * 'agent' never sees private items, superseded items only on request, and
 * expert-scoped items only for that expert.
 */
function visible(item, { audience, expertId, includeSuperseded }) {
  if (item.status === 'rejected' || item.status === 'proposed') return false;
  if (!includeSuperseded && item.status !== 'active') return false;
  if (audience === 'agent' && item.visibility === 'private') return false;
  if (item.scope.startsWith('expert:') && audience === 'agent' && item.scope !== `expert:${expertId}`) return false;
  return true;
}

export function createResearchSearch({ store }) {
  const { db } = store;
  let vectorRetriever = null;

  function normalizeScope({ projectId = null, includePersonal = true, projectIds } = {}) {
    if (projectIds !== undefined) {
      if (!Array.isArray(projectIds) || projectIds.some((value) => value !== null && (typeof value !== 'string' || !value))) {
        throw new ResearchBaseError('INVALID_SCOPE', '项目范围无效。');
      }
      const selected = [...new Set(projectIds)];
      if (includePersonal) selected.push(null);
      return [...new Set(selected)].map((value) => value ?? '');
    }
    if (projectId !== null && (typeof projectId !== 'string' || !projectId)) {
      throw new ResearchBaseError('INVALID_SCOPE', '项目范围无效。');
    }
    return projectId === null ? [''] : includePersonal ? [projectId, ''] : [projectId];
  }

  function scopeClause(column, values) {
    if (!values.length) return { sql: '0', params: [] };
    return { sql: `${column} IN (${values.map(() => '?').join(',')})`, params: values };
  }

  function itemVisibilitySql(options, alias = 'i') {
    const where = [`${alias}.status NOT IN ('proposed','rejected')`];
    const params = [];
    if (!options.includeSuperseded) where.push(`${alias}.status='active'`);
    if (options.audience === 'agent') where.push(`${alias}.visibility<>'private'`);
    if (options.audience === 'agent' && options.expertId) {
      where.push(`(${alias}.scope NOT LIKE 'expert:%' OR ${alias}.scope=?)`);
      params.push(`expert:${options.expertId}`);
    } else if (options.audience === 'agent') {
      where.push(`${alias}.scope NOT LIKE 'expert:%'`);
    }
    if (options.itemTypes?.length) {
      where.push(`${alias}.type IN (${options.itemTypes.map(() => '?').join(',')})`);
      params.push(...options.itemTypes);
    }
    return { sql: where.join(' AND '), params };
  }

  function ftsRows(expression, options, limit) {
    const docTypes = options.docTypes;
    if (!docTypes.length) return [];
    const typeMarks = docTypes.map(() => '?').join(',');
    const scope = scopeClause('project_id', options.scopeValues);
    const visibility = itemVisibilitySql(options, 'i');
    const params = [expression, ...docTypes, ...scope.params, ...visibility.params, limit];
    return db.prepare(`SELECT doc_type, doc_id, bm25(rb_fts, 0, 0, 0, 2.0, 1.0) AS score
      FROM rb_fts
      WHERE rb_fts MATCH ? AND doc_type IN (${typeMarks}) AND ${scope.sql}
        AND (doc_type<>'item' OR EXISTS (SELECT 1 FROM rb_items i WHERE i.id=rb_fts.doc_id AND ${visibility.sql}))
      ORDER BY score LIMIT ?`).all(...params);
  }

  function normalizedOptions(options = {}) {
    const docTypes = options.docTypes === undefined ? ['chunk', 'source', 'item'] : options.docTypes;
    if (!Array.isArray(docTypes) || docTypes.some((type) => !REF_TYPES.has(type))) throw new ResearchBaseError('INVALID_TYPES', '检索类型无效。');
    const itemTypes = options.itemTypes === undefined ? undefined : options.itemTypes;
    if (itemTypes !== undefined && (!Array.isArray(itemTypes) || itemTypes.some((type) => typeof type !== 'string' || !type))) {
      throw new ResearchBaseError('INVALID_TYPES', '条目类型无效。');
    }
    return {
      ...options,
      docTypes: [...new Set(docTypes)],
      itemTypes: itemTypes ? [...new Set(itemTypes)] : undefined,
      projectId: options.projectId ?? null,
      includePersonal: options.includePersonal !== false,
      audience: options.audience ?? 'user',
      includeSuperseded: options.includeSuperseded === true,
      scopeValues: normalizeScope(options),
    };
  }

  function keywordSearch(query, options, k) {
    const seen = new Map();
    for (const mode of ['all', 'any']) {
      const expression = matchExpression(query, mode); if (!expression) break;
      for (const row of ftsRows(expression, options, k * 6)) {
        const key = `${row.doc_type}:${row.doc_id}`;
        if (!seen.has(key)) seen.set(key, { ...row, mode, rank: seen.size });
      }
      if (seen.size >= k * 2) break;
    }
    const hits = [];
    for (const row of seen.values()) {
      const hit = hydrate(row, query, options);
      if (!hit) continue;
      hit.score = 1 / (HYBRID_RRF_K + row.rank) + (row.mode === 'all' ? 0.01 : 0) + (hit.item ? (hit.item.pinned ? 0.004 : 0) + hit.item.importance * 0.0005 : 0);
      hits.push(hit);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  const searchOptionsKey = hybridRefKey;

  function normalizeQueries({ query, queries } = {}) {
    try { return normalizeHybridQueries({ query, queries }); }
    catch (error) { throw new ResearchBaseError('INVALID_QUERY', error.message); }
  }

  function listCandidates(input = {}) {
    const options = normalizedOptions(input);
    const scope = scopeClause("ifnull(project_id,'')", options.scopeValues);
    const candidates = [];
    if (options.docTypes.includes('source')) {
      const rows = db.prepare(`SELECT id,updated_at FROM rb_sources WHERE ${scope.sql}`).all(...scope.params);
      for (const row of rows) candidates.push({ ref: { type: 'source', id: row.id }, version: row.updated_at });
    }
    if (options.docTypes.includes('chunk')) {
      const rows = db.prepare(`SELECT c.id,s.updated_at FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id WHERE ${scope.sql.replaceAll("ifnull(project_id,'')", "ifnull(s.project_id,'')")}`)
        .all(...scope.params);
      for (const row of rows) candidates.push({ ref: { type: 'chunk', id: row.id }, version: row.updated_at });
    }
    if (options.docTypes.includes('item')) {
      const visibility = itemVisibilitySql(options, 'i');
      const rows = db.prepare(`SELECT i.id,i.revision FROM rb_items i WHERE ${scope.sql.replaceAll("ifnull(project_id,'')", "ifnull(i.project_id,'')")} AND ${visibility.sql}`)
        .all(...scope.params, ...visibility.params);
      for (const row of rows) candidates.push({ ref: { type: 'item', id: row.id }, version: String(row.revision) });
    }
    return candidates.sort((a, b) => {
      const left = searchOptionsKey(a.ref);
      const right = searchOptionsKey(b.ref);
      return left < right ? -1 : left > right ? 1 : 0;
    });
  }

  /**
   * @param {{query:string, docTypes?:('chunk'|'source'|'item')[], itemTypes?:string[], projectId?:string|null,
   *   includePersonal?:boolean, audience?:'user'|'agent', expertId?:string, includeSuperseded?:boolean, k?:number}} input
   */
  function search(input = {}) {
    const { query } = input;
    if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new ResearchBaseError('INVALID_QUERY', '请输入 1–2000 个字符的检索词。');
    const options = normalizedOptions(input);
    const k = Math.max(1, Math.min(50, Number(input.k) || 8));
    return keywordSearch(query.trim(), options, k);
  }

  function setVectorRetriever(retriever) {
    if (retriever !== null && (!retriever || typeof retriever.search !== 'function')) throw new TypeError('vector retriever must expose search() or be null');
    vectorRetriever = retriever;
  }

  async function searchHybrid(input = {}) {
    const queries = normalizeQueries(input);
    const options = normalizedOptions(input);
    const k = Math.max(1, Math.min(50, Number(input.k) || 8));
    const vectorStartedAt = performance.now();
    const candidates = listCandidates(options);
    const allowed = new Set(candidates.map(({ ref }) => searchOptionsKey(ref)));
    const vectorRetrieverAtStart = vectorRetriever;
    let vectorRankings = [];
    let fallbackReason;

    if (!vectorRetrieverAtStart) {
      fallbackReason = 'model-missing';
    } else {
      let phase;
      try {
        phase = await runVectorPhase({
          search: (request) => vectorRetrieverAtStart.search(request),
          queries, candidates, limit: HYBRID_VECTOR_LIMIT,
          timeoutMs: Math.max(0, HYBRID_VECTOR_TIMEOUT_MS - (performance.now() - vectorStartedAt)),
        });
      } catch (error) {
        phase = { result: { fallbackReason: HYBRID_FALLBACK_REASONS.includes(error?.code) ? error.code : 'model-missing' } };
      }
      const response = phase?.result;
      if (phase?.timedOut) {
        fallbackReason = 'timeout';
      } else if (response?.fallbackReason) {
        fallbackReason = HYBRID_FALLBACK_REASONS.includes(response.fallbackReason) ? response.fallbackReason : 'model-missing';
      } else if (!Array.isArray(response?.rankings)) {
        fallbackReason = 'index-incomplete';
      } else {
        vectorRankings = response.rankings;
      }
    }

    const keywordRankings = [];
    for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
      keywordRankings.push(keywordSearch(queries[queryIndex], options, HYBRID_VECTOR_LIMIT));
    }

    const results = fuseHybridRankings({ vectorRankings, keywordRankings, allowedRefs: allowed, limit: k, k: HYBRID_RRF_K })
      .map(({ ref, score, hit }) => {
        const hydrated = hit ?? hydrateRef(ref, queries[0], options);
        return hydrated ? { ...hydrated, score } : null;
      }).filter(Boolean);
    return { hits: results, mode: fallbackReason ? 'keyword' : 'hybrid', ...(fallbackReason ? { fallbackReason } : {}) };
  }

  function hydrateRef(ref, query, options) {
    if (ref.type === 'item') return hydrate({ doc_type: 'item', doc_id: ref.id }, query, options);
    if (ref.type === 'source') return hydrate({ doc_type: 'source', doc_id: ref.id }, query, options);
    if (ref.type === 'chunk') return hydrate({ doc_type: 'chunk', doc_id: ref.id }, query, options);
    return null;
  }

  function hydrate(row, query, options) {
    if (row.doc_type === 'chunk') {
      const chunk = store.getChunk(row.doc_id); if (!chunk) return null;
      const source = store.getSource(chunk.sourceId); if (!source) return null;
      return { ref: { type: 'chunk', id: chunk.id }, cite: citeOf.chunk(source, chunk), title: source.title, section: chunk.section, page: chunk.page, snippet: snippet(chunk.text, query), source: sourceBrief(source) };
    }
    if (row.doc_type === 'source') {
      const source = store.getSource(row.doc_id); if (!source) return null;
      return { ref: { type: 'source', id: source.id }, cite: citeOf.source(source), title: source.title, snippet: snippet(source.abstract || source.title, query), source: sourceBrief(source) };
    }
    const item = store.getItem(row.doc_id);
    if (!item || !visible(item, options) || (options.itemTypes?.length && !options.itemTypes.includes(item.type))) return null;
    return { ref: { type: 'item', id: item.id }, cite: citeOf.item(item), title: item.title, snippet: snippet(`${item.body}`, query), item: itemBrief(item) };
  }

  /** Bounded reading window. Sources read by page or passage ordinal. */
  function read({ ref, page, toPage, fromOrdinal, maxChars = 6000, audience = 'user', expertId } = {}) {
    maxChars = Math.max(500, Math.min(20000, Number(maxChars) || 6000));
    if (!ref?.type || typeof ref.id !== 'string') throw new ResearchBaseError('INVALID_REF', '请提供要阅读的记录。');
    if (toPage != null && ref.type !== 'source') throw new ResearchBaseError('INVALID_CITATION', '引用页码范围需要来源 ref。');
    if (ref.type === 'item') {
      const item = resolveItem(ref.id);
      if (!item || !visible(item, { audience, expertId, includeSuperseded: true })) throw new ResearchBaseError('NOT_FOUND', '条目不存在或不可见。', 404);
      const links = store.linksOf({ type: 'item', id: item.id });
      return { ref: { type: 'item', id: item.id }, cite: citeOf.item(item), item: itemBrief(item), body: item.body, payload: item.payload, links: links.map((l) => ({ relation: l.relation, from: l.from, to: l.to, quote: l.quote, note: l.note })) };
    }
    const blockOf = (chunk, previous) => `${chunk.page && chunk.page !== previous?.page ? `\n[p.${chunk.page}]\n` : ''}${chunk.section && chunk.section !== previous?.section ? `## ${chunk.section}\n` : ''}${chunk.text}\n`;
    let source; let chunks;
    if (ref.type === 'chunk') {
      const chunk = store.getChunk(ref.id); if (!chunk) throw new ResearchBaseError('NOT_FOUND', '段落不存在。', 404);
      source = store.getSource(chunk.sourceId);
      chunks = store.chunksOf(source.id, { fromOrdinal: Math.max(0, chunk.ordinal - 1), limit: 40 });
      // Reserve the selected passage before admitting its predecessor. If
      // both cannot fit, start at the selection so a large neighbor cannot
      // replace the requested evidence. Otherwise keep chronological context.
      if (chunks[0]?.ordinal < chunk.ordinal && blockOf(chunks[0]).length + blockOf(chunk, chunks[0]).length > maxChars) {
        chunks = chunks.filter(candidate => candidate.ordinal >= chunk.ordinal);
      }
    } else if (ref.type === 'source') {
      source = store.getSource(ref.id) ?? null;
      if (!source) throw new ResearchBaseError('NOT_FOUND', '来源不存在。', 404);
      if (toPage != null) {
        if (!Number.isSafeInteger(Number(page)) || Number(page) < 1 || !Number.isSafeInteger(Number(toPage)) || Number(toPage) < Number(page)) {
          throw new ResearchBaseError('INVALID_CITATION', '引用页码范围无效。');
        }
        // One bounded query, even for a very large range; no loop per page.
        chunks = db.prepare('SELECT id FROM rb_chunks WHERE source_id=? AND page>=? AND page<=? AND ordinal>=? ORDER BY ordinal LIMIT 400')
          .all(source.id, Number(page), Number(toPage), Math.max(0, Number(fromOrdinal) || 0)).map(row => store.getChunk(row.id));
      } else chunks = store.chunksOf(source.id, page != null ? { page: Number(page), limit: 400 } : { fromOrdinal: Number(fromOrdinal) || 0, limit: 200 });
    } else throw new ResearchBaseError('INVALID_REF', '只能阅读来源、段落或条目。');
    const parts = []; let used = 0; let last = null;
    for (const chunk of chunks) {
      const block = blockOf(chunk, last);
      const size = block.length + (parts.length ? 1 : 0);
      if (used + size > maxChars && parts.length) break;
      parts.push(block); used += size; last = chunk;
    }
    const range = toPage == null ? {} : { fromPage: Number(page), toPage: Number(toPage), readPages: [...new Set(chunks.slice(0, parts.length).map(chunk => chunk.page))],
      truncated: last ? Boolean(db.prepare('SELECT 1 FROM rb_chunks WHERE source_id=? AND page>=? AND page<=? AND ordinal>? LIMIT 1').get(source.id, Number(page), Number(toPage), last.ordinal)) : false };
    const cite = toPage == null ? citeOf.source(source) : `[${source.label} p.${Number(page)}${Number(page) !== Number(toPage) ? `–${Number(toPage)}` : ''}]`;
    return { ref: { type: 'source', id: source.id }, cite, source: sourceBrief(source), contentStatus: source.contentStatus, text: parts.join('\n').trim(), nextOrdinal: last ? last.ordinal + 1 : null, pages: source.pages, ...range };
  }

  /** Resolve every explicit member; unknown members stay inspectable. */
  function resolveCitations(label, { projectId = null } = {}) {
    const parsed = parseCitationLabel(label); const citations = []; const unrecognized = [...parsed.unrecognized];
    for (const member of parsed.citations) {
      let resolved;
      if (member.kind === 'source') {
        const source = store.sourceByLabel(projectId, member.number) ?? store.sourceByLabel(null, member.number);
        if (source) {
          const page = member.fromPage;
          const chunk = page ? store.chunksOf(source.id, { page, limit: 1 })[0] : null;
          resolved = { ref: chunk ? { type: 'chunk', id: chunk.id } : { type: 'source', id: source.id }, source: sourceBrief(source), page,
            fromPage: member.fromPage, toPage: member.toPage };
        }
      } else {
        const item = resolveItem(member.handle);
        if (item) resolved = { ref: { type: 'item', id: item.id }, item: itemBrief(item) };
      }
      if (resolved) citations.push({ ...resolved, raw: member.raw, normalized: member.normalized });
      else unrecognized.push({ raw: member.raw, reason: 'not-found' });
    }
    const parseStatus = unrecognized.length ? (citations.length ? 'partial' : 'unrecognized') : 'parsed';
    return { citation: parseStatus === 'parsed' && citations.length === 1 ? citations[0] : null, citations, raw: parsed.raw, parseStatus, unrecognized };
  }
  /** Legacy single-member callers never silently select a compound member. */
  const resolveCitation = (label, options) => resolveCitations(label, options).citation;
  function resolveItem(handle) {
    if (/^itm_/u.test(handle)) return store.getItem(handle);
    const rows = db.prepare('SELECT id FROM rb_items WHERE id LIKE ? LIMIT 2').all(`itm_${handle.replace(/[^0-9a-f]/gu, '')}%`);
    return rows.length === 1 ? store.getItem(rows[0].id) : null;
  }

  /**
   * Project brief: the always-in-context core memory (Letta-style blocks),
   * rendered from active, shared items within a character budget. Priority:
   * pinned → importance → recency. Returns text plus the refs used.
   */
  function brief({ projectId = null, expertId = null, budget = 3500 } = {}) {
    const blocks = [
      { title: '用户偏好与背景', pick: (i) => i.scope === 'personal' && i.type === 'memory' && ['preference', 'profile'].includes(i.subtype) },
      { title: '研究问题与目标', pick: (i) => i.type === 'memory' && i.subtype === 'goal' },
      { title: '当前假设与主张', pick: (i) => i.type === 'claim' },
      { title: '已做的决定', pick: (i) => i.type === 'memory' && i.subtype === 'decision' },
      { title: '术语与约定', pick: (i) => (i.type === 'memory' && i.subtype === 'convention') || (i.type === 'knowledge' && i.subtype === 'definition' && i.pinned) },
      { title: '待解决的问题', pick: (i) => i.type === 'memory' && i.subtype === 'open-question' },
      { title: '经验（本专家）', pick: (i) => expertId && i.scope === `expert:${expertId}` },
      { title: '固定的知识与模型', pick: (i) => i.pinned && ['knowledge', 'model'].includes(i.type) && i.subtype !== 'definition' },
    ];
    const pool = store.listItems({ projectId: projectId ?? null, includePersonal: true, status: 'active', limit: 400 })
      .filter((i) => visible(i, { audience: 'agent', expertId, includeSuperseded: false }));
    const used = new Set(); const refs = []; const sections = []; let size = 0;
    for (const block of blocks) {
      const lines = [];
      for (const item of pool.filter((i) => !used.has(i.id) && block.pick(i))) {
        const status = item.type === 'claim' && item.payload.claimStatus ? `（${item.payload.claimStatus}）` : '';
        const body = item.body.replace(/\s+/gu, ' ').trim();
        const line = `- ${item.title}${status}${body ? `：${body.length > 200 ? body.slice(0, 200) + '…' : body}` : ''} ${citeOf.item(item)}`;
        if (size + line.length > budget) break;
        lines.push(line); used.add(item.id); refs.push({ type: 'item', id: item.id }); size += line.length + 1;
      }
      if (lines.length) sections.push(`### ${block.title}\n${lines.join('\n')}`);
    }
    const text = sections.length ? `[ScienceScope project brief — the user's confirmed long-term memory for this work. Cite entries by their [@id]. Propose changes with research_propose; never assume an entry changed unless the user confirms.]\n${sections.join('\n\n')}` : '';
    return { text, refs };
  }

  return { search, searchHybrid, setVectorRetriever, listCandidates, read, resolveCitation, resolveCitations, resolveItem, brief };
}

const sourceBrief = (s) => ({ id: s.id, label: s.label, title: s.title, kind: s.kind, authors: s.authors.slice(0, 6).map((a) => a.literal || [a.given, a.family].filter(Boolean).join(' ')), year: s.year, venue: s.venue, doi: s.doi, contentStatus: s.contentStatus, resourceId: s.resourceId });
const itemBrief = (i) => ({ id: i.id, handle: itemHandle(i.id), type: i.type, subtype: i.subtype, title: i.title, status: i.status, scope: i.scope, pinned: i.pinned, importance: i.importance, claimStatus: i.payload?.claimStatus ?? null, supersededBy: i.supersededBy });
