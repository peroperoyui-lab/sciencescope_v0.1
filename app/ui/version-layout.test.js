import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE, layoutVersions, pathToRoot } from './version-layout.js';

// v1 → v2 → v3 → v4 → v5 → v6 → v7 on the main line; v8 → v9 branch off v5,
// and v10 branches off v3.
/** @type {import('./version-layout.js').TreeNode[]} */
const NODES = /** @type {[number, number | null, string][]} */ ([
  [1, null, ''],
  [2, 1, ''],
  [3, 2, ''],
  [4, 3, ''],
  [5, 4, ''],
  [6, 5, ''],
  [7, 6, ''],
  [8, 5, '期刊投稿'],
  [9, 8, '期刊投稿'],
  [10, 3, '会议摘要'],
]).map(([number, parent, branch]) => ({
  id: `v${number}`,
  number,
  parentId: parent ? `v${parent}` : null,
  branch,
}));

const where = (layout) =>
  Object.fromEntries(layout.placed.map((entry) => [entry.node.id, [entry.column, entry.row]]));

test('the main line stays in the first column and each branch takes its own', () => {
  const layout = layoutVersions(NODES);
  const at = where(layout);
  assert.deepEqual(at.v1, [0, 0]);
  assert.deepEqual(at.v7, [0, 6]);
  // Rows are depths: a branch's first version sits one row under its parent.
  assert.deepEqual(at.v8, [1, 5]);
  assert.deepEqual(at.v9, [1, 6]);
  assert.deepEqual(at.v10, [2, 3]);
  assert.equal(layout.branches.length, 2);
  assert.equal(layout.width, NODE.left * 2 + 3 * NODE.column);
  // No two versions share a place.
  const places = Object.values(at).map(String);
  assert.equal(new Set(places).size, places.length);
});

test('a folded branch takes no column and counts its versions', () => {
  const layout = layoutVersions(NODES, new Set(['v8']));
  const at = where(layout);
  assert.equal(at.v8, undefined);
  assert.equal(at.v9, undefined);
  assert.deepEqual(at.v10, [1, 3]);
  assert.deepEqual(
    layout.folds.map((fold) => [fold.id, fold.name, fold.count, fold.parent]),
    [['v8', '期刊投稿', 2, 'v5']],
  );
});

test('the path to the open version runs up to v1', () => {
  assert.deepEqual([...pathToRoot(NODES, 'v9')], ['v9', 'v8', 'v5', 'v4', 'v3', 'v2', 'v1']);
  assert.equal(pathToRoot(NODES, null).size, 0);
});
