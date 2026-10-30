import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { createResearch } from './research/index.js';
import { createMeetingSources } from './meeting-sources.js';

function answer(core, meetingId, text, calls = [], status = 'done') {
  const turn = core.turns.start({ meetingId, participantId: 'agent_main' });
  for (const [index, call] of calls.entries()) {
    const callId = `call-${index}`;
    core.turns.startToolCall({ turnId: turn.id, callId, name: call.name, args: {} });
    core.turns.endToolCall(turn.id, callId, {
      result: call.result,
      isError: call.failed ?? false,
      status: call.status,
    });
  }
  const message = core.messages.post({
    meetingId,
    authorId: 'agent_main',
    turnId: turn.id,
    text,
    status,
  });
  core.turns.end(turn.id, { status: 'done' });
  return message;
}

const use = (message, label) => ({
  messageId: message.id,
  turnId: message.turnId,
  authorId: message.authorId,
  createdAt: message.createdAt,
  label,
});

test('meeting sources merge historical read, cited and graph receipts while excluding failed calls and streaming answers', () =>
  withCore('meeting-sources', async (core) => {
    const research = createResearch(core);
    const meeting = core.meetings.create({});
    const other = core.meetings.create({});
    const source = research.store.createSource({ title: 'Historical source', kind: 'paper' });
    research.store.addChunks(source.id, [
      { text: 'evidence one', page: 8 },
      { text: 'evidence two', page: 2 },
    ]);
    const read = research.read({ id: source.id });
    const old = answer(core, meeting.id, 'Read without a citation', [
      { name: 'research_read', result: read },
      { name: 'research_read', result: read },
    ]);
    core.db
      .prepare('UPDATE messages SET created_at=? WHERE id=?')
      .run('2026-01-01T00:00:00Z', old.id);
    old.createdAt = '2026-01-01T00:00:00Z';
    const searched = answer(core, meeting.id, 'Cited [S2 p.5]', [
      {
        name: 'research_search',
        result: {
          hits: [
            { sourceId: 'cited', title: 'Cited search source', citation: '[S2 p.5]', page: 5 },
            { sourceId: 'uncited', title: 'Unused search source', citation: '[S3 p.1]', page: 1 },
            {
              sourceId: 'graph',
              title: 'Graph source',
              citation: '[S4 p.9]',
              page: 9,
              via: [{ name: 'A' }],
              text: 'text\n经由：A',
            },
          ],
        },
      },
    ]);
    const updated = {
      ...read,
      source: {
        ...read.source,
        title: 'Newest source title',
        label: 'S9',
        folderPath: 'papers/source.pdf',
      },
    };
    const newest = answer(
      core,
      meeting.id,
      'A failed answer can still have successful reads',
      [
        { name: 'research_read', result: updated },
        {
          name: 'research_read',
          result: { source: { id: 'failed', title: 'Excluded failed read' } },
          failed: true,
        },
        {
          name: 'research_search',
          result: { hits: [{ sourceId: 'failed-search', citation: '[S7]', via: [{ name: 'A' }] }] },
          failed: true,
        },
        {
          name: 'research_read',
          result: { source: { id: 'error', title: 'Excluded error read' } },
          status: 'error',
        },
      ],
      'failed',
    );
    assert.equal(core.turns.toolCalls(newest.turnId)[1].status, 'failed');
    answer(
      core,
      meeting.id,
      'streaming',
      [{ name: 'research_read', result: { source: { id: 'streaming' } } }],
      'streaming',
    );
    answer(core, other.id, 'other meeting', [
      { name: 'research_read', result: { source: { id: 'foreign' } } },
    ]);
    core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '[S3]' });
    // Deleted catalog entries retain their receipt metadata and use locations.
    research.store.deleteSource(source.id);
    const result = createMeetingSources(core).get(meeting.id);
    assert.deepEqual(result, {
      items: [
        {
          sourceId: source.id,
          title: 'Newest source title',
          label: 'S9',
          folderPath: 'papers/source.pdf',
          projectId: null,
          pages: [2, 8],
          uses: [use(newest, 'S9'), use(old, 'S1')],
        },
        {
          sourceId: 'cited',
          title: 'Cited search source',
          label: 'S2',
          folderPath: null,
          projectId: null,
          pages: [5],
          uses: [use(searched, 'S2')],
        },
        {
          sourceId: 'graph',
          title: 'Graph source',
          label: 'S4',
          folderPath: null,
          projectId: null,
          pages: [9],
          uses: [use(searched, 'S4')],
        },
      ],
    });
    const empty = core.meetings.create({});
    assert.deepEqual(createMeetingSources(core).get(empty.id), { items: [] });
    assert.throws(() => createMeetingSources(core).get('missing'), { code: 'MEETING_NOT_FOUND' });
  }));

test('meeting sources read all tool receipts in one SQL statement independently of message count', async (context) => {
  await withCore('meeting-sources-sql', async (core) => {
    const small = core.meetings.create({});
    const large = core.meetings.create({});
    const call = {
      name: 'research_read',
      result: {
        source: { id: 'source', title: 'Historical receipt', projectId: 'historical-project' },
      },
    };
    answer(core, small.id, '', [call]);
    for (let index = 0; index < 30; index++) answer(core, large.id, '', [call]);
    const get = (meetingId) => {
      const prepare = core.db.prepare;
      const statements = [];
      core.db.prepare = (sql) => {
        statements.push(sql);
        return prepare(sql);
      };
      try {
        const result = createMeetingSources(core).get(meetingId);
        assert.equal(result.items[0].projectId, 'historical-project');
        assert.equal(statements.filter((sql) => sql.includes('tool_calls')).length, 1);
        return { statements: statements.length, uses: result.items[0].uses.length };
      } finally {
        core.db.prepare = prepare;
      }
    };
    const single = get(small.id);
    const thirty = get(large.id);
    assert.equal(single.uses, 1);
    assert.equal(thirty.uses, 30);
    assert.equal(single.statements, thirty.statements);
    assert.equal(thirty.statements, 3);
    context.diagnostic(
      `SQL statements: 1 message=${single.statements}; 30 messages=${thirty.statements}; one tool-call query each`,
    );
  });
});
