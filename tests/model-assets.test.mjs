import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { downloadEmbeddingFiles, verifyEmbeddingFiles, writeChunkFully } from '../scripts/research-base/model-assets.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'model-assets-'));
  const bytes = Buffer.from('local fake model bytes');
  const manifest = {
    modelId: 'local-test/model', revision: 'test-revision',
    files: [{ path: 'onnx/weights.bin', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  };
  return { root, bytes, manifest, destination: path.join(root, 'onnx', 'weights.bin'), close: () => rm(root, { recursive: true, force: true }) };
}

function responseFor(bytes) {
  return new Response(new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 3) controller.enqueue(bytes.subarray(offset, offset + 3));
      controller.close();
    },
  }), { headers: { 'content-length': String(bytes.length) } });
}

test('writeChunkFully retries partial writes until the complete buffer is written', async () => {
  const bytes = Buffer.from('partial writes are completed');
  const output = [];
  const fakeHandle = {
    async write(buffer, offset, length) {
      const written = Math.min(2, length);
      output.push(Buffer.from(buffer.subarray(offset, offset + written)));
      return { bytesWritten: written };
    },
  };
  await writeChunkFully(fakeHandle, bytes);
  assert.deepEqual(Buffer.concat(output), bytes);
});

test('download verifies the pinned file and falls back to the mirror after a fetch failure', async () => {
  const f = await fixture();
  const calls = [];
  try {
    await downloadEmbeddingFiles(f.root, f.manifest, {
      fetchImpl: async (url) => {
        calls.push(new URL(url).origin);
        if (calls.length === 1) throw new Error('LOCAL_FAKE_ORIGIN_FAILURE');
        return responseFor(f.bytes);
      },
    });
    assert.deepEqual(calls, ['https://huggingface.co', 'https://hf-mirror.com']);
    assert.equal(await verifyEmbeddingFiles(f.root, f.manifest), true);
    assert.deepEqual(await readFile(f.destination), f.bytes);
  } finally { await f.close(); }
});

test('hash failures preserve an existing model file and remove the temporary download', async () => {
  const f = await fixture();
  await mkdir(path.dirname(f.destination), { recursive: true });
  await writeFile(f.destination, 'existing verified model');
  try {
    await assert.rejects(downloadEmbeddingFiles(f.root, f.manifest, { fetchImpl: async () => responseFor(Buffer.from('wrong hash')) }), /MODEL_CHECKSUM_MISMATCH/u);
    assert.equal(await readFile(f.destination, 'utf8'), 'existing verified model');
    await assert.rejects(readFile(`${f.destination}.download`), { code: 'ENOENT' });
  } finally { await f.close(); }
});

test('cancellation during a fetch does not try the mirror or publish a partial file', async () => {
  const f = await fixture();
  const controller = new AbortController();
  const calls = [];
  try {
    await assert.rejects(downloadEmbeddingFiles(f.root, f.manifest, {
      signal: controller.signal,
      fetchImpl: async (url) => {
        calls.push(new URL(url).origin);
        controller.abort(new Error('LOCAL_TEST_ABORT'));
        return responseFor(f.bytes);
      },
    }), /LOCAL_TEST_ABORT/u);
    assert.deepEqual(calls, ['https://huggingface.co']);
    await assert.rejects(readFile(f.destination), { code: 'ENOENT' });
    await assert.rejects(readFile(`${f.destination}.download`), { code: 'ENOENT' });
  } finally { await f.close(); }
});
