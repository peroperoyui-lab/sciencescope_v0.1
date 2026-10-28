import test from 'node:test';
import assert from 'node:assert/strict';
import { usedSources } from './turn-sources.js';

test('used sources are the ones read, cited or found along the graph, with the path', () => {
  const calls = [
    {
      name: 'research_search',
      status: 'done',
      result: {
        hits: [
          {
            sourceId: 'a',
            title: '王晓 2023',
            citation: '[S3 p.4]',
            page: 4,
            folderPath: 'papers/a.pdf',
          },
          { sourceId: 'b', title: '未引用', citation: '[S4 p.1]', page: 1 },
          {
            sourceId: 'c',
            title: 'Ragin 2008',
            citation: '[S5 p.12]',
            page: 12,
            via: [
              { ref: 'entity:1', name: 'csQCA' },
              { relation: '变种' },
              { ref: 'entity:2', name: 'QCA' },
            ],
            text: '原文\n经由：csQCA —变种→ QCA',
          },
        ],
      },
    },
    {
      name: 'research_read',
      status: 'done',
      result: {
        source: { id: 'd', title: '访谈纪要', label: 'S6', folderPath: 'notes/访谈.md' },
        chunks: [{ page: null }],
      },
    },
    { name: 'research_search', status: 'error', result: { hits: [{ sourceId: 'e', via: [{}] }] } },
  ];
  const sources = usedSources(calls, '两种做法都可行 [S3 p.4]。');
  assert.deepEqual(
    sources.map((source) => [source.id, source.label, [...source.pages], source.via]),
    [
      ['a', 'S3', [4], []],
      ['c', 'S5', [12], ['csQCA —变种→ QCA']],
      ['d', 'S6', [], []],
    ],
  );
  assert.equal(sources[0].folderPath, 'papers/a.pdf');
  assert.deepEqual(usedSources([], ''), []);
});
