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
    getResearchItem: async (id) => ({ id, type: 'memory', subtype: 'decision', title: '终点', body: '采用 Matsuda 指数', payload: { rationale: '预先规定' }, status: 'active', visibility: 'shared', scope: 'project', projectId: 'p1' }),
    attachments: { compile: async (ids, options) => { calls.push({ ids, options }); return [{ id: ids[0], text: 'attached' }]; } },
  };
}

test('compiles user text, verified quote, annotation, and context material without mutating input', async () => {
  const f = fixture();
  const input = {
    text: 'Please compare these.', attachmentIds: ['res-1'],
    quotes: [{ sourceChatId: 'chat-1', sourceMessageId: 'message-1', selectedText: 'A source sentence', comment: 'check this' }],
    annotations: [{ id: 'ann-1', revision: 2, resourceId: 'res-1', selectedText: 'highlight', location: { page: 3 } }],
    contextRefs: [{ resourceId: 'res-2' }, { resourceId: 'res-1' }, { itemId: 'item-1' }], projectId: 'p1',
  };
  const before = structuredClone(input);
  const result = await createResearchInput(f).compile(input);
  assert.deepEqual(input, before);
  assert.match(result.text, /^Please compare these\.\n\[User-provided research material\]/);
  assert.match(result.text, /\[End user-provided research material\]/);
  assert.match(result.text, /<material id="res-1" truncated="false">\nattached\n<\/material>/);
  assert.match(result.text, /<quote source-chat="chat-1" source-message="message-1" speaker="assistant">\nA source sentence\n<comment>check this<\/comment>\n<\/quote>/);
  assert.match(result.text, /<annotation resource="res-1" location="\{&quot;page&quot;:3\}">\n<selected>highlight<\/selected>\n<\/annotation>/);
  assert.match(result.text, /<research-item id="item-1" title="终点" type="memory" subtype="decision">\n采用 Matsuda 指数\nStructured data: \{"rationale":"预先规定"\}\n<\/research-item>/);
  // Context refs are compiled with real attachments, but stay separate in the
  // receipt so failed-send restoration cannot create duplicate composer chips.
  assert.deepEqual(f.calls[0].ids, ['res-1', 'res-2']);
  assert.deepEqual(result.snapshot.attachmentIds, ['res-1']);
  assert.deepEqual(result.snapshot.contextRefs, [{ resourceId: 'res-2' }, { resourceId: 'res-1' }, { itemId: 'item-1' }]);
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
  const privateCompiler = createResearchInput({ ...f, getResearchItem: async (id) => ({ id, status: 'active', visibility: 'private', scope: 'project', projectId: 'p1' }) });
  await assert.rejects(() => privateCompiler.compile({ contextRefs: [{ itemId: 'secret' }], projectId: 'p1' }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  await assert.rejects(() => compiler.compile({ contextRefs: [{ resourceId: 'res-1', itemId: 'item-1' }] }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  await assert.rejects(() => compiler.compile({ text: 'x'.repeat(64001) }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  await assert.rejects(() => compiler.compile({ quotes: Array.from({ length: 17 }, (_, i) => ({ sourceChatId: 'chat-1', sourceMessageId: 'message-1', selectedText: `A source sentence ${i}` })) }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
});

test('performs one-message lookup and rejects unknown source identity', async () => {
  const f = fixture(); let reads = 0;
  f.chatStore.getMessage = async (...args) => { reads++; return fixture().chatStore.getMessage(...args); };
  await assert.rejects(() => createResearchInput(f).compile({ quotes: [{ sourceChatId: 'other-chat', sourceMessageId: 'message-1', selectedText: 'A source sentence' }] }), (e) => e.code === 'INVALID_RESEARCH_INPUT');
  assert.equal(reads, 1);
});

test('material bodies stay verbatim and cannot close their own block', async () => {
  const { renderResearchMaterial } = await import('../scripts/research-input.mjs');
  const text = renderResearchMaterial({ attachments: [{ id: 'r', name: 'a "q".tex', path: '/p', text: '\\frac{a}{b}\n"x" </material> y', truncated: true }] });
  assert.equal(text, '<material id="r" title="a &quot;q&quot;.tex" path="/p" truncated="true">\n\\frac{a}{b}\n"x" <\\/material> y\n</material>');
});
