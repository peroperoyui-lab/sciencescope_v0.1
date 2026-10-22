/**
 * Only indexes and non-DOCX comments live in tables. DOCX comments stay in
 * the source package plus the session journal, just like editable runs.
 * @param {import('../../core/index.js').Core} core
 * @returns {any}
 */
export function createAnnotationStore(core) {
  const { db } = core;
  function decode(row, type) {
    return {
      id: row.id,
      type,
      groupId: row.group_id,
      versionId: row.version_id,
      blockId: row.block_id,
      from: row.block_from,
      to: row.block_to,
      quote: JSON.parse(row.quote_json),
      authorId: row.author_id ?? row.attributed_to,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(type === 'comment'
        ? { text: row.text, parentId: row.parent_id, resolved: Boolean(row.resolved) }
        : {
            kind: row.kind,
            value: row.value,
            sources: JSON.parse(row.sources_json),
            derivation: row.derivation_json ? JSON.parse(row.derivation_json) : null,
            note: row.note,
            status: row.status,
          }),
    };
  }
  function rows(groupId) {
    return [
      ...db
        .prepare('SELECT * FROM manuscript_bindings WHERE group_id=?')
        .all(groupId)
        .map((row) => decode(row, 'index')),
      ...db
        .prepare('SELECT * FROM manuscript_comments WHERE group_id=?')
        .all(groupId)
        .map((row) => decode(row, 'comment')),
    ];
  }
  function get(id) {
    const binding = db.prepare('SELECT * FROM manuscript_bindings WHERE id=?').get(id);
    if (binding) return decode(binding, 'index');
    const comment = db.prepare('SELECT * FROM manuscript_comments WHERE id=?').get(id);
    return comment ? decode(comment, 'comment') : null;
  }
  function apply({ before, after }) {
    const item = after ?? before;
    if (item.id.startsWith('docx:')) return;
    const table = item.type === 'index' ? 'manuscript_bindings' : 'manuscript_comments';
    if (!after) {
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(item.id);
      return;
    }
    const common = [
      after.id,
      after.groupId,
      after.versionId,
      after.blockId,
      after.from,
      after.to,
      JSON.stringify(after.quote),
    ];
    if (item.type === 'index')
      db.prepare(
        `INSERT INTO manuscript_bindings (id,group_id,version_id,block_id,block_from,block_to,quote_json,kind,value,sources_json,derivation_json,note,attributed_to,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version_id=excluded.version_id,block_id=excluded.block_id,block_from=excluded.block_from,block_to=excluded.block_to,quote_json=excluded.quote_json,kind=excluded.kind,value=excluded.value,sources_json=excluded.sources_json,derivation_json=excluded.derivation_json,note=excluded.note,status=excluded.status,updated_at=excluded.updated_at`,
      ).run(
        ...common,
        after.kind,
        after.value,
        JSON.stringify(after.sources),
        after.derivation == null ? null : JSON.stringify(after.derivation),
        after.note,
        after.authorId,
        after.status,
        after.createdAt,
        after.updatedAt,
      );
    else
      db.prepare(
        `INSERT INTO manuscript_comments (id,group_id,version_id,block_id,block_from,block_to,quote_json,author_id,text,parent_id,resolved,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version_id=excluded.version_id,block_id=excluded.block_id,block_from=excluded.block_from,block_to=excluded.block_to,quote_json=excluded.quote_json,text=excluded.text,parent_id=excluded.parent_id,resolved=excluded.resolved,updated_at=excluded.updated_at`,
      ).run(
        ...common,
        after.authorId,
        after.text,
        after.parentId ?? null,
        after.resolved ? 1 : 0,
        after.createdAt,
        after.updatedAt,
      );
  }
  return { rows, get, apply };
}
