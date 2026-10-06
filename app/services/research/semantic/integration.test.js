import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../../testing.js';
import { createSemantic } from './index.js';
import { createResearch } from '../index.js';
import { createTools } from '../../tools.js';
import { createAppServer } from '../../../server/server.js';
import { createScriptedRuntime } from '../../../runtime/scripted.js';
import { createTurnRunner } from '../../turn-runner.js';

test('the API and meeting tool use one configured hybrid projection', () =>
  withCore('r4-1b-shared-search', async (core) => {
    const vector = () => {
      const result = new Float32Array(384);
      result[0] = 1;
      return result;
    };
    const semantic = createSemantic(core, {
      embed: {
        warmup: async () => {},
        embedQuery: async () => vector(),
        embedPassages: async (texts) => texts.map(vector),
        close: async () => {},
      },
      hardware: async () => ({ supported: true }),
    });
    const research = createResearch(core, { semantic });
    const project = await core.projects.create({ name: '共用检索' });
    await research.importSource({
      name: '资料.md',
      projectId: project.id,
      bytes: Buffer.from('Heart recovery benefits from cardiac rehabilitation.'),
    });
    const meeting = core.meetings.create({
      projectId: project.id,
      title: '工具引用',
      members: [{ participantId: 'agent_main' }],
    });
    const server = createAppServer({ core, token: 'shared-search', research, semantic });
    const url = await server.listen();
    try {
      await semantic.start();
      await semantic.configure('enable');
      await semantic.idle();
      const result = await fetch(`${url}/api/research/search?q=cardiac&projectId=${project.id}`, {
        headers: { authorization: 'Bearer shared-search' },
      }).then((r) => r.json());
      assert.equal(result.mode, 'hybrid');
      const runtime = createScriptedRuntime({
        script: async function* ({ call }) {
          const found = await call('research_search', { query: 'cardiac' });
          assert.equal(found.mode, 'hybrid');
          assert.deepEqual(
            found.hits.map((hit) => hit.id),
            result.hits.map((hit) => hit.id),
          );
          yield found.hits.find((hit) => hit.type === 'chunk').citation;
        },
      });
      const runner = createTurnRunner({
        core,
        runtime,
        tools: createTools(core, research),
        runtimeName: 'scripted',
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
      });
      const turn = await runner.run({ meetingId: meeting.id, participantId: 'agent_main' });
      assert.equal(turn.status, 'done');
      assert.equal(core.turns.toolCalls(turn.id)[0].result.mode, 'hybrid');
      await semantic.configure('disable');
      const disabled = await fetch(`${url}/api/research/search?q=cardiac&projectId=${project.id}`, {
        headers: { authorization: 'Bearer shared-search' },
      }).then((r) => r.json());
      assert.equal(disabled.mode, 'keyword');
    } finally {
      await server.close();
      await semantic.close();
    }
  }));
