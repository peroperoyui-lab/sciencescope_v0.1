import { parentPort, workerData } from 'node:worker_threads';
import { readDiffBlocks } from '../desk/diff-blocks.js';
import { diffVersions } from '../desk/diff.js';

try {
  const before = await readDiffBlocks(workerData.before);
  const after = await readDiffBlocks(workerData.after);
  if (!before || !after)
    parentPort.postMessage({ old: null, new: null, diff: { status: 'originals-only' } });
  else
    parentPort.postMessage({
      format: after.format,
      old: { blocks: before.items.map((item) => item.block) },
      new: { blocks: after.items.map((item) => item.block) },
      diff: workerData.cached ?? diffVersions(before.items, after.items),
    });
} catch (error) {
  parentPort.postMessage({
    old: null,
    new: null,
    diff: { status: 'originals-only' },
    error: error.message,
  });
}
parentPort.close();
