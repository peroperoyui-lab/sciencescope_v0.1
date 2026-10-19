import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createConductor } from './conductor.js';
import { createTurnRunner } from './turn-runner.js';
import { createContextAssembly } from './context-assembly.js';
import { createTools } from './tools.js';

function gate() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, open: () => resolve() };
}

async function fixture(script, work) {
  await withCore('parallel-mentions', async (core) => {
    const runtime = createScriptedRuntime({ script });
    const assembly = createContextAssembly({
      core,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools: createTools(core),
      contextAssembly: assembly,
    });
    const conductor = createConductor({ core, runner });
    const meeting = core.meetings.create({ members: [{ participantId: 'agent_main' }] });
    conductor.start();
    try {
      await work({ core, conductor, meeting, assembly });
    } finally {
      conductor.stop();
      await conductor.interrupt(meeting.id);
      await conductor.idle();
    }
  });
}

test('mentioned experts start together, read only their segment, retry it and later read the original', async () => {
  const both = gate(),
    finish = gate();
  const inputs = [];
  await fixture(
    async function* ({ input, instructions }) {
      const method = instructions.includes('你是：方法学家');
      inputs.push({ method, input });
      if (inputs.length <= 2) {
        assert.match(input, /共同前提/);
        assert.match(input, method ? /识别策略/ : /标准误/);
        assert.doesNotMatch(input, method ? /标准误/ : /识别策略/);
        assert.doesNotMatch(input, /方法结果|统计结果/);
        if (inputs.length === 2) both.open();
        await finish.promise;
        yield method ? '方法结果' : '统计结果';
      } else if (inputs.length === 3) {
        assert.equal(method, true);
        assert.match(input, /识别策略/);
        assert.doesNotMatch(input, /标准误|统计结果/);
        yield '方法重试结果';
      } else {
        assert.match(input, /@方法学家 看识别策略 @统计审稿人 看标准误/);
        assert.match(input, /@方法学家 后续追问/);
        yield '后续回答';
      }
    },
    async ({ core, conductor, meeting, assembly }) => {
      const original = '共同前提：@方法学家 看识别策略 @统计审稿人 看标准误';
      try {
        const question = conductor.submit({
          meetingId: meeting.id,
          authorId: 'person_user',
          text: original,
        });
        await both.promise;
        assert.equal(core.turns.running().filter((t) => t.meetingId === meeting.id).length, 2);
        finish.open();
        await conductor.idle();
        const answers = core.messages.since(meeting.id, 0).filter((m) => m.turnId);
        assert.deepEqual(
          answers.map((a) => a.authorId),
          ['agent_methodologist', 'agent_statistician'],
        );
        for (const answer of answers) {
          assert.equal(answer.refs.discussion.kind, 'mention');
          assert.equal(answer.refs.discussion.triggerMessageId, question.id);
          assert.equal(answer.refs.discussion.cutoffSeq, question.seq);
        }
        assert.equal(core.messages.get(question.id).text, original);
        await core.workspace.edit({
          resource: 'minutes',
          key: meeting.id,
          op: 'write',
          args: { text: '整条问题的纪要包含标准误' },
        });
        const summarizedAssembly = createContextAssembly({
          core,
          defaultModel: async () => ({ provider: 'test', model: 'test' }),
          minutesCoverage: async () => question.seq,
        });
        const segmented = await (
          await summarizedAssembly.describe({
            meetingId: meeting.id,
            participantId: 'agent_methodologist',
            triggerMessageId: question.id,
            triggerText: answers[0].refs.discussion.input,
            cutoffSeq: question.seq,
            execution: { cancelled: false },
          })
        ).seedInput(null);
        assert.match(segmented.input, /识别策略/);
        assert.doesNotMatch(segmented.input, /标准误|统计结果/);
        await conductor.retry(answers[0].id);
        await conductor.idle();
        conductor.submit({
          meetingId: meeting.id,
          authorId: 'person_user',
          text: '@方法学家 后续追问',
        });
        await conductor.idle();
        assert.equal(inputs.length, 4);
        const rebuilt = await (
          await assembly.describe({
            meetingId: meeting.id,
            participantId: 'agent_main',
            execution: { cancelled: false },
          })
        ).seedInput(null);
        assert.ok(rebuilt.input.includes(original));
      } finally {
        finish.open();
      }
    },
  );
});

test('stopping a multi-mention request cancels every concurrent answer', async () => {
  const both = gate();
  let begun = 0;
  await fixture(
    async function* ({ signal }) {
      begun++;
      if (begun === 2) both.open();
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      yield '不会发送';
    },
    async ({ core, conductor, meeting }) => {
      conductor.submit({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '@方法学家 @统计审稿人 一起分析',
      });
      await both.promise;
      await conductor.interrupt(meeting.id);
      await conductor.idle();
      const answers = core.messages.since(meeting.id, 0).filter((m) => m.turnId);
      assert.deepEqual(
        answers.map((a) => a.status),
        ['cancelled', 'cancelled'],
      );
      assert.equal(core.turns.running().filter((t) => t.meetingId === meeting.id).length, 0);
    },
  );
});
