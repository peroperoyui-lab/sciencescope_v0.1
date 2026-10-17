import { randomUUID } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Preview size bounds model context, never the saved output. Inspired by pi's
// core/tools/output-accumulator and truncate (pi-coding-agent 1.0.0, MIT).
const PREVIEW_BYTES = 64 * 1024;

/**
 * @param {string} tempDirectory
 * @returns {Promise<string>}
 */
export async function outputPath(tempDirectory) {
  await mkdir(tempDirectory, { recursive: true });
  return path.join(tempDirectory, `tool-${randomUUID()}.txt`);
}

/**
 * Read a bounded head/tail from a complete output file, on UTF-8 boundaries.
 * @param {string} file
 */
export async function previewFile(file) {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= PREVIEW_BYTES)
      return { output: await handle.readFile('utf8'), totalBytes: size, omittedBytes: 0 };
    const head = Buffer.alloc(PREVIEW_BYTES / 2);
    const tail = Buffer.alloc(PREVIEW_BYTES / 2);
    await handle.read(head, 0, head.length, 0);
    await handle.read(tail, 0, tail.length, size - tail.length);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let end = head.length;
    let first = '';
    // A UTF-8 code point occupies at most four bytes.
    for (; end >= head.length - 3; end--) {
      try {
        first = decoder.decode(head.subarray(0, end));
        break;
      } catch {
        // The preview boundary bisected a UTF-8 code point; try one byte earlier.
      }
    }
    let start = 0;
    while (start < tail.length && (tail[start] & 0xc0) === 0x80) start++;
    const last = tail.subarray(start).toString('utf8');
    const omittedBytes = size - end - (tail.length - start);
    return {
      output: `${first}\n\n[共 ${size} 字节，省略了中间 ${omittedBytes} 字节，完整输出在 ${file}]\n\n${last}`,
      totalBytes: size,
      omittedBytes,
      fullOutputPath: file,
    };
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} text
 * @param {string} tempDirectory
 */
export async function presentOutput(text, tempDirectory) {
  const totalBytes = Buffer.byteLength(text);
  if (totalBytes <= PREVIEW_BYTES) return { output: text, totalBytes, omittedBytes: 0 };
  const file = await outputPath(tempDirectory);
  await writeFile(file, text);
  return previewFile(file);
}
