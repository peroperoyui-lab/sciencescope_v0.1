import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createRoleSettings, RoleSettingsError, builtinRolePrompts } from '../scripts/role-settings.mjs';

const root = join(process.cwd(), '.sciencescope-local', 'temp', 'role-settings-tests');
function fixture(name) {
  const dir = join(root, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const path = join(dir, 'settings.sqlite');
  const db = new DatabaseSync(path);
  return { db, path, store: createRoleSettings({ db }) };
}
function close(f) { try { f.db.close(); } finally { rmSync(join(root), { recursive: true, force: true }); } }

test('saved role settings survive close and reopen', () => {
  const f = fixture('reopen');
  try {
    const saved = f.store.save('main', { prompt: '  A durable prompt  ', model: { providerId: 'p', modelId: 'm' }, reasoningEffort: 'high' });
    assert.equal(saved.prompt, 'A durable prompt'); assert.equal(saved.revision, 1);
    f.db.close();
    const db = new DatabaseSync(f.path); const reopened = createRoleSettings({ db });
    assert.deepEqual(reopened.get('main'), { role: 'main', prompt: 'A durable prompt', model: { providerId: 'p', modelId: 'm' }, reasoningEffort: 'high', revision: 1 });
    db.close();
  } finally { rmSync(join(root), { recursive: true, force: true }); }
});

test('binding is a stable snapshot despite later saves', () => {
  const f = fixture('stable');
  try {
    f.store.save('global', { prompt: 'first', model: null, reasoningEffort: null });
    const bound = f.store.bind('chat-1', 'global');
    f.store.save('global', { prompt: 'second', model: null, reasoningEffort: null });
    assert.deepEqual(f.store.getBinding('chat-1'), bound);
  } finally { close(f); }
});

test('existing binding uses builtin prompt and revision zero', () => {
  const f = fixture('existing');
  try { assert.deepEqual(f.store.bind('chat-2', 'secretary', { existing: true }), { chatId: 'chat-2', role: 'secretary', prompt: builtinRolePrompts.secretary, revision: 0 }); }
  finally { close(f); }
});

test('main builtin prompt sets rigorous research persona without changing saved or bound prompts', () => {
  const f = fixture('main-persona');
  try {
    const builtin = f.store.builtins.main;
    assert.match(builtin, /evidence.*methods.*assumptions.*uncertainty/s);
    assert.match(builtin, /formulas.*statistical assumptions.*evidential basis/s);
    assert.match(builtin, /understand, judge, and correct/);
    assert.match(builtin, /Explain basic concepts when the user requests them/);
    assert.match(builtin, /private user profile/);
    assert.doesNotMatch(builtin, /teaching tutor/);
    const bound = f.store.bind('main-persona-chat', 'main', { existing: true });
    f.store.save('main', { prompt: 'Saved custom prompt', model: null, reasoningEffort: null });
    assert.equal(f.store.getBinding('main-persona-chat').prompt, bound.prompt);
    assert.equal(f.store.get('main').prompt, 'Saved custom prompt');
  } finally { close(f); }
});

test('explicit apply snapshot records receipt and applies that snapshot', () => {
  const f = fixture('receipt');
  try {
    f.store.save('main', { prompt: 'newer', model: null, reasoningEffort: null });
    const applied = f.store.applyPrompt('chat-3', 'main', { role: 'main', prompt: 'captured', revision: 7 });
    assert.deepEqual(applied, { chatId: 'chat-3', role: 'main', prompt: 'captured', revision: 7 });
    assert.deepEqual(f.store.getBinding('chat-3'), applied);
    const receipts = f.store.listReceipts('chat-3');
    assert.equal(receipts.length, 1); assert.equal(receipts[0].chatId, 'chat-3'); assert.equal(receipts[0].revision, 7); assert.ok(receipts[0].id); assert.ok(receipts[0].at);
  } finally { close(f); }
});

test('malformed settings fail with typed 400 error', () => {
  const f = fixture('invalid');
  try {
    assert.throws(() => f.store.save('nope', { prompt: 'x' }), e => e instanceof RoleSettingsError && e.code === 'INVALID_ROLE_SETTINGS' && e.status === 400);
    assert.throws(() => f.store.save('main', { prompt: '   ' }), e => e.code === 'INVALID_ROLE_SETTINGS');
  } finally { close(f); }
});

test('legacy defaults update only untouched revision zero rows and preserve bindings and receipts', () => {
  const f = fixture('legacy-upgrade');
  const legacy = {
    global: "You are ScienceScope's private global assistant. Use only explicitly supplied context; do not claim to inspect unrelated projects. You may use capabilities granted by the runtime and must accurately report actions and results.",
    secretary: "You are ScienceScope's private task secretary. Use only explicitly supplied context, may use capabilities granted by the runtime, and must accurately report actions and results.",
  };
  try {
    for (const role of Object.keys(legacy)) f.db.prepare('UPDATE role_settings SET prompt=?,revision=0 WHERE role=?').run(legacy[role], role);
    f.db.prepare('INSERT OR REPLACE INTO role_bindings(chat_id,role,prompt,revision) VALUES(?,?,?,?)').run('legacy-bound', 'global', legacy.global, 0);
    f.db.prepare('INSERT OR REPLACE INTO role_prompt_receipts(id,chat_id,role,revision,at) VALUES(?,?,?,?,?)').run('legacy-receipt', 'legacy-bound', 'global', 0, '2026-01-01T00:00:00.000Z');
    const upgraded = createRoleSettings({ db: f.db });
    assert.equal(upgraded.get('global').prompt, builtinRolePrompts.global); assert.equal(upgraded.get('global').revision, 0);
    assert.equal(upgraded.get('secretary').prompt, builtinRolePrompts.secretary); assert.equal(upgraded.get('secretary').revision, 0);
    assert.deepEqual(upgraded.getBinding('legacy-bound'), { chatId: 'legacy-bound', role: 'global', prompt: legacy.global, revision: 0 });
    assert.deepEqual(upgraded.listReceipts('legacy-bound').map((row) => ({ ...row })), [{ id: 'legacy-receipt', chatId: 'legacy-bound', role: 'global', revision: 0, at: '2026-01-01T00:00:00.000Z' }]);

    for (const role of Object.keys(legacy)) f.db.prepare('UPDATE role_settings SET prompt=?,revision=1 WHERE role=?').run(legacy[role], role);
    const edited = createRoleSettings({ db: f.db });
    assert.equal(edited.get('global').prompt, legacy.global); assert.equal(edited.get('global').revision, 1);
    assert.equal(edited.get('secretary').prompt, legacy.secretary); assert.equal(edited.get('secretary').revision, 1);
  } finally { close(f); }
});
