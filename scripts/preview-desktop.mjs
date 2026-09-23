import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { buildDesktop, DESKTOP_ASSETS } from './build-desktop.mjs';
import { createDesktopApi } from './desktop-api.mjs';

export async function createDesktopServer({dataRoot,outputDir,runtimeHost}={}) {
const entry = await buildDesktop({outputDir});
const root = path.dirname(entry);
const apiToken = randomBytes(32).toString('hex');
const api = await createDesktopApi({dataRoot,runtimeHost,apiToken});
const routes = new Map([
  ['/', ['index.html','text/html; charset=utf-8']],
  ['/desktop/vendor/marked.mjs',['desktop/vendor/marked.mjs','text/javascript; charset=utf-8']],
  ['/desktop/vendor/purify.mjs',['desktop/vendor/purify.mjs','text/javascript; charset=utf-8']],
]);
// Build and serve the same declared assets; new modules cannot silently 404.
for(const file of DESKTOP_ASSETS)routes.set('/desktop/'+file,['desktop/'+file,file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8']);
  const server = http.createServer(async (request,response) => {
  if (request.url === '/__host_shutdown') {
    const supplied = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice('Bearer '.length)
      : '';
    const localHost = `127.0.0.1:${server.address()?.port}`;
    const validOrigin = !request.headers.origin || request.headers.origin === `http://${localHost}`;
    const valid = request.method === 'POST' && request.headers.host === localHost && validOrigin && supplied.length === shutdownToken.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(shutdownToken));
    if (!valid) { response.writeHead(request.method === 'POST' ? 403 : 405); response.end(); return; }
    response.writeHead(202, {'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(JSON.stringify({closing:true}));
    void close();
    return;
  }
  if (await api.handle(request,response)) return;
  const target = routes.get(new URL(request.url,'http://127.0.0.1').pathname);
  if (!target || request.method !== 'GET') { response.writeHead(404); response.end(); return; }
  try {
    const bytes = await readFile(path.join(root,target[0]));
    response.writeHead(200,{'Content-Type':target[1], 'Cache-Control':'no-store'});
    response.end(bytes);
  } catch { response.writeHead(500); response.end('Preview asset unavailable'); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const shutdownToken = randomBytes(32).toString('hex');
const shutdownPath = '/__host_shutdown';
let closing = false;
async function close() {
  if(closing)return;
  closing=true;
  server.close();
  await api.close();
  server.closeAllConnections();
}
return {url,close,shutdownPath,shutdownToken,apiToken};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const desktop=await createDesktopServer();
  console.log(process.argv.includes('--desktop') ? JSON.stringify({url:desktop.url,shutdownPath:desktop.shutdownPath,shutdownToken:desktop.shutdownToken,apiToken:desktop.apiToken}) : `ScienceScope UI preview: ${desktop.url}#models`);
  process.on('SIGINT',()=>void desktop.close());
  process.on('SIGTERM',()=>void desktop.close());
}
