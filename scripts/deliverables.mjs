// Files an agent presented with an answer (DSH `present` deliverables).
// Only a path that a completed, successful `present` call in the same chat
// declared can be shown or opened; relative paths resolve against the chat's
// runtime workspace, as DSH resolved them when the call ran.
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { presentedFiles } from './discussion-service.mjs';

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml' };
const MAX_IMAGE = 20 * 1024 * 1024;

export class DeliverableError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export const deliverableKind = (file) => IMAGE_TYPES[path.extname(file).toLowerCase()] ? 'image' : 'document';

export function createDeliverables({ db, openLocal }) {
  const declared = (chatId, file) => db.prepare("SELECT name, status, is_error, arguments_preview FROM tool_activity WHERE chat_id=? AND name='present' AND status='completed' AND is_error=0").all(chatId)
    .some((row) => presentedFiles({ name: row.name, status: row.status, isError: row.is_error === 1, argumentsPreview: row.arguments_preview }).some((item) => item.path === file));

  async function resolve(chatId, file) {
    if (typeof chatId !== 'string' || !chatId || typeof file !== 'string' || !file || file.length > 400) throw new DeliverableError('INVALID_DELIVERABLE', '文件标识无效。');
    if (!declared(chatId, file)) throw new DeliverableError('NOT_PRESENTED', '这个文件不是本对话中展示过的结果。', 404);
    let target = file;
    if (!path.isAbsolute(target)) {
      const workspace = db.prepare('SELECT runtime_workspace FROM runtime_bindings WHERE chat_id=?').get(chatId)?.runtime_workspace;
      if (!workspace) throw new DeliverableError('NO_WORKSPACE', '找不到这个对话的工作文件夹。', 404);
      target = path.resolve(workspace, target);
    }
    try { target = await realpath(target); } catch { throw new DeliverableError('MISSING', '文件已不存在或已被移动。', 404); }
    const info = await stat(target);
    if (!info.isFile()) throw new DeliverableError('MISSING', '文件已不存在或已被移动。', 404);
    return { target, size: info.size };
  }

  return {
    /** Image bytes for a thumbnail. */
    async image(chatId, file) {
      const { target, size } = await resolve(chatId, file);
      const type = IMAGE_TYPES[path.extname(target).toLowerCase()];
      if (!type) throw new DeliverableError('NOT_IMAGE', '这个文件不是图片。', 415);
      if (size > MAX_IMAGE) throw new DeliverableError('TOO_LARGE', '图片太大，无法预览。', 413);
      return { bytes: await readFile(target), type };
    },
    /** Open with the system's default program. */
    async open(chatId, file) { const { target } = await resolve(chatId, file); return openLocal(target); },
  };
}
