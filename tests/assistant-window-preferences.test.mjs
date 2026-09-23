import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  createAssistantWindowPreferences,
  DEFAULT_ASSISTANT_WINDOW_PREFERENCES,
} from '../scripts/assistant-window-preferences.mjs';

const tempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
mkdirSync(tempRoot, { recursive: true });

test('defaults to closed and persists the startup mode after reopen', () => {
  const dataRoot = mkdtempSync(join(tempRoot, 'assistant-window-preferences-'));
  const dbPath = join(dataRoot, 'desktop.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const store = createAssistantWindowPreferences({ db });
    assert.deepEqual(store.get(), DEFAULT_ASSISTANT_WINDOW_PREFERENCES);
    assert.deepEqual(store.save({ startup: 'orb' }), { startup: 'orb' });
    assert.deepEqual(store.get(), { startup: 'orb' });
  } finally { db.close(); }

  const reopenedDb = new DatabaseSync(dbPath);
  try {
    assert.deepEqual(createAssistantWindowPreferences({ db: reopenedDb }).get(), { startup: 'orb' });
  } finally {
    reopenedDb.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('rejects invalid startup values without overwriting the saved preference', () => {
  const dataRoot = mkdtempSync(join(tempRoot, 'assistant-window-preferences-invalid-'));
  const db = new DatabaseSync(join(dataRoot, 'desktop.sqlite'));
  try {
    const store = createAssistantWindowPreferences({ db });
    store.save({ startup: 'expanded' });
    for (const patch of [
      { startup: 'visible' },
      { startup: '' },
      { startup: 1 },
      {},
      { startup: 'orb', extra: true },
      null,
    ]) {
      assert.throws(
        () => store.save(patch),
        (error) => error.code === 'INVALID_ASSISTANT_WINDOW_PREFERENCES' && error.status === 400,
      );
    }
    assert.deepEqual(store.get(), { startup: 'expanded' });
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});
