import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createDesktopApi } from '../scripts/desktop-api.mjs';
import { createChineseDocxFixture, createPdfFixture } from './helpers/document-fixtures.mjs';

const TOKEN = 'document-preview-test-token';

async function startApi(dataRoot) {
  const runtimeHost = { listProviders: async () => [], close: async () => {} };
  const api = await createDesktopApi({ dataRoot, runtimeHost, apiToken: TOKEN });
  const server = http.createServer((request, response) => { void api.handle(request, response); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return {
    base,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await api.close();
    },
  };
}

async function request(base, route, { token = TOKEN, method = 'GET', body } = {}) {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get('content-type') ?? '';
  const json = type.startsWith('application/json') ? JSON.parse(bytes.toString('utf8')) : undefined;
  return { response, bytes, type, json };
}

async function importResource(base, name, bytes) {
  const result = await request(base, '/api/library/import', {
    method: 'POST',
    body: { name, base64: Buffer.from(bytes).toString('base64') },
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.json?.id);
  return result.json;
}

test('document preview APIs enforce auth, preserve legacy 64k preview, and serve PDF/DOCX content', async () => {
  const tempBase = path.resolve('.sciencescope-local/temp');
  await mkdir(tempBase, { recursive: true });
  const dataRoot = await mkdtemp(path.join(tempBase, 'document-preview-'));
  const server = await startApi(dataRoot);
  try {
    const unauthorized = await request(server.base, '/api/library/document?id=missing', { token: null });
    assert.equal(unauthorized.response.status, 401);
    const wrongToken = await request(server.base, '/api/library/document?id=missing', { token: 'wrong-token' });
    assert.equal(wrongToken.response.status, 401);

    const pdfBytes = await createPdfFixture();
    const docxBytes = await createChineseDocxFixture();
    const longText = 'ScienceScope legacy preview boundary. '.repeat(2000);
    assert.ok(longText.length > 64000);
    const pdf = await importResource(server.base, 'fixture.pdf', pdfBytes);
    const docx = await importResource(server.base, '中文研究.docx', docxBytes);
    const long = await importResource(server.base, 'long.txt', Buffer.from(longText));
    const unknown = await importResource(server.base, 'notes.bin', Buffer.from([0, 1, 2, 3]));
    // Library imports now enqueue parsing; wait for that actual lifecycle before
    // checking status. Byte fidelity and the old preview boundary stay unchanged.
    const synced = await request(server.base, '/api/research/sync', { method: 'POST', body: { wait: true } });
    assert.equal(synced.response.status, 200);

    const pdfContent = await request(server.base, `/api/library/content?id=${encodeURIComponent(pdf.id)}`);
    assert.equal(pdfContent.response.status, 200);
    assert.equal(pdfContent.type, 'application/pdf');
    assert.deepEqual(pdfContent.bytes, pdfBytes);

    const docxContent = await request(server.base, `/api/library/content?id=${encodeURIComponent(docx.id)}`);
    assert.equal(docxContent.response.status, 200);
    assert.equal(docxContent.type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.deepEqual(docxContent.bytes, docxBytes);

    const oldPreview = await request(server.base, `/api/library/preview?id=${encodeURIComponent(long.id)}`);
    assert.equal(oldPreview.response.status, 200);
    assert.equal(oldPreview.json.id, long.id);
    assert.equal(oldPreview.json.title, 'long.txt');
    assert.equal(oldPreview.json.kind, 'txt');
    assert.equal(oldPreview.json.truncated, true);
    assert.equal(oldPreview.json.text.length, 64000);
    assert.notEqual(oldPreview.json.text, longText);

    const fullDocument = await request(server.base, `/api/library/document?id=${encodeURIComponent(long.id)}`);
    assert.equal(fullDocument.response.status, 200);
    assert.equal(fullDocument.json.format, 'text');
    assert.equal(fullDocument.json.parseStatus, 'parsed');
    assert.equal(fullDocument.json.text, longText);

    const ingest = await request(server.base, '/api/research/sources/ingest', {
      method: 'POST',
      body: { resourceId: docx.id, wait: true },
    });
    assert.equal(ingest.response.status, 200);
    assert.equal(ingest.json.source.contentStatus, 'parsed');

    const docxDocument = await request(server.base, `/api/library/document?id=${encodeURIComponent(docx.id)}`);
    assert.equal(docxDocument.response.status, 200);
    assert.equal(docxDocument.json.kind, 'docx');
    assert.equal(docxDocument.json.format, 'docx');
    assert.equal(docxDocument.json.parseStatus, 'parsed');
    assert.match(docxDocument.json.html, /中文研究标题/u);
    assert.match(docxDocument.json.html, /<table>/u);
    assert.deepEqual(docxDocument.json.warnings, []);

    const unknownDocument = await request(server.base, `/api/library/document?id=${encodeURIComponent(unknown.id)}`);
    assert.equal(unknownDocument.response.status, 200);
    assert.equal(unknownDocument.json.kind, 'bin');
    assert.equal(unknownDocument.json.format, 'original');
    assert.equal(unknownDocument.json.parseStatus, 'unsupported');
    assert.equal(Object.hasOwn(unknownDocument.json, 'text'), false);
    assert.equal(Object.hasOwn(unknownDocument.json, 'html'), false);
  } finally {
    await server.close();
    await rm(dataRoot, { recursive: true, force: true });
  }
});
