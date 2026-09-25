// Retrieval over the Research Base: one search entry for passages, sources and
// distilled items; a bounded reader; citation labels; and the project brief
// (always-in-context core memory). BM25 via FTS5 now; an optional vector
// ranker can be fused later with reciprocal-rank fusion (see RESEARCH_BASE.md).
import { matchExpression, snippet } from './text-index.mjs';
import { ResearchBaseError } from './store.mjs';

const RRF_K = 60;
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

  function ftsRows(expression, projectId, includePersonal, docTypes, limit) {
    const typeMarks = docTypes.map(() => '?').join(',');
    const projectClause = projectId ? (includePersonal ? "AND project_id IN (?, '')" : 'AND project_id=?') : "AND project_id=''";
    const params = [expression, ...docTypes, ...(projectId ? [projectId] : []), limit];
    return db.prepare(`SELECT doc_type, doc_id, bm25(rb_fts, 0, 0, 0, 2.0, 1.0) AS score FROM rb_fts WHERE rb_fts MATCH ? AND doc_type IN (${typeMarks}) ${projectClause} ORDER BY score LIMIT ?`).all(...params);
  }

  /**
   * @param {{query:string, docTypes?:('chunk'|'source'|'item')[], itemTypes?:string[], projectId?:string|null,
   *   includePersonal?:boolean, audience?:'user'|'agent', expertId?:string, includeSuperseded?:boolean, k?:number}} input
   */
  function search({ query, docTypes = ['chunk', 'source', 'item'], itemTypes, projectId = null, includePersonal = true, audience = 'user', expertId, includeSuperseded = false, k = 8 } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new ResearchBaseError('INVALID_QUERY', '请输入 1–2000 个字符的检索词。');
    k = Math.max(1, Math.min(50, Number(k) || 8));
    const seen = new Map();
    for (const mode of ['all', 'any']) {
      const expression = matchExpression(query, mode); if (!expression) break;
      for (const row of ftsRows(expression, projectId, includePersonal, docTypes, k * 6)) {
        const key = `${row.doc_type}:${row.doc_id}`;
        if (!seen.has(key)) seen.set(key, { ...row, mode, rank: seen.size });
      }
      if (seen.size >= k * 2) break;
    }
    const hits = [];
    for (const row of seen.values()) {
      const hit = hydrate(row, query, { audience, expertId, includeSuperseded, itemTypes });
      if (!hit) continue;
      // Phrase (all-terms) matches outrank any-term matches; items get a small
      // pinned/importance nudge (memory relevance + importance, Park et al.).
      hit.score = 1 / (RRF_K + row.rank) + (row.mode === 'all' ? 0.01 : 0) + (hit.item ? (hit.item.pinned ? 0.004 : 0) + hit.item.importance * 0.0005 : 0);
      hits.push(hit);
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
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
  function read({ ref, page, fromOrdinal, maxChars = 6000, audience = 'user', expertId } = {}) {
    maxChars = Math.max(500, Math.min(20000, Number(maxChars) || 6000));
    if (!ref?.type || typeof ref.id !== 'string') throw new ResearchBaseError('INVALID_REF', '请提供要阅读的记录。');
    if (ref.type === 'item') {
      const item = resolveItem(ref.id);
      if (!item || !visible(item, { audience, expertId, includeSuperseded: true })) throw new ResearchBaseError('NOT_FOUND', '条目不存在或不可见。', 404);
      const links = store.linksOf({ type: 'item', id: item.id });
      return { ref: { type: 'item', id: item.id }, cite: citeOf.item(item), item: itemBrief(item), body: item.body, payload: item.payload, links: links.map((l) => ({ relation: l.relation, from: l.from, to: l.to, quote: l.quote, note: l.note })) };
    }
    let source; let chunks;
    if (ref.type === 'chunk') {
      const chunk = store.getChunk(ref.id); if (!chunk) throw new ResearchBaseError('NOT_FOUND', '段落不存在。', 404);
      source = store.getSource(chunk.sourceId);
      chunks = store.chunksOf(source.id, { fromOrdinal: Math.max(0, chunk.ordinal - 1), limit: 40 });
    } else if (ref.type === 'source') {
      source = store.getSource(ref.id) ?? null;
      if (!source) throw new ResearchBaseError('NOT_FOUND', '来源不存在。', 404);
      chunks = store.chunksOf(source.id, page != null ? { page: Number(page), limit: 400 } : { fromOrdinal: Number(fromOrdinal) || 0, limit: 200 });
    } else throw new ResearchBaseError('INVALID_REF', '只能阅读来源、段落或条目。');
    const parts = []; let used = 0; let last = null;
    for (const chunk of chunks) {
      const block = `${chunk.page && chunk.page !== last?.page ? `\n[p.${chunk.page}]\n` : ''}${chunk.section && chunk.section !== last?.section ? `## ${chunk.section}\n` : ''}${chunk.text}\n`;
      if (used + block.length > maxChars && parts.length) break;
      parts.push(block); used += block.length; last = chunk;
    }
    return { ref: { type: 'source', id: source.id }, cite: citeOf.source(source), source: sourceBrief(source), contentStatus: source.contentStatus, text: parts.join('\n').trim(), nextOrdinal: last ? last.ordinal + 1 : null, pages: source.pages };
  }

  /** "[S3 p.4]" / "[S3]" / "[@a1b2c3d4]" → record reference, for UI chips. */
  function resolveCitation(label, { projectId = null } = {}) {
    const s = /^\[?S(\d+)(?:\s*p\.(\d+))?\]?$/u.exec(label.trim());
    if (s) {
      const source = store.sourceByLabel(projectId, Number(s[1])) ?? store.sourceByLabel(null, Number(s[1]));
      if (!source) return null;
      const page = s[2] ? Number(s[2]) : null;
      const chunk = page ? store.chunksOf(source.id, { page, limit: 1 })[0] : null;
      return { ref: chunk ? { type: 'chunk', id: chunk.id } : { type: 'source', id: source.id }, source: sourceBrief(source), page };
    }
    const m = /^\[?@([0-9a-f]{6,20})\]?$/u.exec(label.trim());
    if (m) { const item = resolveItem(m[1]); return item ? { ref: { type: 'item', id: item.id }, item: itemBrief(item) } : null; }
    return null;
  }
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

  return { search, read, resolveCitation, resolveItem, brief };
}

const sourceBrief = (s) => ({ id: s.id, label: s.label, title: s.title, kind: s.kind, authors: s.authors.slice(0, 6).map((a) => a.literal || [a.given, a.family].filter(Boolean).join(' ')), year: s.year, venue: s.venue, doi: s.doi, contentStatus: s.contentStatus, resourceId: s.resourceId });
const itemBrief = (i) => ({ id: i.id, handle: itemHandle(i.id), type: i.type, subtype: i.subtype, title: i.title, status: i.status, scope: i.scope, pinned: i.pinned, importance: i.importance, claimStatus: i.payload?.claimStatus ?? null, supersededBy: i.supersededBy });
