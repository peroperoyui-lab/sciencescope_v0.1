import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';

// GET /api/library/preview returns the text the research-input compiler extracts.
test('library preview returns extracted text, truncation and unextracted formats', async () => {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'library-preview-'));
  const host = { capabilities: {}, listProviders: async () => [], getRuntimeConfig: async () => ({}), getContextUsage: async () => null, observeSession: () => () => {}, startSession: async () => 's', configureReasoning: async () => {}, configurePolicy: async () => {}, releaseSession: async () => {}, close: async () => {}, send: async () => {} };
  const api = await createDesktopApi({ dataRoot: root, runtimeHost: host });
  const server = createServer((req, res) => api.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const send = (method, route, body) => new Promise((resolve, reject) => {
    const raw = body ? JSON.stringify(body) : '';
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method, headers: { host: `127.0.0.1:${port}`, ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null }));
    }); req.on('error', reject); req.end(raw);
  });
  const importFile = (name, content) => send('POST', '/api/library/import', { name, base64: Buffer.from(content).toString('base64') }).then((r) => r.body);
  try {
    const md = await importFile('notes.md', '# 标题\n\n段落 A');
    const preview = await send('GET', `/api/library/preview?id=${md.id}`);
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body, { id: md.id, title: 'notes.md', kind: 'md', text: '# 标题\n\n段落 A', truncated: false, note: '' });
    const long = await importFile('long.txt', 'x'.repeat(70000));
    const cut = await send('GET', `/api/library/preview?id=${long.id}`);
    assert.equal(cut.body.text.length, 64000);
    assert.equal(cut.body.truncated, true);
    const pdf = await importFile('paper.pdf', '%PDF-1.4');
    const binary = await send('GET', `/api/library/preview?id=${pdf.id}`);
    assert.equal(binary.status, 200);
    assert.equal(binary.body.text, null);
    assert.match(binary.body.note, /not been extracted/);
    assert.equal((await send('GET', '/api/library/preview?id=missing')).status, 404);
    assert.equal((await send('GET', '/api/library/preview')).status, 404);
  } finally { await api.close(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
