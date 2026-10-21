import { randomInt } from 'node:crypto';
import { indexXml } from './xml.js';

export const WORD14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

/**
 * Paragraph identity spans the package, including comments and headers.
 * @param {any} zip
 * @returns {Promise<() => string>}
 */
export async function paragraphIds(zip) {
  const used = new Set();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.xml')) continue;
    for (const span of indexXml(await entry.async('string'))) {
      const id = span.attrs['w14:paraId'];
      if (id) used.add(id.toUpperCase());
    }
  }
  return () => {
    let id;
    do {
      id = randomInt(1, 0x80000000).toString(16).toUpperCase().padStart(8, '0');
    } while (used.has(id));
    used.add(id);
    return id;
  };
}
