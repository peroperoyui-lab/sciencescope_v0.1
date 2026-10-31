import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createAppServer } from '../server.js';
import { createResearch } from '../../services/research/index.js';
import { createKnowledgeStore } from '../../services/knowledge/store.js';

test('message extras HTTP route retains old response shapes and reports per-ID errors and request limits', () =>
  withCore('message-extras-api', async (core) => {
    const research = createResearch(core);
    const knowledge = createKnowledgeStore(core);
    const server = createAppServer({ core, research, knowledge, token: 'extras-test' });
    try {
      const url = await server.listen();
      const meeting = core.meetings.create({});
      const other = core.meetings.create({});
      const plain = core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '',
      });
      const foreign = core.messages.post({
        meetingId: other.id,
        authorId: 'person_user',
        text: '',
      });
      const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      const source = research.store.createSource({ title: 'HTTP source', kind: 'paper' });
      research.store.addChunks(source.id, [{ text: 'evidence', page: 4 }]);
      const message = core.messages.post({
        meetingId: meeting.id,
        authorId: 'agent_main',
        turnId: turn.id,
        text: '[S1 p.4]',
      });
      knowledge.createEntity(
        { name: 'HTTP concept', kind: 'concept' },
        {
          actorId: 'agent_main',
          origin: 'ai',
          meetingId: meeting.id,
          turnId: turn.id,
        },
      );
      const version = knowledge.closeTurn(turn.id);
      const get = async (route, status = 200) => {
        const response = await fetch(url + '/api/' + route, {
          headers: { authorization: 'Bearer extras-test' },
        });
        const result = await response.json();
        assert.equal(response.status, status, JSON.stringify(result));
        return result;
      };
      const route = `meetings/${meeting.id}/message-extras`;
      const { items } = await get(
        `${route}?ids=${[plain.id, message.id, foreign.id, 'missing'].join(',')}`,
      );
      assert.deepEqual(items[plain.id], { turn: null, citations: [], knowledge: null });
      assert.deepEqual(items[message.id], {
        turn: await get('turns/' + turn.id),
        citations: await get(`messages/${message.id}/citations`),
        knowledge: {
          ...(await get('knowledge/versions/' + version.id)),
          lastId: version.id,
          withdrawn: false,
        },
      });
      assert.equal(typeof items[foreign.id].error, 'string');
      assert.equal(typeof items.missing.error, 'string');
      assert.deepEqual(await get(route), { items: {} });
      assert.deepEqual(await get(route + '?ids='), { items: {} });
      assert.equal(
        Object.keys((await get(route + '?ids=' + Array(50).fill(message.id).join(','))).items)
          .length,
        1,
      );
      const limit = await get(route + '?ids=' + Array(51).fill(message.id).join(','), 400);
      assert.equal(limit.code, 'MESSAGE_EXTRAS_LIMIT');
      assert.equal((await get('meetings/missing/message-extras', 404)).code, 'MEETING_NOT_FOUND');
    } finally {
      await server.close();
    }
  }));
