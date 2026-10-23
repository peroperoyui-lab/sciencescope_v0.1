// SQLite VACUUM and all snapshot queries run away from the application thread.
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, stat, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import { createExportWriter } from './writer.js';
import { planExport } from './plan.js';
import { sanitizeSnapshot } from './sanitize.js';
import { isWithin } from './paths.js';
import { settings } from '../../core/workspace/resources/settings.js';

const controller = new AbortController();
const flag = new Int32Array(workerData.cancelFlag);
const cancelled = () => Atomics.load(flag, 0) !== 0;
parentPort.on('message', (message) => {
  if (message === 'cancel') controller.abort();
});
let lastProgress = -Infinity;
function notify(value, force = false) {
  if (!force && performance.now() - lastProgress < 200) return;
  lastProgress = performance.now();
  parentPort.postMessage({ type: 'progress', value });
}
function openDatabase(file, readOnly = true) {
  const db = new DatabaseSync(file, { readOnly, allowExtension: true });
  db.enableLoadExtension(true);
  try {
    sqliteVec.load(db);
  } finally {
    db.enableLoadExtension(false);
  }
  db.exec('PRAGMA busy_timeout=5000');
  return db;
}
let source;
let snapshot;
let scratch;
try {
  const writer = await createExportWriter({
    root: workerData.folder,
    paths: workerData.paths,
    signal: controller.signal,
    cancelled,
    notify,
  });
  writer.check();
  const destination = path.join(workerData.folder, '数据库', 'sciencescope.sqlite');
  await mkdir(path.dirname(destination), { recursive: true });
  // Secret-bearing intermediate pages never enter the user-visible export.
  await mkdir(workerData.paths.runtime, { recursive: true });
  scratch = await mkdtemp(path.join(workerData.paths.runtime, 'full-export-'));
  const temporary = path.join(scratch, 'snapshot.sqlite');
  source = openDatabase(workerData.paths.database);
  source.exec(`VACUUM INTO '${temporary.replaceAll("'", "''")}'`);
  source.close();
  source = null;
  writer.check();
  snapshot = openDatabase(temporary, false);
  const settingsText = await readFile(workerData.paths.settings, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const sanitized = sanitizeSnapshot(snapshot, settings.parse(settingsText), writer.check);
  writer.check();
  // A second VACUUM omits freed pages containing pre-redaction values.
  snapshot.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  snapshot.close();
  snapshot = openDatabase(destination);
  notify({ phase: 'exporting', done: 1, total: 1, bytes: (await stat(destination)).size }, true);
  await planExport({ ...workerData, db: snapshot, writer, ...sanitized });
  writer.check();
  const result = await writer.run((await stat(destination)).size);
  writer.check();
  parentPort.postMessage({ type: 'result', value: result });
} catch (error) {
  parentPort.postMessage({
    type: 'failure',
    value: {
      cancelled: cancelled() || error.name === 'AbortError',
      error: error.message,
    },
  });
} finally {
  source?.close();
  snapshot?.close();
  if (scratch && isWithin(path.resolve(workerData.paths.runtime), path.resolve(scratch)))
    await rm(scratch, { recursive: true, force: true });
  parentPort.close();
}
