import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createChatOutbox } from '../scripts/chat-outbox.mjs';

const turn = (n) => ({ text: `question ${n}`, model: { providerId: 'offline', modelId: 'fixture' }, projectId: 'project-a', userMessageId: `u-${n}`, assistantMessageId: `a-${n}` });
await mkdir(path.resolve('.sciencescope-local/temp'),{recursive:true});

test('outbox persists, claims in order, pauses on failure and does not retry', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.sciencescope-local', 'temp', 'outbox-'));
  let store = await new ChatStore({ stateDir: root }).init();
  await store.ensureChat({ chatId: 'chat-a', title: 'A' });
  let outbox = createChatOutbox({ chatStore: store });
  const first = await outbox.enqueue({ chatId: 'chat-a', input: turn(1) });
  const second = await outbox.enqueue({ chatId: 'chat-a', input: { ...turn(2), executionMode: 'full', reasoningEffort: 'medium' } });
  assert.equal(outbox.list('chat-a').paused, false);
  await outbox.resume('chat-a');
  assert.equal((await outbox.claim({ chatId: 'chat-a', id: second.id })), null);
  const claimed = await outbox.claim({ chatId: 'chat-a', id: first.id });
  assert.equal(claimed.status, 'sending');
  assert.equal(await outbox.claim({chatId:'chat-a',id:second.id}),null);
  assert.equal((await outbox.finish({ chatId: 'chat-a', id: first.id })), true);
  const claimed2 = await outbox.claim({ chatId: 'chat-a', id: second.id });
  assert.equal(claimed2.input.executionMode, 'full');
  assert.equal(await outbox.fail({ chatId: 'chat-a', id: second.id }), true);
  assert.equal(outbox.list('chat-a').paused, true);
  assert.equal((await outbox.claim({ chatId: 'chat-a', id: second.id })), null);
  store.close();
  store = await new ChatStore({ stateDir: root }).init();
  outbox = createChatOutbox({ chatStore: store });
  assert.equal(outbox.list('chat-a').items[0].status, 'interrupted');
  assert.equal(outbox.list('chat-a').paused,true);
  await outbox.resume('chat-a');
  store.close();store=await new ChatStore({stateDir:root}).init();outbox=createChatOutbox({chatStore:store});
  assert.equal(outbox.list('chat-a').paused,true,'restart disarms even an explicitly resumed queue');
  store.close();
  await rm(root, { recursive: true, force: true });
});

test('rejects temporary, automatic and attached turns; cancellation is bounded', async () => {
  const root = await mkdtemp(path.join(process.cwd(), '.sciencescope-local', 'temp', 'outbox-reject-'));
  const store = await new ChatStore({ stateDir: root }).init();
  await store.ensureChat({ chatId: 'chat-a', title: 'A' });
  const outbox = createChatOutbox({ chatStore: store });
  await assert.rejects(() => outbox.enqueue({ chatId: 'chat-a', input: { ...turn(1), temporary: true } }));
  await assert.rejects(() => outbox.enqueue({ chatId: 'chat-a', input: { ...turn(1), executionMode: 'auto' } }));
  await assert.rejects(() => outbox.enqueue({ chatId: 'chat-a', input: { ...turn(1), attachments: ['x'] } }));
  const queued = await outbox.enqueue({ chatId: 'chat-a', input: turn(3) });
  assert.equal(await outbox.cancel({ chatId: 'chat-a', id: queued.id }), true);
  assert.equal(outbox.list('chat-a').items.length, 0);
  store.close(); await rm(root, { recursive: true, force: true });
});
