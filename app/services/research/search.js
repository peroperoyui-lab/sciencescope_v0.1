import { AppError } from '../../core/errors.js';
import { citationFor, parseCitationLabel } from './citations.js';
import { matchExpression } from './text-index.js';

/** @param {ReturnType<typeof import('./store.js').createResearchStore>} store */
export function createResearchSearch(store) {
  /** @param {any} item @param {any} options */
  function visible(item, options) {
    if (options.audience === 'agent' && item.visibility === 'private') return false;
    if (['proposed', 'rejected'].includes(item.status)) return false;
    if (!options.includeSuperseded && item.status !== 'active') return false;
    return true;
  }

  function scope(projectId, includePersonal) {
    return projectId ? (includePersonal ? [projectId, ''] : [projectId]) : [''];
  }

  /**
   * @param {string} query
   * @param {{projectId?:string|null,includePersonal?:boolean,audience?:'user'|'agent',includeSuperseded?:boolean,limit?:number,offset?:number}} [options]
   */
  function search(query, options = {}) {
    const limit = Math.max(1, Math.floor(options.limit ?? 10));
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const selected = scope(options.projectId, options.includePersonal !== false);
    const clauses = [
      `coalesce(project_id,'') IN (${selected.map(() => '?').join(',')})`,
      "(doc_type<>'item' OR EXISTS (SELECT 1 FROM rb_items i WHERE i.id=doc_id AND i.status NOT IN ('proposed','rejected')",
    ];
    if (!options.includeSuperseded) clauses[1] += " AND i.status='active'";
    if (options.audience === 'agent') clauses[1] += " AND i.visibility<>'private'";
    clauses[1] += '))';
    const where = clauses.join(' AND ');
    let expression = matchExpression(query);
    if (!expression) return { query, hits: [], total: 0, remaining: 0, offset, limit };
    const count = () =>
      Number(
        store.db
          .prepare(`SELECT count(*) AS n FROM rb_fts WHERE rb_fts MATCH ? AND ${where}`)
          .get(expression, ...selected).n,
      );
    let total = count();
    if (!total) {
      expression = matchExpression(query, 'any');
      total = count();
    }
    const rows = store.db
      .prepare(
        `SELECT doc_type, doc_id, bm25(rb_fts,0,0,0,2,1) AS score FROM rb_fts WHERE rb_fts MATCH ? AND ${where} ORDER BY score, doc_id LIMIT ? OFFSET ?`,
      )
      .all(expression, ...selected, limit, offset);
    const hits = rows.map((row) => {
      const id = String(row.doc_id);
      const type = String(row.doc_type);
      if (type === 'item') {
        const item = store.getItem(id);
        return {
          type,
          id,
          projectId: item.projectId,
          title: item.title,
          text: item.body,
          citation: `[@${item.id.replace(/^itm_/u, '').slice(0, 8)}]`,
          score: Number(row.score),
        };
      }
      const chunk = type === 'chunk' ? store.getChunk(id) : null;
      const source = store.getSource(chunk?.sourceId ?? id);
      return {
        type,
        id,
        sourceId: source.id,
        projectId: source.projectId,
        title: source.title,
        text: chunk?.text ?? source.metadata?.abstract ?? source.title,
        page: chunk?.page ?? null,
        ordinal: chunk?.ordinal ?? null,
        section: chunk?.section ?? null,
        citation: citationFor(source, chunk),
        score: Number(row.score),
      };
    });
    return {
      query,
      hits,
      total,
      offset,
      limit,
      remaining: Math.max(0, total - offset - hits.length),
    };
  }

  /**
   * @param {{type?:'source'|'chunk'|'item',id?:string,label?:string,projectId?:string|null,offset?:number,limit?:number,audience?:'user'|'agent',includeSuperseded?:boolean}} input
   */
  function read(input) {
    const type = input.type ?? 'source';
    if (type === 'item') {
      const item = store.getItem(input.id);
      if (!visible(item, input))
        throw new AppError('ITEM_NOT_AVAILABLE', '此条目当前不参与资料候选。', 404);
      return { item, citation: `[@${item.id.replace(/^itm_/u, '').slice(0, 8)}]`, remaining: 0 };
    }
    if (type === 'chunk') {
      const chunk = store.getChunk(input.id);
      const source = store.getSource(chunk.sourceId);
      return {
        source,
        chunks: [{ ...chunk, citation: citationFor(source, chunk) }],
        total: 1,
        remaining: 0,
      };
    }
    let source;
    let locator;
    if (input.label) {
      const parsed = parseCitationLabel(input.label);
      if (
        parsed.parseStatus !== 'parsed' ||
        parsed.citations.length !== 1 ||
        parsed.citations[0].kind !== 'source'
      ) {
        throw new AppError('UNKNOWN_CITATION', `无法定位引用：${parsed.raw}`);
      }
      [locator] = parsed.citations;
      source = store.findSource(locator.label, input.projectId ?? null);
      if (!source) throw new AppError('SOURCE_NOT_FOUND', '找不到该范围的资料来源。', 404);
    } else source = store.getSource(input.id);
    const chunks = store
      .chunks(source.id)
      .filter(
        (chunk) =>
          !locator?.fromPage || (chunk.page >= locator.fromPage && chunk.page <= locator.toPage),
      );
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const limit = Math.max(1, Math.floor(input.limit ?? 20));
    const page = chunks
      .slice(offset, offset + limit)
      .map((chunk) => ({ ...chunk, citation: citationFor(source, chunk) }));
    return {
      source,
      chunks: page,
      total: chunks.length,
      offset,
      limit,
      remaining: Math.max(0, chunks.length - offset - page.length),
    };
  }

  return { search, read };
}
