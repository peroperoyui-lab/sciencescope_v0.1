import { filterProject } from './records.js';

function sourceFilters(options) {
  const where = [];
  const params = [];
  filterProject('project_id', options, where, params);
  for (const [field, column] of [
    ['kind', 'kind'],
    ['contentStatus', 'content_status'],
    ['readStatus', "coalesce(json_extract(metadata_json,'$.readStatus'),'unread')"],
  ]) {
    if (options[field] !== undefined && options[field] !== '') {
      where.push(`${column} = ?`);
      params.push(options[field]);
    }
  }
  if (options.tag) {
    where.push("EXISTS (SELECT 1 FROM json_each(rb_sources.metadata_json,'$.tags') WHERE value=?)");
    params.push(options.tag);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** @param {import('../../core/db/database.js').Db} db */
export function createSourceListing(db) {
  return {
    /** @param {import('./store.js').SourceQuery} [options] */
    list(options = {}) {
      const { clause, params } = sourceFilters(options);
      const columns = {
        title: 'title COLLATE NOCASE',
        number: 'number',
        year: "json_extract(metadata_json,'$.year')",
        createdAt: 'created_at',
        updatedAt: 'updated_at',
        kind: 'kind',
        relations:
          "(SELECT count(*) FROM kb_edges e WHERE e.status='active' AND (e.from_ref='source:'||rb_sources.id OR e.to_ref='source:'||rb_sources.id))",
      };
      const sort = columns[options.sort] ?? 'created_at';
      const direction = options.direction === 'asc' ? 'ASC' : 'DESC';
      return db
        .prepare(
          `SELECT * FROM rb_sources ${clause} ORDER BY ${sort} ${direction}, number DESC, id LIMIT ? OFFSET ?`,
        )
        .all(...params, options.limit ?? -1, options.offset ?? 0);
    },
    /** @param {import('./store.js').SourceQuery} [options] */
    count(options = {}) {
      const { clause, params } = sourceFilters(options);
      return Number(
        db.prepare(`SELECT count(*) AS total FROM rb_sources ${clause}`).get(...params).total,
      );
    },
  };
}
