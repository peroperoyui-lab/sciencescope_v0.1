import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { downloadEmbeddingFiles, verifyEmbeddingFiles, writeChunkFully } from './model-assets.js';

test('explicit model download verifies pinned bytes, retries the public mirror and preserves files on checksum failure', async () => {
  const { dir, cleanup } = await tempDir('r4-1b-model-assets');
  const bytes = Buffer.from('fake local model bytes');
  const manifest = {
    modelId: 'test/model',
    revision: 'pinned-revision',
    files: [
      {
        path: 'onnx/model.bin',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
  const output = path.join(dir, 'onnx', 'model.bin');
  const origins = [];
  const progress = [];
  try {
    await downloadEmbeddingFiles(dir, manifest, {
      fetchImpl: async (url) => {
        origins.push(new URL(url).origin);
        if (origins.length === 1) throw new Error('fake origin unavailable');
        return new Response(bytes, { headers: { 'content-length': String(bytes.length) } });
      },
      onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(origins, ['https://huggingface.co', 'https://hf-mirror.com']);
    assert.equal(await verifyEmbeddingFiles(dir, manifest), true);
    assert.equal(progress.at(-1).done, true);
    await writeFile(output, 'prior file');
    await assert.rejects(
      downloadEmbeddingFiles(dir, manifest, {
        fetchImpl: async () => new Response('bad checksum'),
      }),
      { code: 'MODEL_CHECKSUM_MISMATCH' },
    );
    assert.equal(await readFile(output, 'utf8'), 'prior file');
    await assert.rejects(readFile(output + '.download'), { code: 'ENOENT' });
    await mkdir(path.join(dir, 'partial'), { recursive: true });
    const written = [];
    await writeChunkFully(
      {
        write: async (buffer, offset, length) => {
          const bytesWritten = Math.min(2, length);
          written.push(buffer.subarray(offset, offset + bytesWritten));
          return { bytesWritten };
        },
      },
      bytes,
    );
    assert.deepEqual(Buffer.concat(written), bytes);
  } finally {
    await cleanup();
  }
});
