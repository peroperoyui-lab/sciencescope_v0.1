import { AppError } from './errors.js';

/** Durable records of files explicitly presented with an AI answer. */
export function createDeliverableRecords({ db, now, newId }) {
  const project = (row) => ({
    id: String(row.id),
    messageId: String(row.message_id),
    turnId: row.turn_id == null ? null : String(row.turn_id),
    toolCallId: row.tool_call_id == null ? null : String(row.tool_call_id),
    sourcePath: String(row.source_path),
    path: String(row.stored_path),
    name: String(row.name),
    description: String(row.description),
    mediaType: String(row.media_type),
    size: Number(row.byte_size),
    createdAt: String(row.created_at),
  });
  function get(id) {
    const row = db.prepare('SELECT * FROM message_deliverables WHERE id = ?').get(id);
    if (!row) throw new AppError('DELIVERABLE_NOT_FOUND', '文件已不存在或已被移动。', 404);
    return project(row);
  }
  function list(messageId) {
    return db
      .prepare('SELECT * FROM message_deliverables WHERE message_id = ? ORDER BY created_at, rowid')
      .all(messageId)
      .map(project);
  }
  function answerFor(turnId) {
    const row = db
      .prepare('SELECT id FROM messages WHERE turn_id = ? ORDER BY seq LIMIT 1')
      .get(turnId);
    if (!row) throw new AppError('MESSAGE_NOT_FOUND', '找不到这条消息。', 404);
    return String(row.id);
  }
  function existing(turnId, callId, sourcePath) {
    const row = db
      .prepare(
        'SELECT * FROM message_deliverables WHERE turn_id = ? AND tool_call_id = ? AND source_path = ?',
      )
      .get(turnId, callId, sourcePath);
    return row ? project(row) : null;
  }
  function add(file) {
    db.prepare(
      `INSERT INTO message_deliverables (id, message_id, turn_id, tool_call_id, source_path, stored_path, name, description, media_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      file.id,
      file.messageId,
      file.turnId,
      file.toolCallId,
      file.sourcePath,
      file.path,
      file.name,
      file.description,
      file.mediaType,
      file.size,
      now(),
    );
    return get(file.id);
  }
  return { get, list, answerFor, existing, add, newId: () => newId('file') };
}
