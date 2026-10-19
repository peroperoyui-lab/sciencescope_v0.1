import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { withCore, tempDir } from '../../testing.js';
import { openDatabase } from '../../core/db/database.js';
import { migrations } from '../../core/db/migrations/index.js';
import { createKnowledgeStore } from './store.js';
import { createResearchStore } from '../research/store.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createTurnRunner } from '../turn-runner.js';
import { createConductor } from '../conductor.js';
import { createContextAssembly } from '../context-assembly.js';
import { createTools } from '../tools.js';

const ref = (entity) => 'entity:' + entity.id;

test('knowledge migration upgrades fresh and existing research catalogs', async () => {
  const { dir, cleanup } = await tempDir('knowledge-upgrade');
  try {
    for (const existing of [false, true]) {
      const file = path.join(dir, String(existing) + '.sqlite'),
        backupDir = path.join(dir, 'backups');
      if (existing) {
        const old = await openDatabase(file, {
          migrations: migrations.slice(
            0,
            migrations.findIndex((m) => m.name === 'knowledge-base'),
          ),
          backupDir,
        });
        old.exec(
          "INSERT INTO rb_sources(id,number,kind,title,original_path,created_at,updated_at) VALUES('src_old',1,'paper','已有原件','originals/keep.pdf','now','now')",
        );
        old.close();
      }
      const db = await openDatabase(file, { migrations, backupDir });
      try {
        for (const name of [
          'entities',
          'edges',
          'labels',
          'memberships',
          'versions',
          'revisions',
          'jobs',
        ])
          assert.equal(
            db.prepare('SELECT count(*) AS n FROM sqlite_master WHERE name=?').get('kb_' + name).n,
            1,
          );
        assert.ok(
          db
            .prepare('PRAGMA table_info(rb_sources)')
            .all()
            .some((row) => row.name === 'folder_path'),
        );
        if (existing)
          assert.equal(
            db.prepare('SELECT original_path FROM rb_sources').get().original_path,
            'originals/keep.pdf',
          );
      } finally {
        db.close();
      }
    }
  } finally {
    await cleanup();
  }
});

test('one scripted AI turn groups 3 entities and 9 evidenced edges; restore skips later edits and is reversible', () =>
  withCore('knowledge-turn', async (core) => {
    const store = createKnowledgeStore(core),
      project = await core.projects.create({ name: 'QCA' });
    const meeting = core.meetings.create({
      projectId: project.id,
      title: '知识整理',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    let entities = [];
    const edges = [];
    const workspaceCount = core.db.prepare('SELECT count(*) AS n FROM revisions').get().n;
    const runtime = createScriptedRuntime({
      script: async function* () {
        const turn = core.turns.running()[0],
          message = core.messages.list(meeting.id).messages[0];
        const actor = {
          actorId: 'agent_main',
          origin: 'ai',
          projectId: project.id,
          meetingId: meeting.id,
          turnId: turn.id,
        };
        entities = ['QCA', 'fsQCA', 'csQCA'].map((name) =>
          store.createEntity({ name, kind: 'method', layer: 'extracted' }, actor),
        );
        for (let i = 0; i < 9; i++)
          edges.push(
            store.createEdge(
              {
                fromRef: ref(entities[i % 3]),
                toRef: ref(entities[(i + 1) % 3]),
                relation: 'supports',
                layer: 'extracted',
                evidence: [{ ref: 'message:' + message.id, quote: message.text }],
              },
              actor,
            ),
          );
        yield '已按原文保存知识。';
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
      }),
    });
    const conductor = createConductor({ core, runner });
    conductor.start();
    try {
      core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '整理 QCA、fsQCA、csQCA 的关系。',
      });
      await conductor.idle();
      const [version] = store.versions.list().rows;
      assert.equal(version.source, 'ai-turn-end');
      assert.ok(version.closedAt);
      assert.equal(store.versions.changes(version.id).length, 12);
      assert.ok(store.versions.changes(version.id).every((row) => row.origin === 'ai'));
      assert.equal(core.db.prepare('SELECT count(*) AS n FROM revisions').get().n, workspaceCount);
      assert.equal(edges[0].meetingId, meeting.id);
      assert.equal(edges[0].turnId, version.turnId);
      assert.equal(edges[0].createdBy, 'agent_main');
      assert.ok(edges[0].evidence[0].ref.startsWith('message:'));
      store.updateEdge(edges[0].id, { relation: 'qualifies' });
      const corrected = store.getEdge(edges[0].id);
      assert.equal(corrected.layer, 'curated');
      assert.equal(corrected.origin, 'user');
      const restored = store.versions.restore(version.id);
      assert.deepEqual(restored.skipped, ['edge:' + edges[0].id]);
      assert.equal(restored.refs.length, 11);
      assert.equal(store.listEntities().total, 0);
      assert.equal(store.getEntity(ref(entities[0])).entity.status, 'removed');
      assert.equal(store.getEdge(edges[0].id).relation, 'qualifies');
      const undone = store.versions.restore(restored.version.id);
      assert.deepEqual(undone.skipped, []);
      assert.equal(store.listEntities().total, 3);
      assert.equal(store.getEdge(edges[1].id).relation, 'supports');
      assert.equal(store.getEdge(edges[0].id).relation, 'qualifies');
      const changes = core.events.since(0).filter((event) => event.type === 'knowledge.changed');
      assert.ok(changes.length);
      assert.ok(changes.every((event) => event.payload.refs.length));
    } finally {
      conductor.stop();
      await runtime.close();
    }
  }));

