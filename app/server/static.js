// Static files for the interface: `app/ui/` plus a few browser builds from
// node_modules. They carry no data, so they need no token; every `/api/` route does.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { reportStartup } from './startup-client.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const uiRoot = path.join(repoRoot, 'app', 'ui');
const modules = path.join(repoRoot, 'node_modules');

/** Browser builds the interface imports (see the import map in index.html). */
const VENDOR = {
  'preact.js': path.join(modules, 'preact', 'dist', 'preact.mjs'),
  'hooks.js': path.join(modules, 'preact', 'hooks', 'dist', 'hooks.mjs'),
  'htm.js': path.join(modules, 'htm', 'dist', 'htm.mjs'),
  'marked.js': path.join(modules, 'marked', 'lib', 'marked.esm.js'),
  'purify.js': path.join(modules, 'dompurify', 'dist', 'purify.es.mjs'),
  'katex.js': path.join(modules, 'katex', 'dist', 'katex.mjs'),
};
const FONT_ROOT = path.join(modules, '@fontsource-variable', 'noto-sans-sc');
const LOGO = path.join(repoRoot, 'reference', 'ScienceScope_Logo.png');

const TYPES = {
  '.wasm': 'application/wasm',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

/** Resolve `relative` inside `root`, or null when it would leave it. */
function inside(root, relative) {
  const file = path.resolve(root, relative);
  return file.startsWith(root + path.sep) ? file : null;
}

/** @param {string} pathname */
function locate(pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (relative === '' || relative === 'index.html') return path.join(uiRoot, 'index.html');
  if (relative === 'shared/journal.js') return path.join(repoRoot, 'app/shared/journal.js');
  if (relative === 'assets/logo.png') return LOGO;
  if (relative.startsWith('vendor/fonts/noto-sans-sc/')) {
    return inside(FONT_ROOT, relative.slice('vendor/fonts/noto-sans-sc/'.length));
  }
  if (relative.startsWith('vendor/katex/')) {
    return inside(path.join(modules, 'katex', 'dist'), relative.slice('vendor/katex/'.length));
  }
  if (relative.startsWith('vendor/pdf/'))
    return inside(path.join(modules, 'pdfjs-dist'), relative.slice('vendor/pdf/'.length));
  if (relative.startsWith('vendor/')) return VENDOR[relative.slice('vendor/'.length)] ?? null;
  return inside(uiRoot, relative);
}

/**
 * Serve a static file. Returns false when there is no such file.
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} response
 * @param {boolean} [startupReport]
 */
export async function serveStatic(pathname, response, startupReport = false) {
  if (pathname === '/__startup.js') {
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end(`(${reportStartup.toString()})();`);
    return true;
  }
  if (pathname === '/vendor/reader.js') {
    readerBundle ??= build({
      entryPoints: [path.join(uiRoot, 'readers/vendor.js')],
      bundle: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      write: false,
    });
    response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    response.end((await readerBundle).outputFiles[0].contents);
    return true;
  }
  const file = locate(pathname);
  if (!file) return false;
  let body;
  try {
    body = await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return false;
    throw error;
  }
  if (startupReport && file === path.join(uiRoot, 'index.html')) {
    body = Buffer.from(
      body
        .toString('utf8')
        .replace('</head>', '<script type="module" src="/__startup.js"></script></head>'),
    );
  }
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  response.end(body);
  return true;
}

let readerBundle;
