import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../testing.js';
import { createResearch } from './research/index.js';
import { createPreview } from './preview/index.js';
import { createKnowledgeStore } from './knowledge/store.js';
import { createMessageExtras } from './message-extras.js';

function answer(core, meetingId, text = '', replyTo = null) {
  const turn = core.turns.start({ meetingId, participantId: 'agent_main' });
  const message = core.messages.post({
    meetingId,
    authorId: 'agent_main',
    turnId: turn.id,
    text,
    replyTo,
  });
  return { turn, message };
}

test('message extras preserve single-reader turn, citation and knowledge details through undo and redo', () =>
  withCore('message-extras', async (core) => {
    const research = createResearch(core);
    const preview = createPreview(core, research);
    const knowledge = createKnowledgeStore(core);
    const extras = createMessageExtras(core);
    const project = await core.projects.create({ name: '批量读取' });
    const meeting = core.meetings.create({ projectId: project.id });
    const sources = [1, 2, 3].map((number) =>
      research.store.createSource({ title: 'Global ' + number, kind: 'paper' }),
    );
    research.store.addChunks(sources[1].id, [
      { text: 'first passage', page: 2 },
      { text: 'selected page', page: 3 },
      { text: 'second passage on selected page', page: 3 },
    ]);
    research.store.addChunks(sources[2].id, [{ text: 'global fallback', page: 2 }]);
    const local = research.store.createSource({
      title: 'Local 1',
      kind: 'paper',
      projectId: project.id,
    });
    research.store.addChunks(local.id, [{ text: 'project priority', page: 1 }]);
    const prompt = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '附件',
      researchInput: { materials: [{ id: sources[1].id, label: 'S1' }] },
    });
    const { turn, message } = answer(
      core,
      meeting.id,
      '[S1 p.3–4] [S2] [Ｓ3 第2页] [S8; S1 appendix X] [@abcdef12]',
      prompt.id,
    );
    core.turns.startToolCall({
      turnId: turn.id,
      callId: 'thinking',
      name: 'thinking',
      kind: 'thinking',
      args: null,
    });
    core.turns.endToolCall(turn.id, 'thinking', { result: { text: 'thought' }, isError: false });
    core.turns.startToolCall({
      turnId: turn.id,
      callId: 'read',
      name: 'research_read',
      args: { sourceId: local.id },
    });
    core.turns.endToolCall(turn.id, 'read', { result: { error: 'unavailable' }, isError: true });
    const actor = { actorId: 'agent_main', origin: 'ai', meetingId: meeting.id, turnId: turn.id };
    const entity = knowledge.createEntity({ name: 'Concept', kind: 'concept' }, actor);
    knowledge.createEdge(
      {
        fromRef: 'entity:' + entity.id,
        toRef: 'source:' + sources[1].id,
        relation: 'described-in',
        evidence: [{ ref: 'chunk:' + sources[1].id + '-c1' }],
      },
      actor,
    );
    knowledge.label('entity:' + entity.id, 'topic', true, actor);
    knowledge.membership(project.id, 'entity:' + entity.id, true, actor);
    const version = knowledge.closeTurn(turn.id);
    core.turns.end(turn.id, { status: 'done', usage: { input: 12, output: 4 } });
    const localAnswer = answer(core, meeting.id, '[S1] [S3 p.99] [S9]');
    const open = answer(core, meeting.id);
    knowledge.createEntity(
      { name: 'Open edit', kind: 'concept' },
      { ...actor, turnId: open.turn.id },
    );
    const ids = [prompt.id, message.id, localAnswer.message.id, open.message.id];
    const expected = () => ({
      version: knowledge.versions.get(version.id),
      changes: knowledge.versions.changes(version.id).map(knowledge.revisionDetails),
    });
    let item = extras.get(meeting.id, ids).items[message.id];
    assert.deepEqual(item.turn, {
      turn: core.turns.get(turn.id),
      toolCalls: core.turns.toolCalls(turn.id),
    });
    assert.deepEqual(item.citations, preview.citations(message.id));
    assert.deepEqual(item.knowledge, { ...expected(), lastId: version.id, withdrawn: false });
    assert.equal(item.citations[0].targets[0].id, sources[1].id);
    assert.equal(item.citations[0].targets[0].highlight, 'selected page');
    assert.equal(item.citations[1].targets[0].highlight, 'first passage');
    assert.equal(item.citations[2].targets[0].highlight, 'global fallback');
    assert.equal(item.citations[3].parseStatus, 'partial');
    assert.deepEqual(item.citations[4].targets, []);
    let page = extras.get(meeting.id, ids).items;
    assert.deepEqual(page[prompt.id], { turn: null, citations: [], knowledge: null });
    assert.deepEqual(
      page[localAnswer.message.id].citations,
      preview.citations(localAnswer.message.id),
    );
    assert.equal(page[localAnswer.message.id].citations[0].targets[0].id, local.id);
    assert.equal(page[localAnswer.message.id].citations[1].targets[0].highlight, '');
    assert.deepEqual(page[localAnswer.message.id].citations[2].targets, []);
    assert.equal(page[localAnswer.message.id].knowledge, null);
    assert.equal(page[open.message.id].knowledge, null);
    let lastId = version.id;
    for (let links = 1; links <= 21; links++) {
      lastId = knowledge.versions.restore(lastId).version.id;
      item = extras.get(meeting.id, [message.id]).items[message.id];
      assert.deepEqual(item.knowledge, { ...expected(), lastId, withdrawn: links % 2 === 1 });
    }
    page = extras.get(meeting.id, ids).items;
    assert.equal(page[message.id].knowledge.lastId, lastId);
    assert.equal(page[message.id].knowledge.withdrawn, true);
  }));

