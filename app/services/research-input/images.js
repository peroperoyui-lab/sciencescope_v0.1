// Reuse the original-byte store, without registering images as research sources.
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../core/errors.js';

/**
 * @param {string} name
 */
export function imageMime(name) {
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[path.extname(name).toLowerCase()];
}

/**
 * @param {import('../../core/index.js').Core} core
 */
export function imageAttachments(core) {
  function get(id) {
    const row = core.db.prepare('SELECT * FROM input_images WHERE id=?').get(id);
    if (!row) throw new AppError('IMAGE_NOT_FOUND', '找不到这张图片，请重新添加。', 404);
    return {
      type: 'image',
      id: String(row.id),
      name: String(row.name),
      title: String(row.name),
      mimeType: String(row.mime),
      bytes: Number(row.bytes),
      url: `/api/research-input/images/${encodeURIComponent(String(row.id))}`,
    };
  }
  async function content(id) {
    const metadata = get(id);
    const row = core.db.prepare('SELECT original_path FROM input_images WHERE id=?').get(id);
    return {
      ...metadata,
      bytes: await readFile(path.join(core.paths.library, String(row.original_path))),
    };
  }
  async function save(name, bytes) {
    const mime = imageMime(name);
    const id = randomUUID();
    const originalPath = path.join('originals', `${id}${path.extname(name).toLowerCase()}`);
    const file = path.join(core.paths.library, originalPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    try {
      core.db
        .prepare('INSERT INTO input_images(id,name,mime,original_path,bytes) VALUES(?,?,?,?,?)')
        .run(id, path.basename(name.replaceAll('\\', '/')), mime, originalPath, bytes.length);
    } catch (error) {
      await unlink(file);
      throw error;
    }
    return get(id);
  }
  return { get, content, save };
}

/**
 * Attach exactly the images selected by transcript assembly, including rebuilds.
 * @param {import('../../core/index.js').Core} core
 * @param {import('../../core/messages.js').Message[]} messages
 * @returns {Promise<import('../../runtime/port.js').ImageContent[]>}
 */
export async function compileImages(core, messages) {
  const store = imageAttachments(core);
  const images = messages
    .flatMap((message) => message.researchInput?.materials ?? [])
    .filter((entry) => entry.type === 'image');
  return Promise.all(
    images.map(async (entry) => {
      const file = await store.content(entry.id);
      return { type: 'image', data: file.bytes.toString('base64'), mimeType: file.mimeType };
    }),
  );
}
