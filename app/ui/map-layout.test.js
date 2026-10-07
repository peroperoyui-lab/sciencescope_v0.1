import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutMap, mapConnections, mapEdges, fitView } from './map-layout.js';

test('floating nodes preserve their positions and extra links follow visible nodes', () => {
  const nodes = [
    { id: 'first', parent: null },
    { id: 'floating', parent: null, floating: true, x: -120, y: -90 },
    { id: 'child', parent: 'floating' },
    { id: 'last', parent: null },
  ];
  const positions = layoutMap(nodes, {});
  const floating = positions.find((position) => position.node.id === 'floating');
  assert.equal(floating.x, -120);
  assert.equal(floating.y, -90);
  assert.equal(positions.find((position) => position.node.id === 'last').y, 181);
  assert.equal(mapConnections(positions).filter((path) => path.startsWith('m')).length, 1);
  const edges = [{ id: 'extra', from: 'floating', to: 'child', directed: true }];
  assert.equal(mapEdges(positions, edges).length, 1);
  assert.equal(mapEdges(layoutMap(nodes, { floating: true }), edges).length, 0);
  const view = fitView(positions, 1000, 700);
  assert.ok(floating.x * view.scale + view.x >= 0);
  assert.ok(floating.y * view.scale + view.y >= 0);
});
