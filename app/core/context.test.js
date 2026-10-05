import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFollowupInput,
  buildInstructions,
  buildSeedInput,
  mentionedParticipants,
  visibleMessages,
} from './context.js';

const message = (fields) => ({
  id: 'm',
  meetingId: 'g',
  seq: 1,
  authorId: 'person_user',
  text: '',
  status: 'done',
  turnId: null,
  replyTo: null,
  refs: {},
  adopted: null,
  createdAt: '',
  updatedAt: '',
  ...fields,
});
const names = { person_user: '我', agent_main: '主专家', agent_review: '统计审稿人' };
const nameOf = (id) => names[id];

test('instructions name the speaker, the others present and the project', () => {
  const text = buildInstructions({
    participant: { id: 'agent_main', name: '主专家', definition: { prompt: '你是主专家。' } },
    meeting: { title: '方法讨论', policy: { mode: 'direct' } },
    members: [
      { id: 'person_user', name: '我', kind: 'human' },
      { id: 'agent_main', name: '主专家', kind: 'ai' },
      { id: 'agent_review', name: '统计审稿人', kind: 'ai', roleNote: '审核' },
    ],
    project: { name: '气候政策', description: '面板数据', folder: 'D:/research' },
    workFolder: 'D:/research',
  });
  assert.match(text, /^你是主专家。/);
  assert.match(text, /你是：主专家/);
  assert.match(text, /- 我（人）/);
  assert.match(text, /- 统计审稿人（AI，审核）/);
  assert.doesNotMatch(text, /- 主专家（AI/);
  assert.match(text, /项目：气候政策——面板数据/);
});

test('unfinished messages and unadopted reviews stay out of the shared context', () => {
  const visible = visibleMessages([
    message({ id: 'a', text: '问题' }),
    message({ id: 'b', status: 'streaming' }),
    message({ id: 'c', status: 'failed' }),
    message({ id: 'd', authorId: 'agent_review', adopted: false, text: '未采纳' }),
    message({ id: 'e', authorId: 'agent_review', adopted: true, text: '已采纳' }),
    message({ id: 'f', status: 'max_tokens', text: '半截' }),
  ]);
  assert.deepEqual(
    visible.map((item) => item.id),
    ['a', 'e', 'f'],
  );
});

test('seed input carries minutes and every later message; follow-ups only new ones', () => {
  const messages = [
    message({ seq: 4, text: '换成双重差分？' }),
    message({ seq: 5, authorId: 'agent_main', text: '可以。', status: 'max_tokens' }),
  ];
  const seed = buildSeedInput({ minutes: '# 纪要\n目标：评估政策', messages, nameOf });
  assert.match(seed, /纪要：\n\n# 纪要/);
  assert.match(seed, /【我】\n换成双重差分？/);
  assert.match(seed, /【主专家】\n可以。\n（这条发言因达到模型输出上限而中断）/);

  assert.equal(buildFollowupInput({ messages: [messages[0]], nameOf }), '【我】\n换成双重差分？');
  assert.match(buildFollowupInput({ messages, nameOf }), /^自你上次发言以来的记录/);
});

test('mentions are found in order, longest names first', () => {
  const candidates = [
    { id: 'agent_main', name: '主专家' },
    { id: 'agent_review', name: '统计审稿人' },
    { id: 'agent_x', name: '统计' },
  ];
  assert.deepEqual(mentionedParticipants('@统计审稿人 看看，@主专家 再说', candidates), [
    'agent_review',
    'agent_main',
  ]);
});