test('merging entities rewires relationships and aliases; restore, labels, memberships and single-record restore retain history', () =>
  withCore('knowledge-edit', async (core) => {
    const store = createKnowledgeStore(core),
      project = await core.projects.create({ name: '方法' });
    const target = store.createEntity({ kind: 'method', name: 'fsQCA', aliases: ['模糊集QCA'] }),
      source = store.createEntity({
        kind: 'method',
        name: '模糊集定性比较分析',
        nameEn: 'Fuzzy-set QCA',
        aliases: ['fs-QCA'],
      });
    const edge = store.createEdge({
      fromRef: ref(source),
      toRef: ref(target),
      relation: 'same-as',
    });
    store.createEdge({
      fromRef: ref(source),
      toRef: ref(target),
      relation: 'similar-to',
      layer: 'derived',
    });
    assert.equal(store.mergePreview({ into: target.id, from: [source.id] }).relationCount, 2);
    const version = store.versions.open({
        source: 'leave-page',
        projectId: project.id,
        actorId: 'person_user',
      }),
      actor = { versionId: version.id };
    store.mergeEntities({ into: target.id, from: [source.id] }, actor);
    store.label(ref(target), 'QCA #方法', true, actor);
    store.membership(project.id, ref(target), true, actor);
    store.versions.close(version.id);
    assert.equal(store.getEntity(ref(source)).entity.status, 'merged');
    assert.equal(store.getEdge(edge.id).status, 'removed');
    assert.equal(store.neighbors(ref(target), { layers: ['derived'] }).total, 0);
    assert.ok(store.getEntity(ref(target)).entity.aliases.includes('fs-QCA'));
    assert.equal(store.listEntities({ projectId: project.id }).total, 1);
    assert.equal(store.labels(ref(target))[0].label, 'QCA #方法');
    const reverted = store.versions.restore(version.id);
    assert.deepEqual(reverted.skipped, []);
    assert.equal(store.getEdge(edge.id).fromRef, ref(source));
    assert.equal(store.getEntity(ref(source)).entity.status, 'active');
    assert.equal(store.neighbors(ref(target), { layers: ['derived'] }).total, 0);
    assert.deepEqual(store.getEntity(ref(target)).entity.aliases, ['模糊集QCA']);
    assert.deepEqual(store.labels(ref(target)), []);
    assert.equal(store.listEntities({ projectId: project.id }).total, 0);
    const initial = store.versions.history(ref(target)).rows.at(-1);
    store.updateEntity(target.id, { description: '后来的解释' });
    const restored = store.versions.restoreRevision(initial.id);
    assert.equal(store.getEntity(ref(target)).entity.description, '');
    store.versions.restore(restored.version.id);
    assert.equal(store.getEntity(ref(target)).entity.description, '后来的解释');
    store.removeEntity(source.id);
    assert.equal(store.getEdge(edge.id).status, 'removed');
    store.versions.restore(store.versions.list().rows[0].id);
    assert.equal(store.getEdge(edge.id).status, 'active');
    const empty = store.versions.open({ source: 'leave-page' });
    assert.equal(store.versions.close(empty.id), null);
  }));

test('derived relationships upsert without versions, graph reads page by relation/layer and all four endpoint kinds work', () =>
  withCore('knowledge-query', async (core) => {
    const store = createKnowledgeStore(core),
      research = createResearchStore({ db: core.db, events: core.events });
    const source = research.createSource({ title: 'Paper', kind: 'paper' });
    research.addChunks(source.id, [{ text: 'Evidence', page: 4, kind: 'paragraph' }], {});
    const chunk = research.chunks(source.id)[0],
      item = research.createItem({
        type: 'knowledge',
        subtype: 'fact',
        title: 'Fact',
        body: 'Evidence',
      }),
      entity = store.createEntity({ kind: 'concept', name: 'Evidence' });
    for (const endpoint of ['source:' + source.id, 'item:' + item.id, 'chunk:' + chunk.id])
      store.createEdge({ fromRef: ref(entity), toRef: endpoint, relation: 'supports' });
    const count = store.versions.list().total;
    const derived = store.createEdge({
      fromRef: ref(entity),
      toRef: 'source:' + source.id,
      relation: 'similar-to',
      layer: 'derived',
      weight: 0.5,
    });
    const replaced = store.createEdge({
      fromRef: ref(entity),
      toRef: 'source:' + source.id,
      relation: 'similar-to',
      layer: 'derived',
      weight: 0.8,
    });
    assert.equal(derived.id, replaced.id);
    assert.equal(store.versions.list().total, count);
    assert.deepEqual(store.versions.history('edge:' + derived.id).rows, []);
    const page = store.neighbors(ref(entity), {
      relations: ['supports'],
      layers: ['curated'],
      limit: 2,
    });
    assert.equal(page.total, 3);
    assert.equal(page.rows.length, 2);
    assert.equal(page.remaining, 1);
    assert.equal(
      store.neighbors(ref(entity), { relations: ['supports'], offset: 2, limit: 2 }).rows.length,
      1,
    );
    assert.throws(
      () =>
        store.createEdge({ fromRef: ref(entity), toRef: 'entity:missing', relation: 'supports' }),
      { code: 'KNOWLEDGE_NODE_NOT_FOUND' },
    );
  }));
