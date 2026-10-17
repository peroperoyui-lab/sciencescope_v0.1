// One retained JSON record per launch. All clocks refer to Unix milliseconds,
// so native, Node and WebView stages can be compared on the same machine.
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} dataRoot
 * @param {{ nativeStart?: number, nodeSpawn?: number, nodeStart?: number }} [initial]
 */
export function createStartupLog(dataRoot, initial = {}) {
  const points = { ...initial };
  let written;
  return {
    /** @param {string} name */
    mark(name) {
      points[name] = performance.timeOrigin + performance.now();
    },
    /**
     * @param {{ pageRendered?: number, renderStatus?: string }} [page]
     */
    finish(page = {}) {
      if (written) return written;
      const record = {
        schema: 1,
        pid: process.pid,
        time: new Date().toISOString(),
        points: { ...points, ...page },
      };
      const file = path.join(dataRoot, 'logs', 'startup.log');
      written = mkdir(path.dirname(file), { recursive: true }).then(() =>
        appendFile(file, JSON.stringify(record) + '\n', 'utf8'),
      );
      return written;
    },
  };
}
