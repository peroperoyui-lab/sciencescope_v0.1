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

test('Python environment refresh waits for turn/end, later run-idle, and durable assistant output', async () => {
  const base = path.resolve('.sciencescope-local', 'temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'execution-python-barrier-')); roots.push(root);
  const chatStore = await new ChatStore({ stateDir: root }).init(); stores.push(chatStore);
  await chatStore.ensureChat({ chatId: 'barrier-chat', projectId: null, title: 'Automation barrier' });
  const listeners = new Map();
  const host = {
    observeSession(sessionId, handler) { listeners.set(sessionId, handler); return () => listeners.delete(sessionId); },
    async configurePolicy() {},
    async sessionGoal() { return { id: 'goal-barrier', revision: 3, phase: 'active', activation: 'armed', roundsStarted: 2 }; },
    async getGoal() { return null; },
  };
  let releaseAppend;
  const appendGate = new Promise((resolve) => { releaseAppend = resolve; });
  const appendMessage = chatStore.appendMessage.bind(chatStore);
  let appendStarted;
  const appendStartedPromise = new Promise((resolve) => { appendStarted = resolve; });
  chatStore.appendMessage = async (message) => { appendStarted(); await appendGate; return appendMessage(message); };
  const binding = { sessionId: 'session-barrier', goalActive: false };
  const callbacks = [];
  const execution = createExecutionService({
    host,
    database: { db: chatStore.db.db },
    chatStore,
    bindings: new Map([['barrier-chat', binding]]),
    onPythonEnvironmentRefreshReady: async (payload) => {
      const row = chatStore.db.db.prepare('SELECT text FROM messages WHERE chat_id=? AND id=?').get(payload.chatId, 'runtime-session-barrier-17');
      callbacks.push({ payload, persistedText: row?.text ?? null });
    },
  });
  try {
    await execution.configure('barrier-chat', binding, 'auto');
    await execution.start('barrier-chat', binding, 'continue', 4);
    const emit = (frame) => listeners.get('session-barrier')(frame);

    // The pause acknowledgement may beat the host's event-log frame across
    // its separate control and stream connections; the barrier must correlate
    // the exact turn once its committed event arrives.
    emit({ type: 'python-env-refresh-ready', sessionId: 'session-barrier', turn: 2, source: 'turn-end', goal: { id: 'goal-barrier', revision: 4, phase: 'paused', roundsStarted: 2 } });
    emit({ type: 'committed-event', eventType: 'assistant/message', seq: 17, sequence: 40, time: '2026-09-27T00:00:00.000Z', data: { text: 'final persisted answer' } });
    await appendStartedPromise;
    emit({ type: 'committed-event', eventType: 'turn/end', sequence: 41, data: { turn: 2 } });
    emit({ type: 'run-idle', sequence: 41 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(callbacks, [], 'same-sequence/early idle cannot cross the barrier or outrun persistence');

    emit({ type: 'run-idle', sequence: 42 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(callbacks, [], 'refresh callback waits while assistant output persistence is pending');
    releaseAppend();
    await execution.waitForTurnWrites('barrier-chat');
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(callbacks, [{
      payload: { chatId: 'barrier-chat', sessionId: 'session-barrier', goal: { id: 'goal-barrier', revision: 4, phase: 'paused', roundsStarted: 2, activation: 'disarmed' }, source: 'turn-end' },
      persistedText: 'final persisted answer',
    }]);
    assert.deepEqual((await chatStore.pageMessages('barrier-chat')).messages.map((message) => message.text), ['final persisted answer']);
  } finally { releaseAppend(); await execution.close(); }
});

test.after(async () => { for (const store of stores) store.close(); for (const root of roots) await rm(root, { recursive: true, force: true }); });
