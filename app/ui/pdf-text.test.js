import test from 'node:test';
import assert from 'node:assert/strict';
import { findOnPage, placeOnPage, skeleton } from './pdf-text.js';

// The page as pdf.js's text layer holds it, and the blocks the session read from it.
const LAYER = [
  'Chapter 3 · Consistency',
  'Consistency assesses the degree to which cases agree. When consis-',
  'tency is low, there is little point in assessing coverage.',
  '城市 韧性 的测度',
  'The ﬁrst test is consistency; the second test is coverage.',
  '12',
].join('');
const BLOCKS = [
  { id: 'b:0', text: 'Chapter 3 · Consistency' },
  {
    id: 'b:1',
    text: 'Consistency assesses the degree to which cases agree. When consistency is low, there is little point in assessing coverage.',
  },
  { id: 'b:2', text: '城市韧性的测度' },
  { id: 'b:3', text: 'The first test is consistency; the second test is coverage.' },
];

/** Skeleton positions of `words` (the `nth` time they occur) on the page. */
function onPage(words, nth = 0) {
  const page = skeleton(LAYER).chars;
  const needle = skeleton(words).chars;
  let at = -1;
  for (let count = 0; count <= nth; count++) at = page.indexOf(needle, at + 1);
  return { page, start: at, end: at + needle.length };
}

test('the page and the session text agree without spaces, hyphens and ligatures', () => {
  assert.equal(skeleton('consis-\ntency').chars, 'consistency');
  assert.equal(skeleton('城市 韧性').chars, '城市韧性');
  const { chars, at } = skeleton('The ﬁrst');
  assert.equal(chars, 'Thefirst');
  // Both letters of the ligature point at it.
  assert.deepEqual(at.slice(3, 5), [4, 4]);
});

test('selected words are placed in their block, repeated words by their context', () => {
  const low = onPage('consistency is low');
  assert.deepEqual(placeOnPage(low.page, low.start, low.end, BLOCKS), {
    blockId: 'b:1',
    from: 59,
    to: 77,
  });
  // The second 'test' is the one after 'the second'.
  const second = onPage('test', 1);
  const placed = placeOnPage(second.page, second.start, second.end, BLOCKS);
  assert.equal(placed?.blockId, 'b:3');
  assert.equal(BLOCKS[3].text.slice(0, placed?.from), 'The first test is consistency; the second ');
  const cjk = onPage('韧性');
  assert.deepEqual(placeOnPage(cjk.page, cjk.start, cjk.end, BLOCKS), {
    blockId: 'b:2',
    from: 2,
    to: 4,
  });
  // A running page number belongs to no block; two blocks at once to neither.
  const number = onPage('12');
  assert.equal(placeOnPage(number.page, number.start, number.end, BLOCKS), null);
  const across = onPage('coverage.城市');
  assert.equal(placeOnPage(across.page, across.start, across.end, BLOCKS), null);
});

test('block offsets are found again on the page', () => {
  const page = skeleton(LAYER).chars;
  const text = BLOCKS[3].text;
  const from = text.lastIndexOf('test');
  const at = findOnPage(page, text, from, from + 4);
  assert.ok(at);
  assert.equal(page.slice(0, at[0]).endsWith('thesecond'), true);
  assert.equal(page.slice(at[0], at[1]), 'test');
  const hyphen = BLOCKS[1].text.indexOf('consistency');
  const split = findOnPage(page, BLOCKS[1].text, hyphen, hyphen + 11);
  assert.equal(split && page.slice(split[0], split[1]), 'consistency');
});

test('whole sentences of a Word-exported Chinese PDF land in one block', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseDocument } = await import('../services/research/parsers/index.js');
  const folder = new URL('../services/research/parsers/fixtures/u6a/', import.meta.url);
  const name = 'word-export-zh.pdf';
  const { blocks } = await parseDocument(await readFile(new URL(name, folder)), { name });
  const content = JSON.parse(
    await readFile(new URL('word-export-zh.textcontent.json', folder), 'utf8'),
  );
  for (const [index, layer] of content.pages.entries()) {
    const page = skeleton(layer.items.map((item) => item.str).join('')).chars;
    const own = blocks
      .map((block, at) => ({ id: `b:${at}`, text: block.text, page: block.page }))
      .filter((block) => block.page === index + 1);
    for (const sentence of [
      `左栏正文第 ${index + 1} 页：本研究的合成一致性阈值为0.75，案例频数阈值为 2。`,
      `右栏正文第 ${index + 1} 页：较低阈值纳入更多合成案例，应当区分阈值口径。`,
    ]) {
      const needle = skeleton(sentence).chars;
      const start = page.indexOf(needle);
      assert.ok(start >= 0, sentence);
      const placed = placeOnPage(page, start, start + needle.length, own);
      const block = own.find((entry) => entry.id === placed?.blockId);
      assert.equal(block?.text.slice(placed.from, placed.to), sentence);
    }
  }
});