test('message extras isolate failed items, omit foreign data and enforce the raw 50-ID bound', () =>
  withCore('message-extras-errors', async (core) => {
    const extras = createMessageExtras(core);
    const meeting = core.meetings.create({});
    const other = core.meetings.create({});
    const good = answer(core, meeting.id);
    const broken = answer(core, meeting.id);
    const foreign = answer(core, other.id);
    for (const { turn } of [broken, foreign]) {
      const call = core.turns.startToolCall({
        turnId: turn.id,
        callId: 'bad',
        name: 'research_read',
        args: {},
      });
      core.db.prepare('UPDATE tool_calls SET args_json=? WHERE id=?').run('{', call.id);
    }
    const prompt = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '',
      researchInput: { materials: [{ id: 'deleted-source', label: 'S1' }] },
    });
    const missingSource = answer(core, meeting.id, '[S1]', prompt.id);
    const brokenInput = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '',
      researchInput: {},
    });
    core.db
      .prepare('UPDATE message_research_input SET input_json=? WHERE message_id=?')
      .run('{', brokenInput.id);
    const missingInput = answer(core, meeting.id, '', brokenInput.id);
    const malformedPrompt = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '',
      researchInput: { materials: {} },
    });
    const malformedMaterials = answer(core, meeting.id, '[S1]', malformedPrompt.id);
    const knowledge = createKnowledgeStore(core);
    const invalidHistory = answer(core, meeting.id);
    knowledge.createEntity(
      { name: 'Recorded edit', kind: 'concept' },
      {
        actorId: 'agent_main',
        origin: 'ai',
        turnId: invalidHistory.turn.id,
        meetingId: meeting.id,
      },
    );
    const version = knowledge.closeTurn(invalidHistory.turn.id);
    core.db.prepare('UPDATE kb_revisions SET after_json=? WHERE version_id=?').run('{', version.id);
    const ids = [
      good.message.id,
      broken.message.id,
      foreign.message.id,
      'missing',
      missingSource.message.id,
      missingInput.message.id,
      malformedMaterials.message.id,
      invalidHistory.message.id,
    ];
    const { items } = extras.get(meeting.id, ids);
    assert.ok(items[good.message.id].turn);
    for (const id of ids.slice(1)) assert.equal(typeof items[id].error, 'string');
    assert.match(items[foreign.message.id].error, /不属于/u);
    assert.match(items[missingSource.message.id].error, /source not found/u);
    assert.deepEqual(extras.get(meeting.id, []), { items: {} });
    assert.deepEqual(
      Object.keys(extras.get(meeting.id, [` ${good.message.id} `, good.message.id]).items),
      [good.message.id],
    );
    assert.throws(() => extras.get(meeting.id, Array(51).fill(good.message.id)), {
      code: 'MESSAGE_EXTRAS_LIMIT',
    });
    assert.throws(() => extras.get('missing-meeting', []), { code: 'MEETING_NOT_FOUND' });
  }));

test('one and thirty populated messages use the same number of SQL statements', async (context) => {
  await withCore('message-extras-sql', async (core) => {
    const research = createResearch(core);
    const knowledge = createKnowledgeStore(core);
    const extras = createMessageExtras(core);
    const meeting = core.meetings.create({});
    const source = research.store.createSource({ title: 'Source', kind: 'paper' });
    research.store.addChunks(source.id, [{ text: 'quoted passage', page: 1 }]);
    const ids = [];
    for (let index = 0; index < 30; index++) {
      const { turn, message } = answer(core, meeting.id, '[S1 p.1]');
      const actor = { turnId: turn.id, meetingId: meeting.id, actorId: 'agent_main', origin: 'ai' };
      const entity = knowledge.createEntity({ name: 'Concept ' + index, kind: 'concept' }, actor);
      knowledge.createEdge(
        {
          fromRef: 'entity:' + entity.id,
          toRef: 'source:' + source.id,
          relation: 'described-in',
          evidence: [],
        },
        actor,
      );
      knowledge.closeTurn(turn.id);
      core.turns.startToolCall({
        turnId: turn.id,
        callId: 'read',
        name: 'research_read',
        args: { sourceId: source.id },
      });
      ids.push(message.id);
    }
    const measure = (requested) => {
      const prepare = core.db.prepare;
      let count = 0;
      core.db.prepare = (sql) => {
        count++;
        return prepare(sql);
      };
      try {
        const page = extras.get(meeting.id, requested);
        for (const id of requested) assert.ok(page.items[id].knowledge.changes.length);
        return count;
      } finally {
        core.db.prepare = prepare;
      }
    };
    const single = measure(ids.slice(0, 1));
    const thirty = measure(ids);
    context.diagnostic(`SQL statements: 1 message=${single}; 30 messages=${thirty}`);
    assert.equal(thirty, single);
    assert.ok(thirty <= 14);
  });
});
