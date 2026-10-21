import test from 'node:test';
import assert from 'node:assert/strict';
import { cardInput, verifyCard } from './card-input.js';

test('paper selection prioritizes methods/results, preserves whole paragraphs and excludes references', () => {
  const source = { id: 'paper', title: '研究', metadata: { author: '作者', year: 2026 } };
  const long = '研究方法使用完整段落。'.repeat(5000);
  const chunks = [
    {
      id: 'intro',
      ordinal: 0,
      kind: 'paragraph',
      section: 'Introduction',
      page: 1,
      text: 'Introductory text.',
    },
    { id: 'method', ordinal: 1, kind: 'paragraph', section: '研究方法', page: 4, text: long },
    {
      id: 'results',
      ordinal: 2,
      kind: 'paragraph',
      section: 'Results',
      page: 5,
      text: 'The result.',
    },
    { id: 'ref', ordinal: 3, kind: 'reference', page: 6, text: 'Excluded reference.' },
  ];
  const large = cardInput(source, chunks);
  assert.deepEqual(
    large.paragraphs.map((row) => row.chunkId),
    ['method'],
  );
  assert.equal(large.paragraphs[0].text, long);
  assert.ok(large.selection.estimatedTokens > 6000);
  chunks[1].text = 'Full-width punctuation：QCA（方法） threshold 0.8。';
  const small = cardInput(source, chunks);
  assert.deepEqual(
    small.paragraphs.map((row) => row.chunkId),
    ['intro', 'method', 'results'],
  );
  const evidence = { chunkId: 'method', quote: 'QCA (方法) threshold 0.8.' };
  const verified = verifyCard(
    {
      question: { text: 'Research question', evidence },
      methods: [{ name: 'QCA', evidence }],
      findings: [{ text: 'No evidence', evidence: { chunkId: 'ref', quote: chunks[3].text } }],
    },
    small,
  );
  assert.equal(verified.card.methods[0].evidence[0].page, 4);
  assert.equal(verified.card.question.text, 'Research question');
  assert.equal(verified.dropped[0].reason, 'chunk-not-in-input');
  assert.equal(verified.card.findings.length, 0);
  const fallback = cardInput(
    source,
    chunks.map((row) => ({ ...row, section: null })),
  );
  assert.equal(fallback.paragraphs[0].chunkId, 'intro');
});
