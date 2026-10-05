// Lists the Chinese interface text fragments found in the desktop modules,
// the host's user-facing messages and the approved prototype's script, and
// reports which ones desktop/i18n-en.mjs does not translate yet.
// Usage: node scripts/i18n-extract.mjs [--missing] [--json]
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CJK = /[㐀-鿿]/u;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(line => {
    // Drop a // comment only when no quote or template is still open before it.
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '/' && line[i + 1] === '/' && line[i - 1] !== ':') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

// Text runs between code delimiters: quotes, template holes, tags, newlines.
export function fragments(source) {
  const out = new Set();
  for (const piece of stripComments(source).split(/\$\{|[`'"<>{}\n\\]/u)) {
    const text = piece.replace(/^[\s:;,.·|+/()=?!-]+|[\s:;,.·|+/()=?-]+$/gu, '').trim();
    if (text && CJK.test(text) && text.length <= 300) out.add(text);
  }
  return out;
}

export async function collect() {
  const found = new Map();
  const add = (set, source) => { for (const text of set) { if (!found.has(text)) found.set(text, new Set()); found.get(text).add(source); } };
  for (const file of (await readdir(path.join(root, 'desktop'))).filter(f => f.endsWith('.mjs') && !f.startsWith('i18n-'))) add(fragments(await readFile(path.join(root, 'desktop', file), 'utf8')), `desktop/${file}`);
  for (const file of (await readdir(path.join(root, 'scripts'))).filter(f => f.endsWith('.mjs') && !/smoke|i18n|gallery|eval/.test(f))) add(fragments(await readFile(path.join(root, 'scripts', file), 'utf8')), `scripts/${file}`);
  for (const dir of ['scripts/research-base', 'adapters/runtime-dsh']) {
    for (const file of (await readdir(path.join(root, dir))).filter(f => f.endsWith('.mjs'))) add(fragments(await readFile(path.join(root, dir, file), 'utf8')), `${dir}/${file}`);
  }
  const html = await readFile(path.join(root, 'ScienceScope.html'), 'utf8');
  const app = html.indexOf("const SPECS=window.PAGE_SPECS;");
  add(fragments(html.slice(app, html.indexOf('</script>', app))), 'ScienceScope.html');
  return found;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const found = await collect();
  let dictionary = {};
  try { dictionary = (await import('../desktop/i18n-en.mjs')).EN; } catch {}
  const missing = [...found.keys()].filter(text => !Object.hasOwn(dictionary, text));
  const list = process.argv.includes('--missing') ? missing : [...found.keys()];
  if (process.argv.includes('--json')) console.log(JSON.stringify(list, null, 1));
  else { for (const text of list) console.log(`${text}\t${[...found.get(text)].join(',')}`); console.error(`${found.size} fragments, ${missing.length} untranslated`); }
}
