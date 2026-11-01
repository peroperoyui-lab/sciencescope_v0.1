import test from 'node:test';
import assert from 'node:assert/strict';
import { starterExamples, templateStarters } from './home-starters.js';

test('shared templates keep translated placeholders and current full names while backend examples have no mentions', () => {
  const input = {
    project: { id: 'synthetic' },
    draft: { name: '合成草稿.md', number: 2 },
    plan: '核对 @ 编号',
    participants: [{ id: 'agent_red_team', name: '反方 专家' }],
  };
  const calls = [];
  const translate = (text, values) => {
    calls.push({ text, values });
    return `翻译:${text.replace(/\{([^}]+)\}/gu, (match, key) => values?.[key] ?? match)}`;
  };
  const cards = templateStarters(input, translate);
  assert.match(cards[0].text, /^翻译:@反方 专家 /u);
  assert.ok(calls.some(({ text, values }) => text === '按审稿标准读第 {n} 版' && values.n === 2));
  const examples = starterExamples(input);
  assert.equal(examples.length, 4);
  assert.match(examples[0].text, /^请读《合成草稿.md》/u);
  assert.ok(examples.every((card) => card.expertId === null && !card.text.includes('@')));
  assert.equal(templateStarters({ ...input, project: null }).length, 2);
});
