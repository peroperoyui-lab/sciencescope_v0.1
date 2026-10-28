import test from 'node:test';
import assert from 'node:assert/strict';
import { NODE, layoutMap, mapConnections, mapEdges, fitView } from './map-layout.js';

test('trees grow rightwards with parents centred, floating nodes keep their place', () => {
  const nodes = [
    { id: 'first', parent: null },
    { id: 'a', parent: 'first' },
    { id: 'b', parent: 'first' },
    { id: 'floating', parent: null, floating: true, x: -120, y: -90 },
    { id: 'child', parent: 'floating' },
    { id: 'last', parent: null },
  ];
  const positions = layoutMap(nodes, {});
  const at = (id) => positions.find((position) => position.node.id === id);
  assert.equal(at('a').x, NODE.left + NODE.root + NODE.column);
  assert.equal(at('b').y, at('a').y + NODE.height + NODE.gap);
  // The parent sits halfway between its children.
  assert.equal(at('first').y + at('first').h / 2, (at('a').y + at('b').y + NODE.height) / 2);
  assert.equal(at('floating').x, -120);
  assert.equal(at('floating').y, -90);
  assert.equal(at('floating').h, NODE.tall);
  // The next tree starts below the first one's lowest node.
  assert.equal(at('last').y, at('b').y + NODE.height + NODE.trees);
  assert.equal(mapConnections(positions).length, 3);

  const edges = [{ id: 'extra', from: 'floating', to: 'child', directed: true }];
  assert.equal(mapEdges(positions, edges).length, 1);
  assert.equal(mapEdges(layoutMap(nodes, { floating: true }), edges).length, 0);
  assert.equal(layoutMap(nodes, { first: true }).length, 4);
  const view = fitView(positions, 1000, 700);
  assert.ok(at('floating').x * view.scale + view.x >= 0);
  assert.ok(at('floating').y * view.scale + view.y >= 0);
});
