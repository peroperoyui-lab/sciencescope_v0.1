import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Serialize rotation and append across concurrent sessions of this runtime.
 * Only caller-selected metadata is written; never pass a request or response.
 * @param {string} directory
 */
export function createRequestLog(directory) {
  let pending = Promise.resolve();
  const file = path.join(directory, 'model-requests.jsonl');
  return (record) => {
    const write = pending.then(async () => {
      await mkdir(directory, { recursive: true });
      const size = await stat(file).then(
        (entry) => entry.size,
        (error) => {
          if (error.code !== 'ENOENT') throw error;
          return 0;
        },
      );
      if (size > 5 * 1024 * 1024) {
        const previous = path.join(directory, 'model-requests.previous.jsonl');
        await rm(previous, { force: true });
        await rename(file, previous);
      }
      await appendFile(file, JSON.stringify(record) + '\n', 'utf8');
    });
    pending = write.catch(() => {});
    return write;
  };
}
