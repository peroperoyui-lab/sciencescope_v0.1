import test from 'node:test';
import assert from 'node:assert/strict';
import { check, install, supported } from './native-update.js';

test('update bridge is unavailable outside the native main window and installs only on request', async () => {
  const previous = globalThis.__TAURI__;
  const commands = [];
  const progress = [];
  let listener;
  let removed = 0;
  let failed = false;
  try {
    delete globalThis.__TAURI__;
    assert.equal(supported(), false);
    await assert.rejects(check(), { code: 'UPDATE_UNSUPPORTED' });
    await assert.rejects(install(), { code: 'UPDATE_UNSUPPORTED' });
    let label = 'secondary-assistant';
    const available = {
      available: true,
      version: '1.0.0-alpha.2',
      notes: 'Synthetic release',
      date: '2026-10-24T00:00:00Z',
    };
    globalThis.__TAURI__ = {
      window: { getCurrentWindow: () => ({ label }) },
      core: {
        async invoke(command) {
          commands.push(command);
          if (command === 'check_update') return available;
          listener({ payload: { phase: 'downloading', downloaded: 10, total: 20 } });
          if (failed) throw { code: 'UPDATE_SIGNATURE', message: 'Synthetic signature mismatch' };
        },
      },
      event: {
        async listen(name, callback) {
          // Match the native event contract, including Tauri's event-name rules.
          assert.match(name, /^[\p{L}\p{N}\-/:_]+$/u);
          assert.equal(name, 'update:progress');
          listener = callback;
          return () => removed++;
        },
      },
    };
    assert.equal(supported(), false);
    await assert.rejects(check(), { code: 'UPDATE_UNSUPPORTED' });
    label = 'main';
    assert.equal(supported(), true);
    assert.deepEqual(await check(), available);
    assert.deepEqual(await check(), available);
    assert.deepEqual(commands, ['check_update', 'check_update']);
    await install((value) => progress.push(value));
    assert.deepEqual(progress, [{ phase: 'downloading', downloaded: 10, total: 20 }]);
    failed = true;
    await assert.rejects(install(), {
      code: 'UPDATE_SIGNATURE',
      message: 'Synthetic signature mismatch',
    });
    assert.equal(removed, 2);
  } finally {
    if (previous === undefined) delete globalThis.__TAURI__;
    else globalThis.__TAURI__ = previous;
  }
});

test('listener setup errors receive a code and never invoke installation', async () => {
  const previous = globalThis.__TAURI__;
  let invoked = false;
  try {
    globalThis.__TAURI__ = {
      window: { getCurrentWindow: () => ({ label: 'main' }) },
      core: {
        async invoke() {
          invoked = true;
        },
      },
      event: {
        async listen() {
          throw new Error('Native listener could not be registered');
        },
      },
    };
    await assert.rejects(install(), {
      code: 'UPDATE_FAILED',
      message: 'Native listener could not be registered',
    });
    assert.equal(invoked, false);
  } finally {
    if (previous === undefined) delete globalThis.__TAURI__;
    else globalThis.__TAURI__ = previous;
  }
});
