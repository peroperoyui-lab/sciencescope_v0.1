import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSecretaryPreferences, DEFAULT_NOTES_TEMPLATE } from '../scripts/secretary-preferences.mjs';

const tempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
mkdirSync(tempRoot, { recursive: true });

test('persists the secretary notes template and returns the default', () => {
  const dataRoot = mkdtempSync(join(tempRoot, 'secretary-preferences-'));
  const dbPath = join(dataRoot, 'desktop.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const store = createSecretaryPreferences({ db });
    assert.deepEqual(store.get(), { notesTemplate: DEFAULT_NOTES_TEMPLATE });
    const custom = '# 自定义\n本次变化';
    assert.deepEqual(store.save({ notesTemplate: custom }), { notesTemplate: custom });
    assert.deepEqual(store.get(), { notesTemplate: custom });
  } finally { db.close(); }
  const reopenedDb = new DatabaseSync(dbPath);
  try {
    assert.equal(createSecretaryPreferences({ db: reopenedDb }).get().notesTemplate, '# 自定义\n本次变化');
  } finally {
    reopenedDb.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('rejects empty, oversized, and malformed secretary preferences', () => {
  const dataRoot = mkdtempSync(join(tempRoot, 'secretary-preferences-invalid-'));
  const db = new DatabaseSync(join(dataRoot, 'desktop.sqlite'));
  try {
    const store = createSecretaryPreferences({ db });
    for (const patch of [{ notesTemplate: '' }, { notesTemplate: '   ' }, { notesTemplate: 'x'.repeat(16001) }, {}, { notesTemplate: 42 }, { other: 'x' }]) {
      assert.throws(() => store.save(patch), (error) => error.code === 'INVALID_SECRETARY_PREFERENCES' && error.status === 400);
    }
    assert.deepEqual(store.get(), { notesTemplate: DEFAULT_NOTES_TEMPLATE });
  } finally { db.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});
