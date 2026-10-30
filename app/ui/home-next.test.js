import test from 'node:test';
import assert from 'node:assert/strict';
import { latestDrafts, starters } from './home-next.js';

const version = (id, number, createdAt) => ({ id, number, createdAt });

test('the latest drafts are each group’s newest version, newest first', () => {
  const city = { id: 'p1', name: '城市韧性研究' };
  const labour = { id: 'p2', name: '劳动保障政策演化' };
  const drafts = latestDrafts([
    {
      project: city,
      groups: [
        {
          id: 'g1',
          versions: [
            version('v3', 3, '2026-10-20T00:00:00Z'),
            version('v1', 1, '2026-10-01T00:00:00Z'),
          ],
        },
        { id: 'g2', versions: [] },
      ],
    },
    {
      project: labour,
      groups: [{ id: 'g3', versions: [version('v9', 2, '2026-10-29T00:00:00Z')] }],
    },
    { project: city, groups: null },
  ]);
  assert.deepEqual(
    drafts.map((entry) => [entry.project.id, entry.group.id, entry.version.id]),
    [
      ['p2', 'g3', 'v9'],
      ['p1', 'g1', 'v3'],
    ],
  );
  assert.equal(
    latestDrafts([{ project: city, groups: [{ id: 'g1', versions: [version('a', 1, 'x')] }] }], 0)
      .length,
    0,
  );
});

test('starters use the draft, the open plan and the experts’ current names', () => {
  const participants = [{ id: 'agent_red_team', name: '反方' }];
  const cards = starters({
    project: { id: 'p1' },
    draft: { name: '开题报告.docx', number: 4 },
    plan: '补齐 2015 年数据',
    participants,
  });
  assert.equal(cards.length, 4);
  assert.match(cards[0].title, /反方.*开题报告\.docx/u);
  assert.match(cards[0].text, /^@反方 /u);
  assert.match(cards[1].text, /补齐 2015 年数据/u);
  assert.match(cards[2].title, /第 4 版/u);
  assert.match(cards[2].text, /^@独立审核人 /u);
  assert.match(cards[3].text, /^@方法学家 /u);
});

test('starters without a draft or plan fall back, and without a project offer two', () => {
  const cards = starters({ project: { id: 'p1' }, draft: null, plan: null, participants: [] });
  assert.equal(cards.length, 4);
  assert.equal(cards[1].icon, 'database');
  assert.match(cards[2].title, /研究问题/u);
  const loose = starters({ project: null, draft: null, plan: null, participants: [] });
  assert.deepEqual(
    loose.map((card) => card.icon),
    ['circle-help', 'lightbulb'],
  );
});
