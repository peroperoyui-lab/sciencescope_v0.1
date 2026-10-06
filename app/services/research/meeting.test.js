import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createResearch } from './index.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createTurnRunner } from '../turn-runner.js';
import { createTools } from '../tools.js';
import { createResearchFixtures } from './testing.js';

test('meeting participants share research tools, cite a passage and exclude private candidates', () =>
  withCore('research-meeting', async (core, dir) => {
    const project = await core.projects.create({ name: '城市研究' });
    const research = createResearch(core);
    const fixtures = await createResearchFixtures(dir);
    await research.importSource({
      name: fixtures.pdf.name,
      projectId: project.id,
      bytes: fixtures.pdf.bytes,
    });
    const privateItem = research.store.createItem({
      projectId: project.id,
      type: 'knowledge',
      title: '私人检索暗号',
      body: '不进入智能体候选',
      visibility: 'private',
    });
    const meeting = core.meetings.create({
      projectId: project.id,
      title: '引用资料',
      members: [
        { participantId: 'person_user' },
        { participantId: 'agent_main' },
        { participantId: 'agent_secretary' },
      ],
    });
    const observations = [];
    const runtime = createScriptedRuntime({
      script: async function* ({ call }) {
        const found = await call('research_search', { query: 'second page preserves', limit: 10 });
        const hit = found.hits.find((h) => h.type === 'chunk');
        assert.ok(hit);
        const read = await call('research_read', { type: 'chunk', id: hit.id });
        observations.push(read);
        yield `${read.chunks[0].text} ${read.chunks[0].citation}`;
      },
    });
    const tools = createTools(core);
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    for (const participantId of ['agent_main', 'agent_secretary', 'agent_assistant']) {
      const turn = await runner.run({ meetingId: meeting.id, participantId });
      assert.equal(turn.status, 'done');
      assert.deepEqual(
        core.turns.toolCalls(turn.id).map((t) => t.name),
        ['research_search', 'research_read'],
      );
    }
    assert.equal(observations.length, 3);
    const located = research.read({ label: '[S1 p.2]', projectId: project.id, limit: 1 });
    assert.equal(located.chunks[0].page, 2);
    assert.equal(
      research.search('私人检索暗号', { projectId: project.id, audience: 'agent' }).hits.length,
      0,
    );
    assert.equal(
      research.search('私人检索暗号', { projectId: project.id, audience: 'user' }).hits[0].id,
      privateItem.id,
    );
    const messages = core.messages.list(meeting.id).messages;
    assert.ok(messages.every((m) => m.text.includes('[S1 p.2]')));
  }));
