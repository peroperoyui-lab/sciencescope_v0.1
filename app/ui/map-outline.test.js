import test from 'node:test';
import assert from 'node:assert/strict';
import { outline, parseOutline } from './map-outline.js';

test('an edited outline keeps unchanged nodes, their links and positions', () => {
  const map = {
    nodes: [
      { id: 'root', parent: null, text: '城市韧性' },
      { id: 'q', parent: 'root', text: '研究问题', status: '进行中' },
      { id: 'm', parent: 'root', text: '研究方法\n熵权法' },
      { id: 'loose', parent: null, text: '访谈材料', floating: true, x: 600, y: 80 },
    ],
    edges: [
      { id: 'e1', from: 'q', to: 'm' },
      { id: 'e2', from: 'loose', to: 'm' },
    ],
  };
  const text = outline(map.nodes);
  assert.equal(text, '- 城市韧性\n  - 研究问题 （进行中）\n  - 研究方法\n    熵权法\n- 访谈材料\n');
  assert.deepEqual(parseOutline(text, map), map);

  // A new child under 研究方法, 研究问题 renamed, 访谈材料 moved under the root.
  const edited = parseOutline(
    '- 城市韧性\n  - 研究问题如何提出\n  - 研究方法\n    熵权法\n    - 多期 DID （待开始）\n  - 访谈材料\n',
    map,
  );
  const byText = Object.fromEntries(edited.nodes.map((node) => [node.text, node]));
  assert.equal(byText['研究方法\n熵权法'].id, 'm');
  assert.equal(byText['多期 DID'].parent, 'm');
  assert.equal(byText['多期 DID'].status, '待开始');
  assert.notEqual(byText['研究问题如何提出'].id, 'q');
  assert.equal(byText['访谈材料'].id, 'loose');
  assert.equal(byText['访谈材料'].parent, 'root');
  assert.equal(byText['访谈材料'].floating, undefined);
  assert.deepEqual(
    edited.edges.map((edge) => edge.id),
    ['e2'],
  );
});
