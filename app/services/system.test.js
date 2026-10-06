import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { openPath } from './system.js';

test('system opening uses a Windows absolute executable and reports launch failure', async () => {
  const target = '中文目录/研究记录.html';
  let invoked = { command: '', args: [] };
  const failed = /** @type {typeof import('node:child_process').spawn} */ (
    (command, args) => {
      invoked = { command, args };
      const child = new EventEmitter();
      queueMicrotask(() =>
        child.emit('error', Object.assign(new Error('missing opener'), { code: 'ENOENT' })),
      );
      return child;
    }
  );
  await assert.rejects(openPath(target, failed), { code: 'ENOENT' });
  assert.deepEqual(invoked.args, [target]);
  if (process.platform === 'win32') {
    assert.equal(
      invoked.command,
      path.join(process.env.SystemRoot ?? 'C:/Windows', 'explorer.exe'),
    );
    assert.ok(path.isAbsolute(invoked.command));
  }
});
