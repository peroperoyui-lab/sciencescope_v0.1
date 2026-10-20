import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { indexText } from './text-index.js';
import { createResearchItems } from './items.js';
import { createSourceListing } from './source-listing.js';
import { oneOf, payloadText, recordObject, requiredText } from './records.js';

const sourceKinds = [
  'paper',
  'preprint',
  'book',
  'chapter',
  'thesis',
  'report',
  'webpage',
  'dataset',
  'software',
  'file',
  'note',
  'link',
];
const contentStatuses = [
  'none',
  'queued',
  'parsed',
  'partial',
  'failed',
  'unsupported',
  'name-only',
];
const chunkKinds = [
  'paragraph',
  'heading',
  'caption',
  'table',
  'equation',
  'code',
  'list',
  'reference',
  'abstract',
];

/**
 * @typedef {ReturnType<typeof sourceRow>} ResearchSource
 * @typedef {ReturnType<typeof chunkRow>} ResearchChunk
 * @typedef {import('../../core/workspace/workspace.js').Actor} Actor
 * @typedef {{ projectId?: string | null, includePersonal?: boolean, kind?: string,
 *   contentStatus?: string, readStatus?:string, tag?:string, sort?:string, direction?:string,
 *   limit?: number, offset?: number }} SourceQuery
 * @typedef {{ parser?: string, pages?: number | null, contentStatus?: string,
 *   parseError?: string | null, metadata?: any }} ParseResult
 * @typedef {ReturnType<typeof createResearchItems> & {
 *   db: import('../../core/db/database.js').Db,
 *   createSource: (input: any, actor?: Actor) => ResearchSource,
 *   getSource: (id: string) => ResearchSource,
 *   listSources: (options?: SourceQuery) => ResearchSource[],
 *   countSources: (options?: SourceQuery) => number,
 *   updateSource: (id:string,patch:any,actor?:Actor) => ResearchSource,
 *   findSource: (label: string, projectId?: string | null) => ResearchSource | null,
 *   addChunks: (sourceId: string, passages: any[], parseResult?: ParseResult, actor?: Actor) => ResearchSource,
 *   getChunk: (id: string) => ResearchChunk,
 *   chunks: (sourceId: string) => ResearchChunk[] }} ResearchStore
 */

function sourceRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    projectId: row.project_id == null ? null : String(row.project_id),
    number: Number(row.number),
    label: `S${row.number}`,
    kind: String(row.kind),
    title: String(row.title),
    metadata: JSON.parse(String(row.metadata_json)),
    originalPath: row.original_path == null ? null : String(row.original_path),
    folderPath: row.folder_path == null ? null : String(row.folder_path),
    fileSize: row.file_size == null ? null : Number(row.file_size),
    fileMtimeMs: row.file_mtime_ms == null ? null : Number(row.file_mtime_ms),
    contentHash: row.content_hash == null ? null : String(row.content_hash),
    name: row.name == null ? null : String(row.name),
    mime: row.mime == null ? null : String(row.mime),
    contentStatus: String(row.content_status),
    parser: row.parser == null ? null : String(row.parser),
    parseError: row.parse_error == null ? null : String(row.parse_error),
    pages: row.pages == null ? null : Number(row.pages),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function chunkRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    ordinal: Number(row.ordinal),
    page: row.page == null ? null : Number(row.page),
    section: row.section == null ? null : String(row.section),
    kind: String(row.kind),
    text: String(row.text),
    charStart: row.char_start == null ? null : Number(row.char_start),
    charEnd: row.char_end == null ? null : Number(row.char_end),
    anchor: row.anchor_json == null ? null : JSON.parse(String(row.anchor_json)),
  };
}

/**
 * @param {{ db: import('../../core/db/database.js').Db,
 *   events: ReturnType<typeof import('../../core/events.js').createEvents>,
 *   now?: () => string, newId?: (prefix: string) => string }} deps
 * @returns {ResearchStore}
 */
