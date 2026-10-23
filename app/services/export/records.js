import { decodeRow } from './writer.js';

/** @param {import('node:sqlite').DatabaseSync} db @param {string} sql @param {any[]} args */
export function records(db, sql, ...args) {
  return db
    .prepare(sql)
    .all(...args)
    .map(decodeRow);
}

/** @param {any} item */
export function itemMarkdown(item) {
  return `# ${item.title}\n\n${item.body || ''}\n\n## 元数据\n\n\`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\`\n`;
}

/** @param {any} value */
export function mapMarkdown(value) {
  const nodes = value.nodes ?? [];
  const seen = new Set();
  const lines = ['# 研究导图', ''];
  function visit(node, depth) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    lines.push(
      `${'  '.repeat(depth)}- ${String(node.text ?? '').replaceAll('\n', ' ')} (${node.id})`,
    );
    for (const child of nodes.filter((entry) => entry.parent === node.id)) visit(child, depth + 1);
  }
  for (const node of nodes.filter((entry) => !entry.parent)) visit(node, 0);
  for (const node of nodes) visit(node, 0);
  if (value.edges?.length) {
    lines.push('', '## 额外关联', '');
    for (const edge of value.edges) lines.push(`- ${edge.from} → ${edge.to}: ${edge.label ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Only the read surface used by the unchanged meetingMarkdown renderer.
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {any}
 */
export function markdownCore(db) {
  return {
    participants: { list: () => records(db, 'SELECT * FROM participants') },
    meetings: { get: (id) => db.prepare('SELECT * FROM meetings WHERE id=?').get(id) },
    messages: {
      list(meetingId, { after, limit }) {
        const rows = records(
          db,
          'SELECT * FROM messages WHERE meeting_id=? AND seq>? ORDER BY seq LIMIT ?',
          meetingId,
          after,
          limit + 1,
        );
        return {
          hasAfter: rows.length > limit,
          messages: rows.slice(0, limit).map((row) => ({
            ...row,
            authorId: row.author_id,
            createdAt: row.created_at,
          })),
        };
      },
    },
  };
}

/** @param {any} context */
export function planDatabaseRecords({ db, writer }) {
  const tables = records(
    db,
    "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).filter((row) => !row.name.startsWith('rb_fts') && !row.name.startsWith('rb_vec'));
  for (const { name } of tables)
    writer.rows(`数据库/记录/${name}.json`, () =>
      db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).iterate(),
    );
}
