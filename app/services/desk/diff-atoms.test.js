import test from 'node:test';
import assert from 'node:assert/strict';
import { describeBlock } from './diff-blocks.js';
import { diffVersions } from './diff.js';

const prefix = '合成图示';
const suffix = '，正文保留。';

/** @param {string[]} identities */
function coincident(identities) {
  // A private group can carry two identities at one displayed slot. Derive
  // each identity normally, then retain their shared coordinates and order.
  const items = identities.map((identity) => {
    const xml = `<image id="${identity}"/>`;
    return describeBlock(
      {
        id: 'image-paragraph',
        kind: 'paragraph',
        text: prefix + '\uFFFC' + suffix,
        inlines: [{ text: prefix }, { atom: 'image', ref: 0, display: '\uFFFC' }, { text: suffix }],
      },
      { xml, atoms: [{ start: 0, end: xml.length }] },
    );
  });
  return {
    ...items[0],
    key: prefix + items.map((item) => `<${item.atoms[0].key}>`).join('') + suffix,
    matchingText: prefix + '<image>'.repeat(items.length) + suffix,
    atoms: items.map((item) => ({ ...item.atoms[0] })),
  };
}

/** @param {string[]} identities */
function zeroLength(identities) {
  const xml = identities.map((id) => `<field id="${id}"/>`).join('');
  let offset = 0;
  const atoms = identities.map((id) => {
    const start = offset;
    offset += `<field id="${id}"/>`.length;
    return { start, end: offset };
  });
  return describeBlock(
    {
      id: 'zero-paragraph',
      kind: 'paragraph',
      text: '甲乙',
      inlines: [
        { text: '甲' },
        ...identities.map((_, ref) => ({ atom: 'field', ref, display: '' })),
        { text: '乙' },
      ],
    },
    { xml, atoms },
  );
}

function paragraph(text, bold = false) {
  return describeBlock({
    id: 'text-paragraph',
    kind: 'paragraph',
    text,
    inlines: [{ text, ...(bold ? { marks: ['b'] } : {}) }],
  });
}

/** @param {any} t @param {string} scenario @param {any[]} before @param {any[]} after */
function compare(t, scenario, before, after) {
  const diff = diffVersions(before, after);
  t.diagnostic(
    'P5_DIFF_ATOMS ' +
      JSON.stringify({
        scenario,
        algorithm: diff.algorithm,
        status: diff.status,
        counts: diff.counts,
        pairs: diff.pairs,
        deleted: diff.deleted,
        inserted: diff.inserted,
        format: diff.format,
        removedAt: diff.removedAt,
      }),
  );
  return diff;
}

/** @param {any} diff */
function unchanged(diff) {
  assert.equal(diff.status, 'unchanged');
  assert.deepEqual(diff.counts, { deleted: 0, inserted: 0, format: 0 });
  for (const field of ['pairs', 'deleted', 'inserted', 'format', 'removedAt'])
    assert.deepEqual(diff[field], []);
}

test('two different identities sharing one positive range remain unchanged when their order is retained', (t) => {
  const before = coincident(['first', 'second']);
  const after = coincident(['first', 'second']);
  assert.equal(before.atoms.length, 2);
  assert.notEqual(before.atoms[0].key, before.atoms[1].key);
  assert.equal(before.atoms[0].from, before.atoms[1].from);
  assert.equal(before.atoms[0].to, before.atoms[1].to);
  assert.ok(before.atoms[0].to > before.atoms[0].from);
  unchanged(compare(t, 'same-position-same-order', [before], [after]));
});

test('swapping identities in a shared range marks that displayed slot as one content replacement', (t) => {
  const before = coincident(['first', 'second']);
  const after = coincident(['second', 'first']);
  assert.equal(before.block.text, after.block.text);
  const diff = compare(t, 'same-position-swapped', [before], [after]);
  assert.deepEqual(diff.pairs, [{ old: 0, new: 0 }]);
  assert.deepEqual(diff.counts, { deleted: 1, inserted: 1, format: 0 });
  const range = [{ block: 0, from: prefix.length, to: prefix.length + 1 }];
  assert.deepEqual(diff.deleted, range);
  assert.deepEqual(diff.inserted, range);
  assert.deepEqual(diff.format, []);
});

test('adding or removing the tail identity replaces its shared slot even when the first identity stays the same', (t) => {
  const one = coincident(['first']);
  const two = coincident(['first', 'second']);
  assert.equal(one.block.text, two.block.text);
  const added = compare(t, 'shared-slot-tail-added', [one], [two]);
  const removed = compare(t, 'shared-slot-tail-removed', [two], [one]);
  const range = [{ block: 0, from: prefix.length, to: prefix.length + 1 }];
  for (const diff of [added, removed]) {
    assert.deepEqual(diff.pairs, [{ old: 0, new: 0 }]);
    assert.deepEqual(diff.counts, { deleted: 1, inserted: 1, format: 0 });
    assert.deepEqual(diff.deleted, range);
    assert.deepEqual(diff.inserted, range);
    assert.deepEqual(diff.format, []);
  }
});

test('bold in another paragraph produces only one format change beside an unchanged shared atom group', (t) => {
  const text = '另一段合成正文。';
  const diff = compare(
    t,
    'other-paragraph-bold',
    [coincident(['first', 'second']), paragraph(text)],
    [coincident(['first', 'second']), paragraph(text, true)],
  );
  assert.deepEqual(diff.pairs, [
    { old: 0, new: 0 },
    { old: 1, new: 1 },
  ]);
  assert.deepEqual(diff.counts, { deleted: 0, inserted: 0, format: 1 });
  assert.deepEqual(diff.deleted, []);
  assert.deepEqual(diff.inserted, []);
  assert.deepEqual(diff.format, [{ block: 1, from: 0, to: text.length, before: [], after: ['b'] }]);
});

test('zero-length atoms can be added, replaced or removed without changing the short paragraph', (t) => {
  const plain = zeroLength([]);
  const before = zeroLength(['first', 'second']);
  const after = zeroLength(['third', 'fourth']);
  assert.equal(plain.block.text, before.block.text);
  assert.equal(before.block.text, after.block.text);
  const markers = before.block.inlines.filter((inline) => inline.atom);
  assert.equal(markers.length, 2);
  assert.ok(markers.every((inline) => inline.display === ''));
  const added = compare(t, 'zero-length-added', [plain], [before]);
  const replaced = compare(t, 'zero-length-identity-replaced', [before], [after]);
  const removed = compare(t, 'zero-length-removed', [before], [plain]);
  for (const diff of [added, replaced, removed]) unchanged(diff);
});
