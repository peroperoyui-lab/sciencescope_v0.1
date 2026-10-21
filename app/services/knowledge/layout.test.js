import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createKnowledgeLayout } from './layout.js';
import { LITERATURE_KINDS } from '../research/records.js';

test('map positions persist, incremental layouts keep old coordinates, pins survive reruns and viewport scopes edges', async () => {
  const temp = await tempDir('knowledge-layout');
  const app = await createApp({
    dataRoot: temp.dir,
    token: 'layout-test',
    runtime: createScriptedRuntime({
      async *script() {
        yield 'unused';
      },
    }),
  });
  const url = await app.listen(),
    events = [];
  const unsubscribe = app.core.events.subscribe((event) => {
    if (event.type === 'knowledge.layout.changed') events.push(event.payload);
  });
  const call = async (route, body = undefined, method = body ? 'POST' : 'GET') => {
    const response = await fetch(url + '/api/knowledge/' + route, {
      method,
      headers: { authorization: 'Bearer layout-test', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  const positions = () => app.core.db.prepare('SELECT * FROM kb_positions ORDER BY ref').all();
  const ref = (entity) => 'entity:' + entity.id;
  try {
    const a = app.knowledge.createEntity({ kind: 'method', name: 'Method A' });
    const b = app.knowledge.createEntity({ kind: 'dataset', name: 'Dataset B' });
    const c = app.knowledge.createEntity({ kind: 'concept', name: 'Concept C' });
    const ab = app.knowledge.createEdge({ fromRef: ref(a), toRef: ref(b), relation: 'uses' });
    app.knowledge.createEdge({ fromRef: ref(b), toRef: ref(c), relation: 'describes' });
    assert.equal((await call('layout')).pending, 3);
    await app.knowledge.layout.idle();
    const before = positions();
    assert.equal(before.length, 3);
    assert.ok(before.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
    assert.equal(events.filter((event) => event.all).length, 1);
    const d = app.knowledge.createEntity({ kind: 'software', name: 'New software' });
    app.knowledge.createEdge({ fromRef: ref(a), toRef: ref(d), relation: 'uses' });
    await app.knowledge.layout.idle();
    assert.deepEqual(
      positions().filter((node) => node.ref !== ref(d)),
      before,
    );
    const added = positions().find((node) => node.ref === ref(d)),
      neighbor = before.find((node) => node.ref === ref(a));
    assert.ok(
      Math.hypot(added.x - neighbor.x, added.y - neighbor.y) < 50,
      'new node stays near its existing neighbor',
    );
    const pinned = { ref: ref(a), x: 123.123456789, y: -321.987654321, pinned: true };
    await call('positions', { positions: [pinned] }, 'PATCH');
    const versionCount = app.core.db.prepare('SELECT count(*) AS n FROM kb_versions').get().n;
    assert.deepEqual(await call('layout/rerun', {}), { queued: true });
    await app.knowledge.layout.idle();
    assert.equal(positions().find((node) => node.ref === ref(a)).x, pinned.x);
    assert.equal(positions().find((node) => node.ref === ref(a)).y, pinned.y);
    assert.equal(
      app.core.db.prepare('SELECT count(*) AS n FROM kb_versions').get().n,
      versionCount,
    );
    const priorDelete = positions().filter((node) => node.ref !== ref(c));
    app.knowledge.removeEntity(c.id);
    await app.knowledge.layout.idle();
    assert.deepEqual(positions(), priorDelete);
    const viewport = await call('viewport', { refs: [ref(a), ref(b), ref(c)] });
    assert.deepEqual(new Set(viewport.nodes.map((node) => node.ref)), new Set([ref(a), ref(b)]));
    assert.deepEqual(
      viewport.edges.map((edge) => edge.id),
      [ab.id],
    );
    assert.deepEqual(Object.keys(viewport.edges[0]).sort(), [
      'aiUntouched',
      'from',
      'id',
      'layer',
      'origin',
      'relation',
      'to',
    ]);
    assert.equal(viewport.edges[0].aiUntouched, false);
    const project = await app.core.projects.create({ name: 'Shared map' });
    app.knowledge.membership(project.id, ref(a), true);
    const source = app.research.store.createSource({
      projectId: project.id,
      title: 'Project file',
      kind: 'file',
    });
    const edgeRadius = Math.max(...positions().map((node) => Math.hypot(node.x, node.y)));
    await app.knowledge.layout.idle();
    const isolated = positions().find((node) => node.ref === 'source:' + source.id);
    assert.ok(
      Math.hypot(isolated.x, isolated.y) >= edgeRadius + 49,
      'an isolated new source starts beyond the whole existing graph',
    );
    const global = await call('layout'),
      scoped = await call('layout?projectId=' + project.id);
    assert.ok(!global.nodes.some((node) => node[0] === 'source:' + source.id));
    assert.deepEqual(
      scoped.nodes.find((node) => node[0] === ref(a)),
      global.nodes.find((node) => node[0] === ref(a)),
    );
    assert.equal(scoped.nodes.find((node) => node[0] === 'source:' + source.id)[3], 'source');
    assert.equal(scoped.pending, 0);
    assert.equal(
      (await call('viewport', { refs: [ref(a), ref(b)], projectId: project.id })).edges.length,
      0,
    );
    const outside = positions().filter(
      (node) => node.ref !== ref(a) && node.ref !== 'source:' + source.id,
    );
    await call('layout/rerun', { projectId: project.id });
    await app.knowledge.layout.idle();
    assert.deepEqual(
      positions().filter((node) => node.ref !== ref(a) && node.ref !== 'source:' + source.id),
      outside,
    );
    await call('positions', { positions: [{ ...pinned, pinned: false }] }, 'PATCH');
    assert.equal(positions().find((node) => node.ref === ref(a)).pinned, 0);
    const saved = positions();
    await app.knowledge.layout.close();
    app.knowledge.layout = createKnowledgeLayout(app.core);
    await app.knowledge.layout.idle();
    assert.deepEqual(positions(), saved);
  } finally {
    unsubscribe();
    await app.close();
    await temp.cleanup();
  }
});

test('layout waits for foreground turns, keeps drags made during work and shuts its worker down', async () => {
  const temp = await tempDir('layout-turns');
  const app = await createApp({
    dataRoot: temp.dir,
    token: 'test',
    runtime: createScriptedRuntime({
      async *script() {
        yield 'unused';
      },
    }),
  });
  try {
    const meeting = app.core.meetings.create({ title: 'Foreground' });
    const turn = app.core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const node = app.knowledge.createEntity({ kind: 'method', name: 'Deferred' });
    await app.knowledge.layout.idle();
    assert.equal((await app.knowledge.layout.index()).pending, 1);
    app.core.turns.end(turn.id, { status: 'done' });
    await app.knowledge.layout.idle();
    assert.equal((await app.knowledge.layout.index()).pending, 0);
    app.knowledge.layout.rerun();
    const run = app.knowledge.layout.idle();
    app.knowledge.layout.save([
      { ref: 'entity:' + node.id, x: 18.123456789, y: 27.987654321, pinned: true },
    ]);
    await run;
    assert.equal((await app.knowledge.layout.index()).nodes[0][1], 18.123456789);
  } finally {
    await app.close();
    await temp.cleanup();
  }
});

test('global layout shares project literature and graph items while project files stay in project scopes', async () => {
  const temp = await tempDir('layout-scope');
  const app = await createApp({
    dataRoot: temp.dir,
    token: 'scope-test',
    runtime: createScriptedRuntime({
      async *script() {
        yield 'unused';
      },
    }),
  });
  const url = await app.listen();
  const call = async (route, body = undefined) => {
    const response = await fetch(url + '/api/knowledge/' + route, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer scope-test', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const project = await app.core.projects.create({ name: 'Project literature' });
    const other = await app.core.projects.create({ name: 'Other project' });
    const store = app.research.store;
    const source = (kind, title, projectId = null) =>
      'source:' + store.createSource({ kind, title, projectId }).id;
    const personalFile = source('file', 'Shared material');
    const papers = LITERATURE_KINDS.map((kind) => source(kind, kind, project.id));
    const data = source('dataset', 'data.csv', project.id);
    const code = source('file', 'analysis.py', project.id);
    const manuscript = source('file', 'draft.docx', project.id);
    const otherPaper = source('paper', 'Another project paper', other.id);
    const otherFile = source('file', 'Other project data', other.id);
    const item =
      'item:' +
      store.createItem({ type: 'note', title: 'Project knowledge', projectId: project.id }).id;
    const entity =
      'entity:' + app.knowledge.createEntity({ kind: 'method', name: 'Shared method' }).id;
    app.knowledge.membership(project.id, entity, true);
    const edge = app.knowledge.createEdge({ fromRef: papers[0], toRef: data, relation: 'uses' });
    const allRefs = [
      personalFile,
      ...papers,
      data,
      code,
      manuscript,
      otherPaper,
      otherFile,
      item,
      entity,
    ];
    const globalRefs = [personalFile, ...papers, otherPaper, item, entity];
    const projectRefs = [...papers, data, code, manuscript, item, entity];
    assert.equal((await call('layout')).pending, globalRefs.length);
    await app.knowledge.layout.idle();
    const global = await call('layout');
    assert.equal(global.pending, 0);
    assert.deepEqual(new Set(global.nodes.map((node) => node[0])), new Set(globalRefs));
    const scoped = await call('layout?projectId=' + project.id);
    assert.deepEqual(new Set(scoped.nodes.map((node) => node[0])), new Set(projectRefs));
    const globalView = await call('viewport', { refs: allRefs });
    assert.deepEqual(new Set(globalView.nodes.map((node) => node.ref)), new Set(globalRefs));
    assert.deepEqual(globalView.edges, []);
    const projectView = await call('viewport', { refs: allRefs, projectId: project.id });
    assert.deepEqual(new Set(projectView.nodes.map((node) => node.ref)), new Set(projectRefs));
    assert.deepEqual(
      projectView.edges.map((row) => row.id),
      [edge.id],
    );
    const coordinates = () => app.core.db.prepare('SELECT * FROM kb_positions ORDER BY ref').all();
    const hidden = new Set([data, code, manuscript, otherFile]);
    const before = coordinates().filter((row) => hidden.has(row.ref));
    await call('layout/rerun', {});
    await app.knowledge.layout.idle();
    assert.deepEqual(
      coordinates().filter((row) => hidden.has(row.ref)),
      before,
    );
  } finally {
    await app.close();
    await temp.cleanup();
  }
});
