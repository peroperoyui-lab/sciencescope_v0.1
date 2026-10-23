// User files are streamed. Explicit managed roots and symlinks stay outside the
// export, even if a project folder contains a shortcut into credentials/runtime.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { once } from 'node:events';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import path from 'node:path';
import { fileName, isWithin } from './paths.js';

/** @param {any} row */
export function decodeRow(row) {
  if (!row) return null;
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      key.endsWith('_json') && typeof value === 'string' ? JSON.parse(value) : value,
    ]),
  );
}

/**
 * @param {{root:string,paths:any,signal:AbortSignal,cancelled:()=>boolean,
 * notify:(value:any)=>void}} options
 */
export async function createExportWriter({ root, paths, signal, cancelled, notify }) {
  const sourceRoot = await realpath(paths.root);
  const excluded = await Promise.all(
    [
      paths.secret,
      paths.logs,
      paths.backups,
      paths.runtime,
      paths.python,
      paths.models,
      path.join(paths.root, 'webview'),
      paths.database,
      `${paths.database}-wal`,
      `${paths.database}-shm`,
      paths.settings,
    ].map(async (entry) => realpath(entry).catch(() => path.resolve(entry))),
  );
  const tasks = [];
  const occupied = new Set();
  const skipped = [];
  let done = 0;
  let bytes = 0;
  function check() {
    if (cancelled() || signal.aborted)
      throw Object.assign(new Error('导出已取消。'), { name: 'AbortError' });
  }
  const progress = () => notify({ phase: 'exporting', done, total: tasks.length + 1, bytes });
  function destination(relative) {
    const parts = relative
      .split(/[\\/]/u)
      .filter(Boolean)
      .map((part) => fileName(part, 255));
    const candidate = parts.join('/');
    const extension = path.posix.extname(candidate);
    const stem = extension ? candidate.slice(0, -extension.length) : candidate;
    let saved = candidate;
    for (let number = 2; occupied.has(saved.toLowerCase()); number++)
      saved = `${stem} (${number})${extension}`;
    occupied.add(saved.toLowerCase());
    return saved;
  }
  function add(relative, write) {
    const name = destination(relative);
    tasks.push({ name, write });
    return name;
  }
  async function stream(relative, write) {
    check();
    const output = path.join(root, relative);
    await mkdir(path.dirname(output), { recursive: true });
    const target = createWriteStream(output, { flags: 'wx' });
    // Attach a handler before the first await; pipeline also reports the error.
    const finished = new Promise((resolve, reject) => {
      target.once('close', () => resolve(undefined));
      target.once('error', reject);
    });
    void finished.catch(() => {});
    const abort = () =>
      target.destroy(Object.assign(new Error('导出已取消。'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
    try {
      await write(async (chunk) => {
        check();
        bytes += Buffer.byteLength(chunk);
        if (!target.write(chunk)) await once(target, 'drain');
      });
      target.end();
      await finished;
    } catch (error) {
      target.destroy();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  function text(relative, value) {
    return add(relative, (name) =>
      stream(name, async (write) => {
        const content = typeof value === 'function' ? await value() : value;
        await write(String(content));
      }),
    );
  }
  function json(relative, value) {
    return text(
      relative,
      async () =>
        `${JSON.stringify(typeof value === 'function' ? await value() : value, null, 2)}\n`,
    );
  }
  function rows(relative, iterate) {
    return add(relative, (name) =>
      stream(name, async (write) => {
        await write('[\n');
        let first = true;
        for (const row of iterate()) {
          await write(`${first ? '' : ',\n'}${JSON.stringify(decodeRow(row))}`);
          first = false;
        }
        await write('\n]\n');
      }),
    );
  }
  async function source(file) {
    try {
      const actual = await realpath(file);
      if (!isWithin(sourceRoot, actual) || excluded.some((entry) => isWithin(entry, actual))) {
        skipped.push({ path: file, reason: '不在允许导出的数据文件范围内' });
        return null;
      }
      return actual;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      skipped.push({ path: file, reason: '原文件不存在' });
      return null;
    }
  }
  async function copy(file, relative) {
    const actual = await source(file);
    if (!actual) return null;
    if (!(await stat(actual)).isFile()) return null;
    return add(relative, async (name) => {
      check();
      const output = path.join(root, name);
      await mkdir(path.dirname(output), { recursive: true });
      await pipeline(
        createReadStream(actual),
        new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            progress();
            callback(null, chunk);
          },
        }),
        createWriteStream(output, { flags: 'wx' }),
        { signal },
      );
    });
  }
  async function tree(folder, relative) {
    check();
    const actual = await source(folder);
    if (!actual) return;
    for (const entry of await readdir(actual, { withFileTypes: true })) {
      check();
      const file = path.join(actual, entry.name);
      const target = `${relative}/${fileName(entry.name, 255)}`;
      if (entry.isSymbolicLink()) skipped.push({ path: file, reason: '符号链接不复制' });
      else if (entry.isDirectory()) await tree(file, target);
      else if (entry.isFile()) await copy(file, target);
    }
  }
  async function run(snapshotBytes) {
    bytes = snapshotBytes;
    done = 1;
    progress();
    for (const task of tasks) {
      check();
      await task.write(task.name);
      done++;
      progress();
      await yieldLoop();
    }
    return { files: done, bytes, skipped };
  }
  return { check, text, json, rows, copy, tree, source, run, skipped };
}
