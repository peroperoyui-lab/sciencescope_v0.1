import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createExecutionService } from '../scripts/execution-service.mjs';

const roots = [];
const stores = [];

test('automation committed turn invokes onTurnPersisted after the assistant row is durable', async () => {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'execution-service-')); roots.push(root);
  const chatStore = await new ChatStore({ stateDir: root }).init(); stores.push(chatStore);
  await chatStore.ensureChat({ chatId: 'auto-chat', projectId: null, title: 'Automation' });
  const listeners = new Map();
  const host = {
    observeSession(sessionId, handler) { listeners.set(sessionId, handler); return () => listeners.delete(sessionId); },
    async configurePolicy() {},
    async sessionGoal() { return { id: 'goal-1', revision: 1, phase: 'active', activation: 'armed', roundsStarted: 1 }; },
    async getGoal() { return null; },
  };
  const binding = { sessionId: 'session-auto', goalActive: false };
  const callbacks = [];
  const execution = createExecutionService({
    host,
    database: { db: chatStore.db.db },
    chatStore,
    bindings: new Map([['auto-chat', binding]]),
    onTurnPersisted: (payload) => {
      const row = chatStore.db.db.prepare('SELECT text FROM messages WHERE chat_id=? AND id=?').get(payload.chatId, 'runtime-session-auto-7');
      callbacks.push({ payload, persistedText: row?.text ?? null });
    },
  });
  try {
    await execution.configure('auto-chat', binding, 'auto');
    await execution.start('auto-chat', binding, 'continue', 2);
    listeners.get('session-auto')({ type: 'committed-event', eventType: 'assistant/message', seq: 7, time: '2026-09-27T00:00:00.000Z', data: { text: 'persisted automatic answer' } });
    await execution.status('auto-chat');
    assert.deepEqual(callbacks, [{ payload: { chatId: 'auto-chat' }, persistedText: 'persisted automatic answer' }]);
    assert.deepEqual((await chatStore.pageMessages('auto-chat')).messages.map((message) => message.text), ['persisted automatic answer']);
  } finally { await execution.close(); }
});

test.after(async () => { for (const store of stores) store.close(); for (const root of roots) await rm(root, { recursive: true, force: true }); });