export function createResearchStore({
  db,
  events,
  now = () => new Date().toISOString(),
  newId = (prefix) => `${prefix}_${randomUUID()}`,
}) {
  function deleteIndex(type, id) {
    db.prepare('DELETE FROM rb_fts WHERE doc_type = ? AND doc_id = ?').run(type, id);
  }

  function putIndex(type, id, projectId, title, body) {
    deleteIndex(type, id);
    db.prepare(
      'INSERT INTO rb_fts (doc_type, doc_id, project_id, title, body) VALUES (?, ?, ?, ?, ?)',
    ).run(type, id, projectId, indexText(title), indexText(body));
  }

  function indexSource(source) {
    // Keep both the literal path and its words: "panel 2020" must find panel_2020.dta.
    const file = source.folderPath
      ? [source.name, source.folderPath].filter(Boolean).join('\n')
      : '';
    putIndex(
      'source',
      source.id,
      source.projectId,
      source.title,
      [payloadText(source.metadata), file, file.replace(/[_.\\/–-]/gu, ' ')].join('\n'),
    );
  }

  function changed(action, record, actor) {
    const key = action.startsWith('source.') ? 'sourceId' : 'itemId';
    events.record(
      'research.changed',
      { action, [key]: record.id },
      {
        projectId: record.projectId,
        meetingId: actor.meetingId,
        actorId: actor.actorId,
      },
    );
  }

  /** @param {string} id */
  function getSource(id) {
    const source = sourceRow(db.prepare('SELECT * FROM rb_sources WHERE id = ?').get(id));
    if (!source) throw new AppError('SOURCE_NOT_FOUND', 'Research source not found.', 404);
    return source;
  }

  /** @param {any} input @param {import('../../core/workspace/workspace.js').Actor} [actor] */
  function createSource(input, actor = {}) {
    const title = requiredText(input.title, 'title');
    const kind = oneOf(input.kind ?? 'file', sourceKinds, 'source kind');
    const metadata = recordObject(input.metadata ?? {});
    const contentStatus = oneOf(input.contentStatus ?? 'none', contentStatuses, 'content status');
    return db.transaction(() => {
      const id = input.id ?? newId('src');
      const projectId = input.projectId ?? null;
      const number =
        Number(
          db
            .prepare(
              "SELECT MAX(number) AS number FROM rb_sources WHERE ifnull(project_id, '') = ifnull(?, '')",
            )
            .get(projectId).number ?? 0,
        ) + 1;
      const time = now();
      db.prepare(
        `
        INSERT INTO rb_sources (id, project_id, number, kind, title, metadata_json,
          original_path, name, mime, content_status, created_at, updated_at,
          folder_path, file_size, file_mtime_ms, content_hash, parse_error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        projectId,
        number,
        kind,
        title,
        JSON.stringify(metadata),
        input.originalPath ?? null,
        input.name ?? null,
        input.mime ?? null,
        contentStatus,
        time,
        time,
        input.folderPath ?? null,
        input.fileSize ?? null,
        input.fileMtimeMs ?? null,
        input.contentHash ?? null,
        input.parseError ?? null,
      );
      indexSource(getSource(id));
      // Imports publish their single change event after parser results are saved.
      if (contentStatus !== 'queued') changed('source.created', getSource(id), actor);
      return getSource(id);
    });
  }

  /** @param {SourceQuery} [options] */
  function listSources(options = {}) {
    return createSourceListing(db).list(options).map(sourceRow);
  }

  /** @param {SourceQuery} [options] */
  function countSources(options = {}) {
    return createSourceListing(db).count(options);
  }

  /** @param {string} id @param {any} patch @param {Actor} [actor] */
  function updateSource(id, patch, actor = {}) {
    return db.transaction(() => {
      const current = getSource(id);
      const title = requiredText(patch.title ?? current.title, 'title');
      const kind = oneOf(patch.kind ?? current.kind, sourceKinds, 'source kind');
      const metadata = recordObject({ ...current.metadata, ...patch.metadata });
      const contentStatus = oneOf(
        patch.contentStatus ?? current.contentStatus,
        contentStatuses,
        'content status',
      );
      const fields = [
        'originalPath',
        'folderPath',
        'name',
        'fileSize',
        'fileMtimeMs',
        'contentHash',
        'parseError',
      ];
      const values = fields.map((field) =>
        patch[field] === undefined ? current[field] : patch[field],
      );
      db.prepare(
        `UPDATE rb_sources SET title=?, kind=?, metadata_json=?, updated_at=?, content_status=?,
         original_path=?, folder_path=?, name=?, file_size=?, file_mtime_ms=?, content_hash=?,
         parse_error=? WHERE id=?`,
      ).run(title, kind, JSON.stringify(metadata), now(), contentStatus, ...values, id);
      const result = getSource(id);
      indexSource(result);
      changed('source.updated', result, actor);
      return result;
    });
  }

  /** @param {string} label @param {string | null} [projectId] */
  function findSource(label, projectId = null) {
    const match = /^S(\d+)$/iu.exec(label);
    if (!match) return sourceRow(db.prepare('SELECT * FROM rb_sources WHERE id = ?').get(label));
    return sourceRow(
      db
        .prepare(
          "SELECT * FROM rb_sources WHERE ifnull(project_id, '') = ifnull(?, '') AND number = ?",
        )
        .get(projectId, Number(match[1])),
    );
  }

  /**
   * Replace the parser projection while preserving source identity and the original.
   * @param {string} sourceId @param {any[]} passages
   * @param {ParseResult} [parseResult]
   * @param {import('../../core/workspace/workspace.js').Actor} [actor]
   */
  function addChunks(sourceId, passages, parseResult = {}, actor = {}) {
    const contentStatus = oneOf(
      parseResult.contentStatus ?? 'parsed',
      contentStatuses,
      'content status',
    );
    return db.transaction(() => {
      const source = getSource(sourceId);
      const metadata = recordObject({ ...source.metadata, ...parseResult.metadata });
      for (const chunk of chunks(sourceId)) deleteIndex('chunk', chunk.id);
      db.prepare('DELETE FROM rb_chunks WHERE source_id = ?').run(sourceId);
      const insert = db.prepare(`INSERT INTO rb_chunks
        (id, source_id, ordinal, page, section, kind, text, char_start, char_end, anchor_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const [ordinal, passage] of passages.entries()) {
        const id = `${sourceId}-c${ordinal}`;
        const text = requiredText(passage.text, 'passage text');
        const kind = oneOf(passage.kind ?? 'paragraph', chunkKinds, 'chunk kind');
        insert.run(
          id,
          sourceId,
          ordinal,
          passage.page ?? null,
          passage.section ?? null,
          kind,
          text,
          passage.charStart ?? null,
          passage.charEnd ?? null,
          passage.anchor == null ? null : JSON.stringify(passage.anchor),
        );
        putIndex('chunk', id, source.projectId, passage.section ?? '', text);
      }
      db.prepare(
        `UPDATE rb_sources SET content_status = ?, parser = ?, parse_error = ?,
        pages = ?, metadata_json = ?, updated_at = ? WHERE id = ?`,
      ).run(
        contentStatus,
        parseResult.parser ?? null,
        parseResult.parseError ?? null,
        parseResult.pages ?? null,
        JSON.stringify(metadata),
        now(),
        sourceId,
      );
      const result = getSource(sourceId);
      indexSource(result);
      changed('source.imported', result, actor);
      return result;
    });
  }

  /** @param {string} id */
  function getChunk(id) {
    const chunk = chunkRow(db.prepare('SELECT * FROM rb_chunks WHERE id = ?').get(id));
    if (!chunk) throw new AppError('CHUNK_NOT_FOUND', 'Research passage not found.', 404);
    return chunk;
  }

  /** @param {string} sourceId */
  function chunks(sourceId) {
    return db
      .prepare('SELECT * FROM rb_chunks WHERE source_id = ? ORDER BY ordinal')
      .all(sourceId)
      .map(chunkRow);
  }

  return {
    db,
    createSource,
    getSource,
    listSources,
    countSources,
    updateSource,
    findSource,
    addChunks,
    getChunk,
    chunks,
    ...createResearchItems({ db, now, newId, putIndex, changed }),
  };
}
