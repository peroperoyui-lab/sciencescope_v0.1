import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { readDocx } from '../desk/docx/read.js';
import { indexMedia, readMedia } from '../desk/media.js';

const MAX_PACKAGES = 4;

async function loadPackage(file) {
  const document = await readDocx(await readFile(file));
  document.media = await indexMedia(document);
  return document;
}

function fileError(error) {
  if (['ENOENT', 'ENOTDIR'].includes(error.code))
    return new AppError(
      'VERSION_MEDIA_FILE_NOT_FOUND',
      '这个版本的原文件已被清理，无法读取图片。',
      404,
    );
  return error;
}

/**
 * Keep a few immutable packages, sharing in-flight loads. Stat each read so a
 * cleaned or externally replaced original cannot keep serving cached pictures.
 * @param {import('../../core/index.js').Core} core
 * @param {{load?:typeof loadPackage}} [options]
 * @returns {(id:string,ref:string|number)=>Promise<{bytes:Buffer,mimeType:string}>}
 */
export function createVersionMedia(core, { load = loadPackage } = {}) {
  const cache = new Map();
  return async (id, ref) => {
    const version = core.versionCatalog.get(id);
    if (path.extname(version.name).toLowerCase() !== '.docx')
      throw new AppError('VERSION_MEDIA_FORMAT', '只有 DOCX 版本可以读取内嵌图片。');
    const file = core.versionCatalog.file(id);
    let info;
    try {
      info = await stat(file);
    } catch (error) {
      cache.delete(id);
      throw fileError(error);
    }
    if (!info.isFile()) {
      cache.delete(id);
      throw new AppError(
        'VERSION_MEDIA_FILE_NOT_FOUND',
        '这个版本的原文件已被清理，无法读取图片。',
        404,
      );
    }
    const key = JSON.stringify([file, info.size, info.mtimeMs, info.ctimeMs]);
    let entry = cache.get(id);
    if (entry?.key !== key) entry = { key, document: load(file) };
    cache.delete(id);
    cache.set(id, entry);
    if (cache.size > MAX_PACKAGES) cache.delete(cache.keys().next().value);
    let document;
    try {
      document = await entry.document;
    } catch (error) {
      if (cache.get(id) === entry) cache.delete(id);
      throw fileError(error);
    }
    if (!document.media.has(Number(ref)))
      throw new AppError('VERSION_MEDIA_NOT_FOUND', '找不到这个版本中的图片。', 404);
    return readMedia(document, ref);
  };
}
