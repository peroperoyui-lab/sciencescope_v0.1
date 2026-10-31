import test from 'node:test';
import assert from 'node:assert/strict';
import { citingSentence, collectSources, sourceOf } from './desk-sources.js';

test('a source used by an index and by a chat answer is one row with both uses', () => {
  const indexes = [
    {
      id: 'a1',
      type: 'index',
      quote: { exact: '一致性阈值设为 0.85' },
      sources: [
        { schema: 1, kind: 'source', id: 'src1', sourceId: 'src1', label: 'Ragin 2008' },
        {
          schema: 1,
          kind: 'project-file',
          path: 'data/city_panel.csv',
          label: 'data/city_panel.csv',
        },
      ],
    },
    {
      id: 'a2',
      type: 'index',
      quote: { exact: '98 个地级市' },
      sources: [{ schema: 1, kind: 'project-file', path: 'data/city_panel.csv' }],
    },
  ];
  const messages = [
    {
      id: 'm1',
      turnId: 't1',
      text: '先看样本。0.85 的阈值建议引 Ragin [S2 p.3]。',
      status: 'done',
    },
  ];
  // As GET /api/meetings/:id/sources lists them; m9 is not loaded in the chat tab.
  const chat = [
    {
      sourceId: 'src1',
      title: 'Redesigning Social Inquiry',
      pages: [3],
      uses: [
        { messageId: 'm1', authorId: 'agent_main', createdAt: '2026-10-30T10:00:00Z', label: 'S2' },
        { messageId: 'm1', authorId: 'agent_main', createdAt: '2026-10-30T10:00:00Z', label: 'S2' },
      ],
    },
    {
      sourceId: 'src2',
      title: 'Set-Theoretic Methods',
      pages: [],
      uses: [
        { messageId: 'm9', authorId: 'agent_main', createdAt: '2026-10-01T10:00:00Z', label: 'S5' },
      ],
    },
  ];
  const rows = collectSources(indexes, chat, messages);
  const byKey = Object.fromEntries(rows.map((row) => [row.key, row]));
  assert.deepEqual(Object.keys(byKey).sort(), [
    'file:data/city_panel.csv',
    'source:src1',
    'source:src2',
  ]);
  const ragin = byKey['source:src1'];
  assert.equal(ragin.index && ragin.chat, true);
  assert.deepEqual(
    ragin.uses.map((use) => use.kind),
    ['index', 'chat'],
  );
  assert.equal(ragin.uses[1].quote, '0.85 的阈值建议引 Ragin。');
  assert.deepEqual([...ragin.pages], [3]);
  const table = byKey['file:data/city_panel.csv'];
  assert.equal(table.icon, 'table-2');
  assert.deepEqual(
    table.uses.map((use) => use.item.id),
    ['a1', 'a2'],
  );
  const earlier = byKey['source:src2'];
  assert.equal(earlier.index, false);
  assert.equal(earlier.title, 'Set-Theoretic Methods');
  assert.deepEqual(
    earlier.uses.map((use) => [use.message.id, use.message.authorId, use.quote]),
    [['m9', 'agent_main', '']],
  );
});

test('sources group by kind and a cited sentence is found by its label', () => {
  assert.equal(sourceOf({ kind: 'script', path: 'scripts/sample.py' }).icon, 'file-code');
  assert.equal(sourceOf({ kind: 'item', id: 'i1', label: '熵权法' }).group, 'items');
  assert.equal(sourceOf({ kind: 'message', id: 'x' }).group, 'messages');
  assert.equal(sourceOf({ kind: 'chunk', id: 'c', sourceId: 's' }).key, 'source:s');
  assert.equal(citingSentence('第一句。第二句引了 [S4]。', 'S4'), '第二句引了。');
  assert.equal(citingSentence('No label here.', null), 'No label here.');
});
