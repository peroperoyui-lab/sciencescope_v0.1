import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createSecretaryPreferences, DEFAULT_NOTES_TEMPLATE, DEFAULT_SUMMARY } from '../scripts/secretary-preferences.mjs';

const tempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
mkdirSync(tempRoot, { recursive: true });

test('persists the secretary notes template and returns the default', () => {
  const dataRoot = mkdtempSync(join(tempRoot, 'secretary-preferences-'));
  const dbPath = join(dataRoot, 'desktop.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const store = createSecretaryPreferences({ db });
    assert.deepEqual(store.get(), { notesTemplate: DEFAULT_NOTES_TEMPLATE, summary: DEFAULT_SUMMARY });
    const custom = '# 自定义\n本次变化';
    assert.deepEqual(store.save({ notesTemplate: custom }), { notesTemplate: custom });
    assert.deepEqual(store.get(), { notesTemplate: custom, summary: DEFAULT_SUMMARY });
  } finally { db.close(); }
  const reopenedDb = new DatabaseSync(dbPath);
  try {
    assert.equal(createSecretaryPreferences({ db: reopenedDb }).get().notesTemplate, '# 自定义\n本次变化');
    assert.deepEqual(createSecretaryPreferences({ db: reopenedDb }).get().summary, DEFAULT_SUMMARY);
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
    assert.deepEqual(store.get(), { notesTemplate: DEFAULT_NOTES_TEMPLATE, summary: DEFAULT_SUMMARY });
  } finally { db.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});

test('migrates old preferences, keeps language defaults, and validates partial summary patches', () => {
  const dataRoot = mkdtempSync(join(tempRoot, 'secretary-preferences-migration-'));
  const db = new DatabaseSync(join(dataRoot, 'desktop.sqlite'));
  try {
    db.exec('CREATE TABLE secretary_preferences (id INTEGER PRIMARY KEY CHECK(id=1), notes_template TEXT NOT NULL)');
    db.prepare('INSERT INTO secretary_preferences VALUES(1, ?)').run('');
    const store = createSecretaryPreferences({ db });
    assert.equal(store.get({ language: 'en' }).notesTemplate, '# Version notes\nCompared with\nWhat changed\nRelation to the current research\nFor the user to decide\nRelated map nodes and files');
    const saved = store.save({ summary: { everyMessages: { enabled: false, n: 40 }, workbench: { plans: 'propose' } } });
    assert.equal(saved.summary.everyMessages.enabled, false);
    assert.equal(saved.summary.everyTokens.n, DEFAULT_SUMMARY.everyTokens.n);
    assert.equal(store.get().summary.workbench.plans, 'propose');
    assert.equal(store.get({ language: 'en' }).notesTemplate, '# Version notes\nCompared with\nWhat changed\nRelation to the current research\nFor the user to decide\nRelated map nodes and files');
    for (const patch of [
      { summary: { everyMessages: { n: 3 } } },
      { summary: { everyTokens: { n: 500001 } } },
      { summary: { workbench: { plans: 'bad' } } },
      { summary: { unknown: true } },
    ]) assert.throws(() => store.save(patch), (error) => error.code === 'INVALID_SECRETARY_PREFERENCES' && error.status === 400);
  } finally { db.close(); rmSync(dataRoot, { recursive: true, force: true }); }
});
