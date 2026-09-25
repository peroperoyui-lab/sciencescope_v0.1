import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createDesktopPreferences } from '../scripts/desktop-preferences.mjs';

const testTempRoot = join(process.cwd(), '.sciencescope-local', 'temp');
mkdirSync(testTempRoot, { recursive: true });

function openStore() {
  const dataRoot = mkdtempSync(join(testTempRoot, 'sciencescope-preferences-'));
  const db = new DatabaseSync(join(dataRoot, 'desktop.sqlite'));
  return { dataRoot, db, store: createDesktopPreferences({ db, dataRoot }) };
}

function closeStore({ dataRoot, db }) {
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

test('returns defaults and persists partial updates across reopen', () => {
  const first = openStore();
  try {
    assert.deepEqual(first.store.get(), { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 16, sendKey: 'enter', reduceMotion: false, showScrollbars: false, uiFont: 'default' });
    assert.deepEqual(first.store.save({ chatFontSize: 20, reduceMotion: true }), { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 20, sendKey: 'enter', reduceMotion: true, showScrollbars: false, uiFont: 'default' });
    assert.deepEqual(first.store.get(), { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 20, sendKey: 'enter', reduceMotion: true, showScrollbars: false, uiFont: 'default' });
  } finally {
    const { dataRoot } = first;
    first.db.close();
    const reopenedDb = new DatabaseSync(join(dataRoot, 'desktop.sqlite'));
    try {
      const reopened = createDesktopPreferences({ db: reopenedDb, dataRoot });
      assert.deepEqual(reopened.get(), { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 20, sendKey: 'enter', reduceMotion: true, showScrollbars: false, uiFont: 'default' });
    } finally {
      reopenedDb.close();
      rmSync(dataRoot, { recursive: true, force: true });
    }
  }
});

test('partial saves preserve existing values', () => {
  const context = openStore();
  try {
    context.store.save({ sendKey: 'ctrl-enter', showScrollbars: true, uiFont: 'default' });
    assert.deepEqual(context.store.save({ chatFontSize: 14 }), { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 14, sendKey: 'ctrl-enter', reduceMotion: false, showScrollbars: true, uiFont: 'default' });
  } finally { closeStore(context); }
});

test('rejects unknown or malformed patches without changing state', () => {
  const context = openStore();
  try {
    const before = context.store.save({ chatFontSize: 18, reduceMotion: true });
    for (const patch of [{ typo: true }, { theme: 'solarized' }, { density: 'wide' }, { codeFontSize: 17 }, { chatFontSize: 17 }, { sendKey: 'meta-enter' }, { reduceMotion: 'yes' }, null, []]) {
      assert.throws(() => context.store.save(patch), (error) => error.code === 'INVALID_PREFERENCES' && error.status === 400);
      assert.deepEqual(context.store.get(), before);
    }
  } finally { closeStore(context); }
});

test('migrates an existing old table without overwriting its settings', () => {
  const dataRoot = mkdtempSync(join(testTempRoot, 'sciencescope-preferences-migration-'));
  const db = new DatabaseSync(join(dataRoot, 'desktop.sqlite'));
  try {
    db.exec(`
      CREATE TABLE desktop_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        chat_font_size INTEGER NOT NULL,
        send_key TEXT NOT NULL,
        reduce_motion INTEGER NOT NULL,
        show_scrollbars INTEGER NOT NULL
      );
      INSERT INTO desktop_preferences VALUES (1, 18, 'ctrl-enter', 1, 1);
    `);
    const store = createDesktopPreferences({ db, dataRoot });
    assert.deepEqual(store.get(), { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 18, sendKey: 'ctrl-enter', reduceMotion: true, showScrollbars: true, uiFont: 'default' });
  } finally {
    db.close();
    rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('reset restores and persists all preference defaults', () => {
  const context = openStore();
  try {
    context.store.save({ theme: 'dark', density: 'compact', codeFontSize: 18, chatFontSize: 20, sendKey: 'ctrl-enter', reduceMotion: true, showScrollbars: true, uiFont: '微软雅黑' });
    assert.equal(context.store.get().uiFont, '微软雅黑');
    assert.throws(() => context.store.save({ uiFont: 'x"; color:red' }), /uiFont/);
    const defaults = { theme: 'light', density: 'standard', codeFontSize: 14, chatFontSize: 16, sendKey: 'enter', reduceMotion: false, showScrollbars: false, uiFont: 'default' };
    assert.deepEqual(context.store.reset(), defaults);
    assert.deepEqual(context.store.get(), defaults);
    const reopenedDb = new DatabaseSync(join(context.dataRoot, 'desktop.sqlite'));
    try {
      assert.deepEqual(createDesktopPreferences({ db: reopenedDb, dataRoot: context.dataRoot }).get(), defaults);
    } finally { reopenedDb.close(); }
  } finally { closeStore(context); }
});
