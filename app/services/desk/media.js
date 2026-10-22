import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { indexXml } from './docx/xml.js';

const types = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  emf: 'image/emf',
  wmf: 'image/wmf',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

/**
 * Resolve package relationships once; never fetch linked external pictures.
 * @param {any} document
 * @returns {Promise<Map<number,{file:string,mimeType:string}>>}
 */
export async function indexMedia(document) {
  const xml = await document.zip.file('word/_rels/document.xml.rels')?.async('string');
  const relationships = new Map(
    (xml ? indexXml(xml) : [])
      .filter((span) => span.tag.split(':').at(-1) === 'Relationship')
      .map((span) => [span.attrs.Id, span.attrs]),
  );
  const content = await document.zip.file('[Content_Types].xml')?.async('string');
  const contentTypes = content ? indexXml(content) : [];
  const result = new Map();
  for (const [ref, atom] of document.atoms.entries()) {
    if (atom.atom !== 'image') continue;
    for (const span of document.inside(atom)) {
      if (!['blip', 'imagedata'].includes(span.tag.split(':').at(-1))) continue;
      const id = Object.entries(span.attrs).find(([name]) => /:(?:embed|id)$/u.test(name))?.[1];
      const relation = relationships.get(id);
      if (!relation || relation.TargetMode === 'External' || !relation.Type?.endsWith('/image'))
        continue;
      const file = path.posix.normalize(
        relation.Target.startsWith('/')
          ? relation.Target.slice(1)
          : path.posix.join('word', relation.Target),
      );
      if (!document.zip.file(file)) continue;
      const extension = path.posix.extname(file).slice(1).toLowerCase();
      const override = contentTypes.find((entry) => entry.attrs.PartName === '/' + file);
      const fallback = contentTypes.find(
        (entry) => entry.attrs.Extension?.toLowerCase() === extension,
      );
      result.set(ref, {
        file,
        mimeType:
          override?.attrs.ContentType ??
          fallback?.attrs.ContentType ??
          types[extension] ??
          'application/octet-stream',
      });
      break;
    }
  }
  return result;
}

/**
 * @param {any} document
 * @param {string|number} ref
 * @returns {Promise<{bytes:Buffer,mimeType:string}>}
 */
export async function readMedia(document, ref) {
  const item = document.media?.get(Number(ref));
  if (!item) throw new AppError('DESK_MEDIA_NOT_FOUND', '找不到这张图片。', 404);
  return { bytes: await document.zip.file(item.file).async('nodebuffer'), mimeType: item.mimeType };
}
