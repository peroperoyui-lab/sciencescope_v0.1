import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createTurnRunner } from './turn-runner.js';
import { createContextAssembly } from './context-assembly.js';
import { createTools } from './tools.js';

// Runtime sessions are rebuildable; summaries replace only their covered record.
for (const participantId of ['agent_main', 'agent_methodologist']) {
  test(`${participantId} rebuilds lost memory from minutes and uncovered verbatim messages`, () =>
    withCore('minutes-context', async (core) => {
      const meeting = core.meetings.create({
        title: '研究',
        members: [{ participantId: 'person_user' }, { participantId }],
      });
      const old = core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '旧原文',
      });
      const saved = await core.workspace.edit({
        resource: 'minutes',
        key: meeting.id,
        op: 'write',
        args: { text: '已定：研究政策' },
      });
      const runtime = createScriptedRuntime({
        script: async function* () {
          yield '回答';
        },
      });
      const runner = createTurnRunner({
        core,
        runtime,
        runtimeName: 'scripted',
        tools: createTools(core),
        contextAssembly: createContextAssembly({
          core,
          defaultModel: async () => ({ provider: 'test', model: 'test' }),
          minutesCoverage: async (_meetingId, revisionId) =>
            revisionId === saved.revisionId ? old.seq : 0,
        }),
      });
      const say = async (text) => {
        const message = core.messages.post({
          meetingId: meeting.id,
          authorId: 'person_user',
          text,
        });
        await runner.run({
          meetingId: meeting.id,
          participantId,
          triggerMessageId: message.id,
          cutoffSeq: message.seq,
        });
      };
      await say('近期完整原文');
      core.turns.dropSession(meeting.id, participantId);
      await say('会话丢失后的问题');
      const input = [...runtime.sessions.values()].at(-1).inputs[0];
      assert.match(input, /已定：研究政策/);
      assert.doesNotMatch(input, /旧原文/);
      assert.match(input, /近期完整原文[\s\S]*回答[\s\S]*会话丢失后的问题/);
      await runtime.close();
    }));
}

test('an earlier queued question does not receive a summary of a future question', () =>
  withCore('minutes-cutoff', async (core) => {
    const meeting = core.meetings.create({
      title: '排队',
      members: [{ participantId: 'agent_main' }],
    });
    const first = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '第一个问题',
    });
    const future = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '未来问题',
    });
    await core.workspace.edit({
      resource: 'minutes',
      key: meeting.id,
      op: 'write',
      args: { text: '未来问题的结论' },
    });
    const runtime = createScriptedRuntime({
      script: async function* () {
        yield '回答';
      },
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools: createTools(core),
      contextAssembly: createContextAssembly({
        core,
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
        minutesCoverage: async () => future.seq,
      }),
    });
    await runner.run({
      meetingId: meeting.id,
      participantId: 'agent_main',
      triggerMessageId: first.id,
      cutoffSeq: first.seq,
    });
    const input = [...runtime.sessions.values()][0].inputs[0];
    assert.match(input, /第一个问题/);
    assert.doesNotMatch(input, /未来问题/);
    await runtime.close();
  }));
