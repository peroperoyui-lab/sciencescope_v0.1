import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createKnowledgeStore } from './store.js';
import { createEntityAlignment } from './align.js';
import { createSemantic } from '../research/semantic/index.js';

test('entity cosine alignment accepts same-kind nearest matches and preserves user descriptions', () =>
  withCore('card-align', async (core) => {
    const knowledge = createKnowledgeStore(core);
    const parent = knowledge.createEntity({
      name: 'Set analysis',
      aliases: ['ＳＥＴ'],
      kind: 'method',
      description: 'User description',
    });
    const other = knowledge.createEntity({ name: 'A dataset', kind: 'dataset' });
    const vector = (text) => {
      const result = new Float32Array(384);
      result[text.includes('dataset') ? 1 : 0] = 1;
      if (text === 'Near match') {
        result[0] = 0.96;
        result[2] = Math.sqrt(1 - 0.96 ** 2);
      }
      if (text === 'Below threshold') {
        result[0] = 0.925;
        result[2] = Math.sqrt(1 - 0.925 ** 2);
      }
      return result;
    };
    const semantic = createSemantic(core, {
      hardware: async () => ({ supported: true }),
      embed: {
        warmup: async () => {},
        close: async () => {},
        embedPassages: async (texts) => texts.map(vector),
        embedQuery: async (text) => vector(text),
      },
    });
    await semantic.start();
    try {
      const alignment = createEntityAlignment({ core, knowledge, semantic });
      assert.equal(await alignment.nearest({ name: 'Set inference' }, 'method'), null);
      await semantic.configure('enable');
      await semantic.idle();
      const hits = await semantic.entityNeighbors('Set inference');
      assert.equal(hits[0].ref.id, parent.id);
      assert.ok(Math.abs(hits[0].score - 1) < 1e-6);
      assert.equal(await alignment.nearest({ name: 'Set inference' }, 'method'), parent.id);
      const similar = await semantic.entityNeighbors('Near match');
      assert.ok(Math.abs(similar[0].score - 0.96) < 1e-5);
      assert.equal(await alignment.nearest({ name: 'Near match' }, 'method'), parent.id);
      assert.equal(await alignment.nearest({ name: 'Below threshold' }, 'method'), null);
      assert.equal(await alignment.nearest({ name: 'Set inference' }, 'dataset'), null);
      assert.equal(await alignment.nearest({ name: 'dataset detail' }, 'dataset'), other.id);
      const meeting = core.meetings.create({ title: 'Alignment' });
      const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      const pending = knowledge.createEntity({ name: 'Not indexed yet', kind: 'method' });
      assert.equal(await alignment.nearest({ name: 'Set inference' }, 'method'), parent.id);
      knowledge.removeEntity(pending.id);
      const actor = { actorId: 'agent_main', origin: 'ai', meetingId: meeting.id, turnId: turn.id };
      const found = alignment.resolve(
        { name: 'Set inference', evidence: [{ quote: 'Original quote.' }] },
        'method',
        parent.id,
        'source:test',
        actor,
      );
      assert.equal(found.id, parent.id);
      assert.equal(found.name, 'Set analysis');
      assert.equal(found.description, 'User description');
      assert.ok(found.aliases.includes('Set inference'));
      await semantic.configure('disable');
      const exact = alignment.resolve(
        { name: ' s e t ', evidence: [] },
        'method',
        null,
        'source:test',
        actor,
      );
      assert.equal(exact.id, parent.id);
      const kinds = knowledge.listEntities();
      assert.equal(kinds.total, 2);
      core.turns.end(turn.id, { status: 'done' });
    } finally {
      await semantic.close();
    }
  }));
