import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildDesktop, DESKTOP_ASSETS } from './build-desktop.mjs';
import { createDesktopApi } from './desktop-api.mjs';

const entry = await buildDesktop();
const root = path.dirname(entry);
const api = await createDesktopApi();
const routes = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/desktop/vendor/marked.mjs',['desktop/vendor/marked.mjs','text/javascript; charset=utf-8']],
  ['/desktop/vendor/purify.mjs',['desktop/vendor/purify.mjs','text/javascript; charset=utf-8']],
]);
// Build and serve the same declared assets; new modules cannot silently 404.
for(const file of DESKTOP_ASSETS)routes.set('/desktop/'+file,['desktop/'+file,file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8']);
const server = http.createServer(async (request,response) => {
  if (await api.handle(request,response)) return;
  const target = routes.get(new URL(request.url,'http://127.0.0.1').pathname);
  if (!target || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
  try {
    const bytes = await readFile(path.join(root,target[0]));
    response.writeHead(200,{'Content-Type':target[1], 'Cache-Control':'no-store'});
    response.end(bytes);
  } catch { response.writeHead(500); response.end('Preview asset unavailable'); }
});
server.listen(0,'127.0.0.1',() => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(process.argv.includes('--desktop') ? JSON.stringify({url}) : `ScienceScope UI preview: ${url}#models`);
});
let closing = false;
async function close() { if(closing)return; closing=true; server.close(); await api.close(); server.closeAllConnections(); }
process.on('SIGINT',()=>void close());
process.on('SIGTERM',()=>void close());
