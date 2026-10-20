import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore, tempDir } from '../../testing.js';
import { createAppServer } from '../server.js';
import { createApp } from '../../app.js';
import { createCore } from '../../core/index.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createKnowledgeStore } from '../../services/knowledge/store.js';
import { createKnowledgeSessions } from '../../services/knowledge/sessions.js';
import { createKnowledgeGraph } from '../../services/knowledge/graph.js';
import { createResearch } from '../../services/research/index.js';

async function withApi(work) {
  await withCore('knowledge-api', async (core) => {
    const research = createResearch(core);
    const knowledge = createKnowledgeStore(core);
    const sessions = createKnowledgeSessions(core, knowledge);
    const server = createAppServer({
      core,
      token: 'kb-test',
      knowledge,
      knowledgeSessions: sessions,
      research,
    });
    const url = await server.listen();
    const call = async (method, route, body) => {
      const response = await fetch(url + '/api/' + route, {
        method,
        headers: { authorization: 'Bearer kb-test', 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      assert.equal(response.status, 200, route + ': ' + JSON.stringify(result));
      return result;
    };
    try {
      await work({ core, research, knowledge, sessions, call });
    } finally {
      await server.close();
    }
  });
}

test('knowledge HTTP editing session groups changes, undo/redo and a merge into one restorable version', () =>
  withApi(async ({ core, research, knowledge, call }) => {
    const project = await core.projects.create({ name: '研究图' });
    const source = research.store.createSource({
      title: '方法原文',
      kind: 'paper',
      projectId: project.id,
    });
    research.store.addChunks(source.id, [{ text: '使用模糊集比较案例。', page: 4 }]);
    const chunk = research.store.chunks(source.id)[0];
    const { id: sessionId } = await call('POST', 'knowledge/session', { projectId: project.id });
    const a = await call('POST', 'knowledge/entities', {
      sessionId,
      kind: 'method',
      name: 'QCA',
      aliases: ['组态方法'],
    });
    const b = await call('POST', 'knowledge/entities', {
      sessionId,
      kind: 'method',
      name: 'fsQCA',
    });
    const edge = await call('POST', 'knowledge/edges', {
      sessionId,
      fromRef: 'entity:' + b.id,
      toRef: 'source:' + source.id,
      relation: 'used-by',
      evidence: [{ ref: 'chunk:' + chunk.id }],
    });
    await call('POST', 'knowledge/labels', { sessionId, ref: 'entity:' + a.id, add: '定性方法' });
    await call('POST', 'knowledge/memberships', {
      sessionId,
      ref: 'entity:' + a.id,
      projectId: project.id,
    });
    await call('PATCH', 'knowledge/entities/' + a.id, { sessionId, name: '定性比较分析' });
    await call('POST', `knowledge/session/${sessionId}/undo`);
    assert.equal((await call('GET', 'knowledge/entities/' + a.id)).entity.name, 'QCA');
    await call('POST', `knowledge/session/${sessionId}/redo`);
    assert.equal((await call('GET', 'knowledge/entities/' + a.id)).entity.name, '定性比较分析');
    const filtered = await call(
      'GET',
      `knowledge/entities?q=${encodeURIComponent('组态')}&label=${encodeURIComponent('定性方法')}&projectId=${project.id}&limit=1`,
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.rows[0].degree, 0);
    assert.ok(filtered.rows[0].updatedAt);
    const preview = await call('GET', `knowledge/entities/merge-preview?into=${a.id}&from=${b.id}`);
    assert.equal(preview.relationCount, 1);
    await call('POST', 'knowledge/entities/merge', { sessionId, into: a.id, from: [b.id] });
    const merged = await call('GET', `knowledge/entities/${a.id}?edgesLimit=1`);
    assert.equal(merged.entity.degree, 1);
    assert.equal(merged.edges.groups[0].relation, 'used-by');
    assert.deepEqual(merged.edges.rows[0].peer, {
      ref: 'source:' + source.id,
      name: source.title,
      kind: 'paper',
    });
    assert.deepEqual(merged.edges.rows[0].evidence[0], {
      ref: 'chunk:' + chunk.id,
      sourceId: source.id,
      title: source.title,
      page: 4,
      quote: chunk.text,
    });
    // A merge is one undo step, including its aliases and rewired edge.
    await call('POST', `knowledge/session/${sessionId}/undo`);
    assert.equal(knowledge.getEdge(edge.id).fromRef, 'entity:' + b.id);
    assert.equal(knowledge.getEntity('entity:' + b.id).entity.status, 'active');
    await call('POST', `knowledge/session/${sessionId}/redo`);
    const graph = await call('GET', `knowledge/graph?ref=entity:${a.id}&depth=2&limit=1`);
    assert.deepEqual(
      graph,
      await createKnowledgeGraph(core, research)({ ref: 'entity:' + a.id, depth: 2, limit: 1 }),
    );
    assert.equal((await call('GET', 'research/sources'))[0].relations, 1);
    assert.equal((await call('GET', 'research/sources?page=1')).sources[0].relations, 1);
    await call('DELETE', 'knowledge/edges/' + edge.id, { sessionId });
    const version = await call('POST', `knowledge/session/${sessionId}/close`);
    assert.deepEqual(version.summary, { created: 4, updated: 0, removed: 0 });
    const versions = await call('GET', `knowledge/versions?projectId=${project.id}`);
    assert.equal(versions.total, 1);
    const detail = await call('GET', 'knowledge/versions/' + sessionId);
    assert.ok(
      detail.changes.every(
        (row) => row.ref && row.name && row.kind && row.op && 'before' in row && 'after' in row,
      ),
    );
    assert.ok(detail.changes.some((row) => row.op === 'undo'));
    const history = await call('GET', `knowledge/history?ref=entity:${a.id}&limit=1`);
    assert.equal(history.rows.length, 1);
    assert.ok(history.remaining > 0);
    const restored = await call('POST', `knowledge/versions/${sessionId}/restore`);
    assert.deepEqual(restored.skipped, []);
    assert.equal(knowledge.listEntities().total, 0);
    assert.equal(knowledge.getEdge(edge.id).status, 'removed');
    assert.deepEqual(knowledge.labels('entity:' + a.id), []);
    assert.deepEqual(knowledge.memberships('entity:' + a.id), []);
    await call('POST', `knowledge/revisions/${history.rows[0].id}/restore`);
    assert.equal(knowledge.getEntity('entity:' + a.id).entity.name, '定性比较分析');
    await call('DELETE', 'knowledge/entities/' + a.id);
    assert.equal(knowledge.getEntity('entity:' + a.id).entity.status, 'removed');
  }));

test('AI provenance and missing evidence survive reads; later AI corrections are skipped on withdrawal', () =>
  withApi(async ({ core, research, knowledge, call }) => {
    const meeting = core.meetings.create({ title: '方法讨论' });
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const message = core.messages.post({
      meetingId: meeting.id,
      authorId: 'agent_main',
      turnId: turn.id,
      text: '采用QCA研究配置。',
    });
    const actor = { actorId: 'agent_main', origin: 'ai', meetingId: meeting.id, turnId: turn.id };
    const source = research.store.createSource({ title: '原文', kind: 'paper' });
    research.store.addChunks(source.id, [{ text: 'QCA方法', page: 1 }]);
    const chunk = research.store.chunks(source.id)[0];
    const a = knowledge.createEntity({ name: 'QCA', kind: 'method', layer: 'extracted' }, actor);
    const edge = knowledge.createEdge(
      {
        fromRef: 'entity:' + a.id,
        toRef: 'source:' + source.id,
        relation: 'used-by',
        evidence: [{ ref: 'chunk:' + chunk.id }, { ref: 'message:' + message.id }],
      },
      actor,
    );
    const version = knowledge.closeTurn(turn.id);
    core.turns.end(turn.id, { status: 'done' });
    const details = await call('GET', 'knowledge/entities/' + a.id);
    assert.deepEqual(details.entity.createdBy, {
      participantId: 'agent_main',
      name: (await core.participants.get('agent_main')).name,
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      turnId: turn.id,
      messageId: message.id,
    });
    assert.deepEqual(details.edges.rows[0].createdBy, details.entity.createdBy);
    assert.equal(details.edges.rows[0].evidence[1].excerpt, message.text);
    const aiEntities = await call('GET', 'knowledge/entities?origin=ai&kind=method');
    assert.equal(aiEntities.total, 1);
    assert.deepEqual(aiEntities.rows[0].createdBy, details.entity.createdBy);
    research.store.addChunks(source.id, []);
    assert.equal(
      (await call('GET', 'knowledge/entities/' + a.id)).edges.rows[0].evidence[0].missing,
      true,
    );
    const later = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    knowledge.updateEntity(a.id, { name: '校正后的QCA' }, { ...actor, turnId: later.id });
    knowledge.closeTurn(later.id);
    core.turns.end(later.id, { status: 'done' });
    const restored = await call('POST', `knowledge/versions/${version.id}/restore`);
    assert.deepEqual(restored.skipped, ['entity:' + a.id]);
    assert.equal(knowledge.getEntity('entity:' + a.id).entity.name, '校正后的QCA');
    assert.equal(knowledge.getEdge(edge.id).status, 'removed');
  }));

test('session undo/redo follows its own steps, skips intervening edits and counts net changes', () =>
  withApi(async ({ knowledge, sessions, call }) => {
    const original = knowledge.createEntity({ name: 'original', kind: 'concept' });
    const { id } = sessions.open();
    const rename = (name) =>
      call('PATCH', 'knowledge/entities/' + original.id, { sessionId: id, name });
    await rename('first');
    await rename('second');
    assert.equal(sessions.undo(id).skipped.length, 0);
    assert.equal(sessions.undo(id).skipped.length, 0);
    assert.equal(knowledge.getEntity('entity:' + original.id).entity.name, 'original');
    sessions.redo(id);
    sessions.redo(id);
    assert.equal(knowledge.getEntity('entity:' + original.id).entity.name, 'second');
    sessions.undo(id);
    await rename('replacement');
    assert.equal(sessions.redo(id).refs.length, 0);
    knowledge.updateEntity(original.id, { name: 'other session' });
    await rename('after other');
    sessions.undo(id);
    assert.deepEqual(sessions.undo(id).skipped, ['entity:' + original.id]);
    assert.equal(knowledge.getEntity('entity:' + original.id).entity.name, 'other session');
    sessions.close(id);
    const empty = sessions.open();
    assert.equal(sessions.close(empty.id), null);
    const cancelled = sessions.open();
    await call('POST', 'knowledge/entities', {
      sessionId: cancelled.id,
      name: 'temporary',
      kind: 'concept',
    });
    sessions.undo(cancelled.id);
    assert.deepEqual(sessions.close(cancelled.id).summary, { created: 0, updated: 0, removed: 0 });
    const net = sessions.open();
    await call('PATCH', 'knowledge/entities/' + original.id, {
      sessionId: net.id,
      name: 'changed once',
    });
    await call('PATCH', 'knowledge/entities/' + original.id, {
      sessionId: net.id,
      name: 'changed twice',
    });
    assert.deepEqual(sessions.close(net.id).summary, { created: 0, updated: 1, removed: 0 });
  }));

test('app startup closes abandoned editing versions and serves knowledge job status', async () => {
  const { dir, cleanup } = await tempDir('knowledge-restart');
  const before = await createCore({ dataRoot: dir });
  const knowledge = createKnowledgeStore(before);
  const sessions = createKnowledgeSessions(before, knowledge);
  const edited = sessions.open(),
    empty = sessions.open();
  sessions.edit(edited.id, (actor) =>
    knowledge.createEntity({ name: '重启前的记录', kind: 'concept' }, actor),
  );
  before.close();
  const app = await createApp({
    dataRoot: dir,
    token: 'restart',
    runtime: createScriptedRuntime({
      script: async function* () {
        yield 'unused';
      },
    }),
  });
  try {
    assert.ok(app.knowledge.versions.get(edited.id).closedAt);
    assert.throws(() => app.knowledge.versions.get(empty.id), /does not exist/);
    const url = await app.listen();
    for (const method of ['GET', 'POST']) {
      const response = await fetch(url + '/api/knowledge/jobs', {
        method,
        headers: { authorization: 'Bearer restart', 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ action: 'retry' }) } : {}),
      });
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).counts, {
        queued: 0,
        running: 0,
        done: 0,
        failed: 0,
        skipped: 0,
      });
    }
  } finally {
    await app.close();
    await cleanup();
  }
});
