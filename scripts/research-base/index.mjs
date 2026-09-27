// Research Base facade: store + retrieval + ingest + HTTP routes + agent tool
// calls. desktop-api.mjs mounts `handleGet`/`handlePost` for /api/research/*
// and routes DSH tool calls (research_search / research_read /
// research_propose) through `toolCall`. Design: docs/design/RESEARCH_BASE.md.
import { createResearchStore, ResearchBaseError } from './store.mjs';
import { createResearchSearch } from './search.mjs';
import { createIngestor } from './ingest.mjs';
import { supportedExtensions } from './parsers/index.mjs';

export { ResearchBaseError };

// Tool contract shared with adapters/runtime-dsh/session-control.mjs.
export const RESEARCH_TOOLS = Object.freeze(['research_search', 'research_read', 'research_propose']);

export function createResearchBase({ database, resolveResourcePath, onProgress }) {
  const store = createResearchStore({ db: database.db });
  const retrieval = createResearchSearch({ store });
  const ingest = createIngestor({ store, database, resolveResourcePath, onProgress });

  // The pre-2026-09-25 `knowledge` table is mirrored once per row (legacy_id),
  // so knowledge proposed through the old library page is not lost.
  function syncLegacyKnowledge() {
    const rows = database.db.prepare('SELECT k.* FROM knowledge k LEFT JOIN rb_items i ON i.legacy_id = k.id WHERE i.id IS NULL LIMIT 500').all();
    for (const row of rows) {
      const map = { canonical: ['knowledge', 'finding', 'shared'], heuristic: ['memory', 'lesson', 'shared'], private: ['memory', 'preference', 'private'] }[row.namespace];
      const item = store.createItem({ type: map[0], subtype: map[1], visibility: map[2], projectId: row.project_id ?? null, title: row.title.slice(0, 300), body: row.content },
        { status: row.status === 'accepted' ? 'active' : 'proposed', createdBy: 'import:knowledge', legacyId: row.id });
      for (const resourceId of JSON.parse(row.source_ids_json || '[]')) {
        const source = store.sourceByResource(resourceId);
        if (source) store.link({ from: { type: 'item', id: item.id }, to: { type: 'source', id: source.id }, relation: 'derived-from' }, { createdBy: 'import:knowledge' });
      }
    }
    return rows.length;
  }
  syncLegacyKnowledge();

  /** Catalog existing library resources without re-queuing historical parsing. */
  async function registerResources() {
    const rows = database.db.prepare("SELECT r.id FROM resources r WHERE NOT EXISTS (SELECT 1 FROM rb_sources s WHERE s.resource_id=r.id) ORDER BY r.id").all();
    for (const row of rows) await ingest.ensureSource(row.id);
    return rows.length;
  }

  const param = (url, name) => url.searchParams.get(name) ?? undefined;
  const projectParam = (url) => (url.searchParams.has('projectId') ? url.searchParams.get('projectId') || null : undefined);
  const bool = (value) => (value === undefined ? undefined : value === 'true' || value === '1');

  /** GET /api/research/* → body, or undefined when the route is not ours. */
  async function handleGet(route, url) {
    switch (route) {
      case '/api/research/sources': {
        const filters = { projectId: projectParam(url), kind: param(url, 'kind'), readStatus: param(url, 'readStatus'), tag: param(url, 'tag') };
        const requestedLimit = Number(param(url, 'limit') ?? 100); const requestedOffset = Number(param(url, 'offset') ?? 0);
        const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));
        const offset = Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0);
        const sources = store.listSources({ ...filters, limit, offset, sort: param(url, 'sort') ?? 'addedAt', direction: param(url, 'direction') ?? 'desc' });
        const total = store.countSources(filters);
        return { sources, total, limit, offset, hasMore: offset + sources.length < total };
      }
      case '/api/research/source': {
        const source = store.getSource(String(param(url, 'id') ?? ''));
        if (!source) throw new ResearchBaseError('SOURCE_NOT_FOUND', '来源不存在。', 404);
        const passages = store.db.prepare('SELECT count(*) n FROM rb_chunks WHERE source_id=?').get(source.id).n;
        return { source, passages, links: store.linksOf({ type: 'source', id: source.id }) };
      }
      case '/api/research/search': return { hits: retrieval.search({ query: String(param(url, 'q') ?? ''), projectId: projectParam(url) ?? null, docTypes: param(url, 'types')?.split(',').filter(Boolean), itemTypes: param(url, 'itemTypes')?.split(',').filter(Boolean), includeSuperseded: bool(param(url, 'includeSuperseded')), k: Number(param(url, 'k') ?? 20) }) };
      case '/api/research/items': return { items: store.listItems({ projectId: projectParam(url), type: param(url, 'type'), subtype: param(url, 'subtype'), status: param(url, 'status') ?? 'active', scope: param(url, 'scope'), pinned: bool(param(url, 'pinned')), limit: Number(param(url, 'limit') ?? 100), offset: Number(param(url, 'offset') ?? 0) }).map((item) => ({ ...item, evidenceCount: store.evidenceCount(item.id) })) };
      case '/api/research/item': {
        const item = retrieval.resolveItem(String(param(url, 'id') ?? ''));
        if (!item) throw new ResearchBaseError('ITEM_NOT_FOUND', '条目不存在。', 404);
        return { item: { ...item, evidenceCount: store.evidenceCount(item.id) }, links: store.linksOf({ type: 'item', id: item.id }), revisions: store.revisionsOf(item.id) };
      }
      case '/api/research/proposals': return { proposals: store.listProposals({ projectId: projectParam(url), status: param(url, 'status') ?? 'pending' }) };
      case '/api/research/brief': return retrieval.brief({ projectId: projectParam(url) ?? null, expertId: param(url, 'expertId') ?? null });
      case '/api/research/cite': return { citation: retrieval.resolveCitation(String(param(url, 'label') ?? ''), { projectId: projectParam(url) ?? null }) };
      case '/api/research/usage': return { refs: store.usageOf(String(param(url, 'chatId') ?? ''), String(param(url, 'messageId') ?? '')) };
      case '/api/research/formats': return { extensions: supportedExtensions() };
      default: return undefined;
    }
  }

  /** POST /api/research/* → body, or undefined when the route is not ours. */
  async function handlePost(route, input) {
    switch (route) {
      case '/api/research/sources': return { source: store.addSource(input.source ?? {}) };
      case '/api/research/sources/update': return { source: store.updateSource(input.id, input.patch ?? {}) };
      case '/api/research/sources/remove': return { removed: store.removeSource(String(input.id ?? '')) };
      case '/api/research/sources/ingest': {
        const source = input.resourceId ? await ingest.ensureSource(input.resourceId) : store.getSource(String(input.id ?? ''));
        if (!source) throw new ResearchBaseError('SOURCE_NOT_FOUND', '来源不存在。', 404);
        const job = ingest.enqueue(source.id);
        return { source: input.wait ? await job : store.getSource(source.id) };
      }
      case '/api/research/sync': { const result = await ingest.syncResources({ projectId: input.projectId ?? null }); if (input.wait) { await result.done; await ingest.idle(); } return { total: result.total, queued: result.queued }; }
      case '/api/research/read': return retrieval.read({ ref: input.ref, page: input.page, fromOrdinal: input.fromOrdinal, maxChars: input.maxChars });
      case '/api/research/items': return { item: store.createItem(input.item ?? {}, { createdBy: 'user' }) };
      case '/api/research/items/update': return { item: store.updateItem(input.id, input.patch ?? {}, { changedBy: 'user' }) };
      case '/api/research/items/supersede': return store.supersedeItem(input.id, input.item ?? {}, { createdBy: 'user', expectedRevision: input.expectedRevision });
      case '/api/research/links': return { link: store.link(input.link ?? {}, { createdBy: 'user' }) };
      case '/api/research/links/remove': return { removed: store.unlink(input.id) };
      case '/api/research/proposals/decide': return store.decide(input.id, { accept: input.accept === true, edits: input.edits ?? null, decidedBy: 'user' });
      default: return undefined;
    }
  }

  /**
   * An agent's tool call, already bound to its chat by the host: `context` is
   * {chatId, projectId, role:'main'|'expert'|'secretary'|'global', expertId?}.
   * Results are compact JSON meant for a model; every passage carries a
   * citation label the answer must reuse.
   */
  async function toolCall(name, args = {}, context = {}) {
    const agent = { audience: 'agent', expertId: context.expertId ?? undefined };
    if (name === 'research_search') {
      const hits = retrieval.search({ query: String(args.query ?? ''), projectId: context.projectId ?? null, docTypes: args.types?.length ? args.types : undefined, itemTypes: args.itemTypes, k: args.limit ?? 8, ...agent });
      if (context.chatId && context.messageId) store.recordUsage({ chatId: context.chatId, messageId: context.messageId, refs: hits.map((h) => h.ref), how: 'search' });
      return { hits: hits.map((h) => ({ cite: h.cite, ref: h.ref, title: h.title, section: h.section ?? undefined, page: h.page ?? undefined, snippet: h.snippet, ...(h.item ? { type: h.item.type, subtype: h.item.subtype, status: h.item.claimStatus ?? h.item.status } : {}) })), hint: hits.length ? 'Cite passages with their cite label, e.g. [S3 p.4]. Use research_read for the full text.' : 'No match. Try other keywords or synonyms.' };
    }
    if (name === 'research_read') {
      const result = retrieval.read({ ref: args.ref ?? parseCite(args.cite, retrieval, context.projectId), page: args.page, fromOrdinal: args.fromOrdinal, maxChars: args.maxChars ?? 6000, ...agent });
      if (context.chatId && context.messageId) store.recordUsage({ chatId: context.chatId, messageId: context.messageId, refs: [result.ref], how: 'read' });
      return result;
    }
    if (name === 'research_propose') {
      const origin = { chatId: context.chatId ?? null, messageId: context.messageId ?? null, role: context.role ?? null, expertId: context.expertId ?? null, toolCallId: context.callId ?? null };
      // The session, not the model, decides the project. A chat outside any
      // project can only hold personal records; say so instead of failing.
      const notes = [];
      let item = args.item;
      if (item && !context.projectId && item.scope !== 'personal') { item = { ...item, scope: 'personal' }; notes.push('This chat belongs to no project, so the item was proposed as personal (all projects).'); }
      if (item && context.projectId && !item.scope) item = { ...item, scope: 'project' };
      const toRef = (value) => (typeof value === 'string' ? parseCite(value, retrieval, context.projectId) : value);
      const evidence = (args.evidence ?? []).map((e) => ({ ...e, ref: toRef(e.ref ?? e.cite) })).map(({ cite, ...e }) => e);
      const proposal = store.propose({ op: args.op, targetId: args.targetId ? retrieval.resolveItem(String(args.targetId).replace(/^\[?@|\]$/gu, ''))?.id ?? args.targetId : null, payload: { item, evidence, from: args.from ? toRef(args.from) : undefined, to: args.to ? toRef(args.to) : undefined, relation: args.relation, note: args.note, quote: args.quote }, rationale: args.rationale ?? null, projectId: context.projectId ?? null }, { origin });
      return { status: 'awaiting_user_review', proposalId: proposal.id, duplicate: !!proposal.duplicate, note: ['The user will accept, edit or reject this in the memory inbox. Do not treat it as saved, and do not look for the database yourself.', ...notes].join(' ') };
    }
    throw new ResearchBaseError('UNKNOWN_TOOL', `未知的资料库工具：${name}`, 404);
  }

  return { store, retrieval, ingest, handleGet, handlePost, toolCall, syncLegacyKnowledge, registerResources };
}

function parseCite(cite, retrieval, projectId) {
  if (typeof cite !== 'string') throw new ResearchBaseError('INVALID_REF', '请提供 ref 或 cite。');
  const found = retrieval.resolveCitation(cite, { projectId: projectId ?? null });
  if (!found) throw new ResearchBaseError('NOT_FOUND', `找不到引用 ${cite}。`, 404);
  return found.ref;
}
