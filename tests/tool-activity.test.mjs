import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createToolActivityProjection, sanitizePreview } from '../scripts/tool-activity.mjs';

test('tool activity is redacted, upserted and bounded by message page', async () => {
  const base=path.resolve('.sciencescope-local/temp');
  await mkdir(base,{recursive:true});
  const root = await mkdtemp(path.join(base, 'tool-activity-'));
  const store = await new ChatStore({ stateDir: root }).init();
  try {
    await store.ensureChat({ chatId: 'chat-a', title: 'A' });
    const activity = createToolActivityProjection({ chatStore: store });
    await activity.record({ chatId: 'chat-a', assistantMessageId: 'answer-a', callId: 'call-a', turn: 2, step: 1, name: 'search', type: 'tool-call', argumentsPreview: { query: 'hello', apiKey: 'sk_secret-value' } });
    assert.equal(activity.list({chatId:'chat-a',assistantMessageIds:['answer-a']})[0].status,'running');
    await activity.record({ chatId: 'chat-a', assistantMessageId: 'answer-a', callId: 'call-a', type: 'tool-result', isError: true, resultPreview: { output: 'done', authorization: 'Bearer abcdefghijkl' } });
    const [item] = activity.list({ chatId: 'chat-a', assistantMessageIds: ['answer-a'] });
    assert.equal(item.status, 'completed');
    assert.equal(item.turn, 2);
    assert.equal(item.argumentsPreview.includes('redacted'), true);
    assert.equal(item.resultPreview.includes('redacted'), true);
    assert.equal(item.isError, true);
    assert.equal(item.name, 'search');
    const reopened = await new ChatStore({ stateDir: root }).init();
    try {
      const persisted = createToolActivityProjection({ chatStore: reopened }).list({ chatId: 'chat-a', assistantMessageIds: ['answer-a'] });
      assert.equal(persisted.length, 1);
      await createToolActivityProjection({ chatStore: reopened }).record({ chatId: 'chat-a', assistantMessageId: 'answer-a', callId: 'call-pending', type: 'tool-call', name: 'slow' });
      const settled = await createToolActivityProjection({ chatStore: reopened }).settle({ chatId: 'chat-a', assistantMessageId: 'answer-a' });
      assert.equal(settled.find((row) => row.callId === 'call-pending').status, 'interrupted');
    } finally { reopened.close(); }
    assert.deepEqual(activity.list({ chatId: 'chat-a', assistantMessageIds: ['other'] }), []);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test('sanitizer caps deep and cyclic values', () => {
  const value = { a: { b: { c: { d: 'too deep' } } }, token: 'secret' };
  value.self = value;
  const safe = sanitizePreview(value);
  assert.equal(safe.token, '[redacted]');
  assert.equal(safe.a.b.c, '[truncated]');
  assert.equal(safe.self, '[circular]');
  assert.equal(sanitizePreview('sk-FAKEFORTESTONLY123456789'), '[redacted]');
});
