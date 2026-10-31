import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createVersionStorage } from '../versions/storage.js';
import { parseStarterResult, readStarterInput, STARTER_INSTRUCTIONS } from './input.js';

test('starter input uses the three latest ordinary project chats, open plans, latest draft and current AI roles', () =>
  withCore('starter-input', async (core) => {
    const project = await core.projects.create({ name: '公开合成项目' });
    const meetings = [];
    for (let number = 0; number < 4; number++) {
      const meeting = core.meetings.create({ projectId: project.id, title: `普通对话 ${number}` });
      await core.workspace.edit({
        resource: 'minutes',
        key: meeting.id,
        op: 'write',
        args: { text: `纪要 ${number}` },
      });
      core.db
        .prepare('UPDATE meetings SET updated_at=?, pinned=? WHERE id=?')
        .run(`2026-10-0${number + 1}T00:00:00Z`, number === 0 ? 1 : 0, meeting.id);
      meetings.push(meeting);
    }
    for (const extra of [
      { temporary: true },
      { attachedTo: meetings[0].id },
      { policy: { respondent: 'agent_assistant' } },
      { archived: true },
    ]) {
      const meeting = core.meetings.create({
        projectId: project.id,
        title: '排除的对话',
        ...extra,
      });
      // Archiving is a separate edit in the public meeting API.
      if (extra.archived) core.meetings.update(meeting.id, { archived: true });
    }
    const other = await core.projects.create({ name: '另一个项目' });
    core.meetings.create({ projectId: other.id, title: '其他项目的对话' });
    await core.workspace.edit({
      resource: 'plans',
      key: project.id,
      op: 'write',
      args: { text: '- [ ] 补齐样本\n- [x] 已完成事项\n  - [ ] 复核口径\n' },
    });
    await core.participants.updateDefinition('agent_methodologist', {
      name: '当前方法专家',
      role: '核对方法口径。另一句角色。',
    });
    const storage = createVersionStorage(core, (work) => work());
    const imported = await storage.importFiles({
      projectId: project.id,
      files: [
        { name: '合成草稿.md', base64: Buffer.from('# v1').toString('base64') },
        { name: '合成草稿.md', base64: Buffer.from('# v2').toString('base64') },
      ],
    });
    const result = await readStarterInput(core, project.id);
    const input = JSON.parse(result.input);
    assert.equal(result.meetingId, meetings[3].id);
    assert.deepEqual(
      input.minutes,
      [3, 2, 1].map((number) => ({ title: `普通对话 ${number}`, text: `纪要 ${number}` })),
    );
    assert.deepEqual(input.unfinishedPlans, ['补齐样本', '复核口径']);
    assert.deepEqual(input.draft, { name: '合成草稿.md', number: 2 });
    assert.deepEqual(
      input.experts.find((person) => person.id === 'agent_methodologist'),
      { id: 'agent_methodologist', name: '当前方法专家', role: '核对方法口径。' },
    );
    assert.ok(!result.expertIds.includes('person_user'));
    assert.equal(input.examples.length, 4);
    assert.ok(input.examples.every((card) => card.expertId === null && !card.text.includes('@')));
    assert.equal((await readStarterInput(core, project.id)).fingerprint, result.fingerprint);

    await core.workspace.edit({
      resource: 'minutes',
      key: meetings[0].id,
      op: 'write',
      args: { text: '未取用的旧纪要变化' },
    });
    assert.equal((await readStarterInput(core, project.id)).fingerprint, result.fingerprint);
    await core.workspace.edit({
      resource: 'minutes',
      key: meetings[3].id,
      op: 'write',
      args: { text: '纪要 3' },
      forceRevision: true,
    });
    const revised = await readStarterInput(core, project.id);
    assert.notEqual(revised.fingerprint, result.fingerprint);
    assert.equal(revised.input, result.input);
    await core.workspace.edit({
      resource: 'plans',
      key: project.id,
      op: 'write',
      args: { text: '- [ ] 新计划' },
    });
    const planned = await readStarterInput(core, project.id);
    assert.notEqual(planned.fingerprint, revised.fingerprint);
    await core.participants.updateDefinition('agent_methodologist', { role: '核对新的方法问题' });
    const renamed = await readStarterInput(core, project.id);
    assert.notEqual(renamed.fingerprint, planned.fingerprint);
    await storage.createVersion({
      groupId: imported.group.id,
      parentId: imported.versions[1].id,
      bytes: Buffer.from('# v3'),
      name: '合成草稿.md',
      origin: 'manual',
    });
    assert.notEqual((await readStarterInput(core, project.id)).fingerprint, renamed.fingerprint);
  }));

test('a project without an ordinary chat has no runner meeting but still has a factual input packet', () =>
  withCore('starter-empty', async (core) => {
    const project = await core.projects.create({ name: '新的合成项目' });
    const result = await readStarterInput(core, project.id);
    const input = JSON.parse(result.input);
    assert.equal(result.meetingId, null);
    assert.deepEqual(input.minutes, []);
    assert.deepEqual(input.unfinishedPlans, []);
    assert.equal(input.draft, null);
    assert.equal(input.projectName, project.name);
  }));

const valid = () => ({
  progress: '合成资料已整理，下一步复核口径。',
  cards: Array.from({ length: 4 }, () => ({
    icon: 'lightbulb',
    title: '复核口径',
    sub: '先列需要核对的条目',
    text: '请复核合成资料的指标口径。',
    expertId: null,
  })),
});

test('starter JSON accepts Unicode limits and roster IDs without shortening the returned text', () => {
  const value = valid();
  value.progress = '研'.repeat(80);
  value.cards[0] = {
    icon: 'book-open',
    title: '研'.repeat(24),
    sub: '研'.repeat(30),
    text: '😀'.repeat(200),
    expertId: 'current-expert',
  };
  assert.deepEqual(parseStarterResult(JSON.stringify(value), ['current-expert']), value);
  assert.match(STARTER_INSTRUCTIONS, /不编造/u);
  assert.match(STARTER_INSTRUCTIONS, /版号只说明已有版本，不说明当前工作副本是否已写回/u);
  assert.match(STARTER_INSTRUCTIONS, /没有明确的当前保存证据.*不声称已写回、未写回/u);
  assert.match(STARTER_INSTRUCTIONS, /progress、title、sub、text 不展示 chg_、turn_/u);
});

test('invalid JSON, card counts, fields, Unicode lengths, mentions and roster IDs are rejected', () => {
  const outputs = ['not JSON', '```json\n{}\n```', 'null'];
  for (const change of [
    (value) => {
      value.cards.pop();
    },
    (value) => {
      value.progress = '研'.repeat(81);
    },
    (value) => {
      value.cards[0].icon = 'unknown';
    },
    (value) => {
      value.cards[0].title = '研'.repeat(25);
    },
    (value) => {
      value.cards[0].sub = '研'.repeat(31);
    },
    (value) => {
      value.cards[0].text = '😀'.repeat(201);
    },
    (value) => {
      value.cards[0].text = '请 @不存在的专家 复核';
    },
    (value) => {
      value.cards[0].expertId = 'deleted-expert';
    },
    (value) => {
      delete value.cards[0].expertId;
    },
    (value) => {
      value.cards[0].title = '';
    },
    (value) => {
      value.cards[0].sub = 1;
    },
  ]) {
    const value = valid();
    change(value);
    outputs.push(JSON.stringify(value));
  }
  for (const text of outputs)
    assert.throws(() => parseStarterResult(text, ['current-expert']), {
      code: 'HOME_STARTERS_INVALID',
    });
});
