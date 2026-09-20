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
