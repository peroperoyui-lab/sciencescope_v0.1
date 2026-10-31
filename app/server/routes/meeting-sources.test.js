import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createAppServer } from '../server.js';

test('meeting sources HTTP returns the whole conversation, empty lists and a missing-meeting error', () =>
  withCore('meeting-sources-api', async (core) => {
    const meeting = core.meetings.create({});
    const empty = core.meetings.create({});
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    core.turns.startToolCall({ turnId: turn.id, callId: 'read', name: 'research_read', args: {} });
    core.turns.endToolCall(turn.id, 'read', {
      result: {
        source: { id: 'historical', title: 'Read source', label: 'S1' },
        chunks: [{ page: 4 }],
      },
      isError: false,
    });
    const message = core.messages.post({
      meetingId: meeting.id,
      turnId: turn.id,
      authorId: 'agent_main',
      text: 'Read without citation',
    });
    core.turns.end(turn.id, { status: 'done' });
    const server = createAppServer({ core, token: 'meeting-sources-test' });
    try {
      const url = await server.listen();
      const get = async (id, status = 200) => {
        const response = await fetch(`${url}/api/meetings/${id}/sources`, {
          headers: { authorization: 'Bearer meeting-sources-test' },
        });
        const result = await response.json();
        assert.equal(response.status, status, JSON.stringify(result));
        return result;
      };
      assert.deepEqual(await get(meeting.id), {
        items: [
          {
            sourceId: 'historical',
            title: 'Read source',
            label: 'S1',
            folderPath: null,
            projectId: null,
            pages: [4],
            uses: [
              {
                messageId: message.id,
                turnId: turn.id,
                authorId: 'agent_main',
                createdAt: message.createdAt,
                label: 'S1',
              },
            ],
          },
        ],
      });
      assert.deepEqual(await get(empty.id), { items: [] });
      assert.equal((await get('missing', 404)).code, 'MEETING_NOT_FOUND');
    } finally {
      await server.close();
    }
  }));
