import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchInput } from '../scripts/research-input.mjs';

function fixture() {
  const messages = new Map([
    ['chat-1/message-1', { id: 'message-1', role: 'assistant', text: 'A source sentence and more.' }],
    ['chat-1/message-2', { id: 'message-2', role: 'user', text: 'User supplied source.' }],
  ]);
  const resources = new Set(['res-1', 'res-2']);
  const calls = [];
  return {
    calls,
    chatStore: { getMessage: async (chatId, messageId) => messages.get(`${chatId}/${messageId}`) },
    getResource: async (id) => resources.has(id) ? { id } : null,
    attachments: { compile: async (ids, options) => { calls.push({ ids, options }); return [{ id: ids[0], text: 'attached' }]; } },
  };
}

test('compiles user text, verified quote, annotation, and context material without mutating input', async () => {
  const f = fixture();
  const input = {
    text: 'Please compare these.', attachmentIds: ['res-1'],
    quotes: [{ sourceChatId: 'chat-1', sourceMessageId: 'message-1', selectedText: 'A source sentence', comment: 'check this' }],
    annotations: [{ id: 'ann-1', revision: 2, resourceId: 'res-1', selectedText: 'highlight', location: { page: 3 } }],
    contextRefs: [{ resourceId: 'res-2' }, { resourceId: 'res-1' }],
  };
  const before = structuredClone(input);
  const result = await createResearchInput(f).compile(input);
  assert.deepEqual(input, before);
  assert.match(result.text, /^Please compare these\.\n\[User-provided research material\]/);
  assert.match(result.text, /\[End user-provided research material\]/);
  assert.deepEqual(result.snapshot.attachmentIds, ['res-1', 'res-2']);
  assert.equal(result.snapshot.messageQuotes[0].speaker, 'assistant');
  assert.equal(f.calls[0].options.structured, true);
});

test('rejects unknown quote identity, missing resources, and bounds', async () => {
  const f = fixture();
  const compiler = createResearchInput(f);
  const selected = await compiler.compile({ quotes: [{ sourceChatId: 'chat-1', sourceMessageId: 'message-1', selectedText: 'rendered cross-tag excerpt' }] });
  assert.equal(selected.snapshot.messageQuotes[0].selectedText, 'rendered cross-tag excerpt');
  await assert.rejects(() => compiler.compile({ quotes: [{ sourceChatId: 'other-chat', sourceMessageId: 'message-1', selectedText: 'anything' }] }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  await assert.rejects(() => compiler.compile({ annotations: [{ id: 'a', revision: 1, resourceId: 'missing', selectedText: 'x' }] }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  await assert.rejects(() => compiler.compile({ text: 'x'.repeat(64001) }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  await assert.rejects(() => compiler.compile({ quotes: Array.from({ length: 17 }, (_, i) => ({ sourceChatId: 'chat-1', sourceMessageId: 'message-1', selectedText: `A source sentence ${i}` })) }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
});

test('performs one-message lookup and rejects unknown source identity', async () => {
  const f = fixture(); let reads = 0;
  f.chatStore.getMessage = async (...args) => { reads++; return fixture().chatStore.getMessage(...args); };
  await assert.rejects(() => createResearchInput(f).compile({ quotes: [{ sourceChatId: 'other-chat', sourceMessageId: 'message-1', selectedText: 'A source sentence' }] }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  assert.equal(reads, 1);
});
