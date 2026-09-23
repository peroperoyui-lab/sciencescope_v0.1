import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createShortcutSettings } from "../scripts/shortcut-settings.mjs";
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';

function store(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  return createShortcutSettings({ db });
}

test("shortcut settings persists one JSON row and returns defaults", (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(()=>db.close());
    const settings = createShortcutSettings({ db });
    assert.deepEqual(settings.get(), { bindings: {
      search: "Ctrl+K", browse: "Ctrl+Shift+K", newChat: "Ctrl+N", independentChat: "Ctrl+Alt+N",
    } });
    settings.save({ bindings: { search: "Ctrl+Shift+F", browse: "Ctrl+Shift+B", newChat: "Ctrl+Alt+M", independentChat: "Ctrl+Alt+G" } });
    assert.equal(settings.get().bindings.search, "Ctrl+Shift+F");
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM shortcut_settings").get().count, 1);
});

test("shortcut settings rejects duplicate and invalid bindings without writing", (t) => {
    const settings = store(t);
    assert.throws(() => settings.save({ bindings: { search: "Ctrl+K", browse: "Ctrl+K", newChat: "Ctrl+N", independentChat: "Ctrl+Alt+N" } }), /unique/);
    assert.throws(() => settings.save({ bindings: { search: "Ctrl+A", browse: "Ctrl+Shift+B", newChat: "Ctrl+N", independentChat: "Ctrl+Alt+N" } }), /invalid/);
    assert.deepEqual(settings.get().bindings, { search: "Ctrl+K", browse: "Ctrl+Shift+K", newChat: "Ctrl+N", independentChat: "Ctrl+Alt+N" });
});

test("shortcut settings rejects non-exact binding objects with typed 400 errors", (t) => {
    const settings = store(t);
    assert.throws(() => settings.save({ bindings: { search: "Ctrl+K" } }), (error) => error.code === "INVALID_SHORTCUTS" && error.status === 400);
});

test("shortcut settings resets persisted settings to defaults", (t) => {
    const settings = store(t);
    settings.save({ bindings: { search: "Ctrl+Shift+F", browse: "Ctrl+Shift+B", newChat: "Ctrl+Alt+M", independentChat: "Ctrl+Alt+G" } });
    assert.deepEqual(settings.reset().bindings, { search: "Ctrl+K", browse: "Ctrl+Shift+K", newChat: "Ctrl+N", independentChat: "Ctrl+Alt+N" });
});

test('shortcut settings survive closing and reopening the file database',()=>{
  const base=path.resolve('.sciencescope-local/temp');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(path.join(base,'shortcut-store-')),file=path.join(root,'settings.sqlite');let db;
  try{db=new DatabaseSync(file);const settings=createShortcutSettings({db});const bindings={...settings.get().bindings,search:'Ctrl+Shift+F'};settings.save({bindings});db.close();db=new DatabaseSync(file);assert.deepEqual(createShortcutSettings({db}).get(),{bindings});}
  finally{db?.close();rmSync(root,{recursive:true,force:true});}
});
