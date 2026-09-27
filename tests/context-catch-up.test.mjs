import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createCatchUp } from '../scripts/context/catch-up.mjs';

const roots = [];
const stores = [];

async function fixture({ refresh = async () => state.current, refreshWaitMs = 60000 } = {}) {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'context-catch-up-')); roots.push(root);
  const store = await new ChatStore({ stateDir: root }).init(); stores.push(store);
  await store.ensureChat({ chatId: 'main', projectId: null, title: 'Main' });
  const db = store.db.db;
  db.exec(`CREATE TABLE assistant_conversations(scope TEXT NOT NULL, owner_id TEXT NOT NULL, chat_id TEXT NOT NULL UNIQUE, PRIMARY KEY(scope,owner_id));`);
  await store.ensureChat({ chatId: 'assistant', projectId: null, title: 'Secretary' });
  db.prepare('INSERT INTO assistant_conversations VALUES(?,?,?)').run('secretary', 'main', 'assistant');
  const state = { current: null, refreshes: 0 };
  const messagesAfter = (chatId, ordinal) => db.prepare("SELECT ordinal,id,role,text FROM messages WHERE chat_id=? AND ordinal>=? AND role IN ('user','assistant') ORDER BY ordinal").all(chatId, ordinal).map((row) => ({ ordinal: row.ordinal + 1, id: row.id, role: row.role, text: row.text, speaker: row.role === 'user' ? 'User' : 'Main expert', files: [] }));
  const minutes = {
    get: () => state.current,
    messagesAfter,
    format: (message) => `<message n="${message.ordinal}" speaker="${message.speaker}">\n${message.text}\n</message>`,
    refresh: async (chatId) => { state.refreshes += 1; return refresh(chatId, state); },
  };
  return { root, store, db, state, minutes, access: createCatchUp({ db, minutes, status: null, refreshWaitMs }) };
}

test.after(async () => {
  for (const store of stores) store.close();
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function append(store, text, role = 'user', id = `m-${Math.random().toString(36).slice(2)}`) {
  await store.appendMessage({ chatId: 'main', id, role, text });
}

test('small and 65000-character messages remain verbatim, while large catch-up refreshes minutes and keeps a tail', async () => {
  const f = await fixture({ refresh: async (_chatId, state) => state.current });
  const exact = `SINGLE-${'x'.repeat(65000)}-END`;
  await append(f.store, exact, 'user', 'single');
  const packet = await f.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  assert.match(packet.text, /SINGLE-x+/); assert.match(packet.text, /-END/);
  assert.doesNotMatch(packet.text, /message shortened|省略/);
  await packet.commit({ type: 'completed' });

  f.state.refreshes = 0;
  await append(f.store, `OLDER-${'o'.repeat(65000)}-END`, 'user', 'older');
  await append(f.store, 'TAIL-EXACT', 'assistant', 'tail');
  f.state.current = { revision: 3, author: 'secretary', throughOrdinal: 2, text: 'REFRESHED MINUTES' };
  const large = await f.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  assert.equal(f.state.refreshes, 1);
  assert.match(large.text, /REFRESHED MINUTES/); assert.match(large.text, /TAIL-EXACT/);
  assert.doesNotMatch(large.text, /OLDER-o{1000}/);
});

test('refresh timeout and refresh failure are explicit, and a 240k safety bound names whole omitted messages', async () => {
  const timeout = await fixture({ refresh: async () => new Promise(() => {}), refreshWaitMs: 10 });
  await append(timeout.store, 'TIMEOUT-' + 't'.repeat(65000), 'user', 'timeout-message');
  const timed = await timeout.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  assert.match(timed.text, /Minutes refresh exceeded 60 seconds/);

  const failure = await fixture({ refresh: async () => { throw new Error('refresh unavailable'); }, refreshWaitMs: 10 });
  await append(failure.store, 'FAILURE-' + 'f'.repeat(65000), 'user', 'failure-message');
  const failed = await failure.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  assert.match(failed.text, /Minutes refresh failed/);

  const bounded = await fixture();
  for (let i = 1; i <= 5; i += 1) await append(bounded.store, `MESSAGE-${i}-` + String(i).repeat(60000), 'user', `bounded-${i}`);
  const packet = await bounded.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  assert.match(packet.text, /Safety bound: messages #1/);
  assert.doesNotMatch(packet.text, /MESSAGE-1-/);
  assert.match(packet.text, /MESSAGE-5-/);
});

test('failed or stopped sends do not advance; edited minutes trigger a packet without new messages', async () => {
  const f = await fixture();
  await append(f.store, 'FIRST', 'user', 'first');
  f.state.current = { revision: 1, author: 'secretary', throughOrdinal: 1, text: 'FIRST MINUTES' };
  const first = await f.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  await assert.rejects(first.commit({ type: 'failed' }), error => error.code === 'COMMIT_NOT_ACCEPTED');
  assert.equal((await f.access.followUp({ conversationId: 'assistant', chatId: 'main' })).seenOrdinal, 0);
  await assert.rejects(first.commit({ type: 'stopped' }), error => error.code === 'COMMIT_NOT_ACCEPTED');
  await first.commit({ type: 'completed' });

  f.state.current = { revision: 2, author: 'user', throughOrdinal: 1, text: 'USER-EDITED MINUTES' };
  const edited = await f.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  assert.match(edited.text, /USER-EDITED MINUTES/);
  await edited.commit({ type: 'completed' });
  assert.equal((await f.access.followUp({ conversationId: 'assistant', chatId: 'main' })).minutesRevision, 2);
});

test('commit stores exactly the revision included by its packet, and ownership is enforced', async () => {
  const f = await fixture();
  await append(f.store, 'ONE', 'user', 'one');
  f.state.current = { revision: 1, author: 'secretary', throughOrdinal: 1, text: 'REVISION ONE' };
  const packet = await f.access.catchUp({ conversationId: 'assistant', chatId: 'main' });
  f.state.current = { revision: 2, author: 'secretary', throughOrdinal: 1, text: 'REVISION TWO' };
  await packet.commit({ type: 'completed' });
  assert.equal((await f.access.followUp({ conversationId: 'assistant', chatId: 'main' })).minutesRevision, 1);
  await assert.rejects(f.access.catchUp({ conversationId: 'not-secretary', chatId: 'main' }), error => error.code === 'SCOPE_MISMATCH');
});
