import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createResearch } from '../research/index.js';
import { createKnowledgeStore } from './store.js';
import { createKnowledgeGraph } from './graph.js';
import { createTools } from '../tools.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createTurnRunner } from '../turn-runner.js';
import { createContextAssembly } from '../context-assembly.js';

test('expert tools group evidenced edits in one turn, read entities and withdraw the version without approval', () =>
  withCore('knowledge-tools-turn', async (core) => {
    const project = await core.projects.create({ name: 'QCA 文献' });
    const expert = await core.participants.create({
      kind: 'ai',
      name: '方法专家',
      definition: { prompt: 'Read original methods before organizing knowledge.' },
    });
    const meeting = core.meetings.create({
      projectId: project.id,
      members: [{ participantId: 'person_user' }, { participantId: expert.id }],
      policy: { approval: 'ask' },
    });
    const research = createResearch(core);
    const source = research.store.createSource({
      projectId: project.id,
      title: 'QCA study',
      kind: 'paper',
    });
    research.store.addChunks(source.id, [
      { text: 'This study uses fsQCA, a variant of QCA.', page: 2 },
    ]);
    const chunk = research.store.chunks(source.id)[0];
    const item = research.store.createItem({
      projectId: project.id,
      title: 'Method note',
      body: 'Original',
    });
    const store = createKnowledgeStore(core);
    const tools = createTools(core, research);
    /** @type {any} */
    let batch;
    let turnNumber = 0;
    const runtime = createScriptedRuntime({
      script: async function* ({ call }) {
        if (++turnNumber === 1) {
          const before = await call('kb_graph', { query: 'fsQCA' });
          assert.equal(before.edges.length, 0);
          const evidence = [{ ref: 'chunk:' + chunk.id, quote: chunk.text, page: 2 }];
          batch = await call('kb_write', {
            ops: [
              { op: 'createEntity', key: 'qca', name: 'QCA', kind: 'method' },
              {
                op: 'createEntity',
                key: 'fs',
                name: 'fsQCA',
                kind: 'variant',
                aliases: ['fuzzy-set QCA'],
                description: 'First line\nSecond line',
              },
              {
                op: 'createEdge',
                fromRef: 'source:' + source.id,
                toRef: '$fs',
                relation: 'uses',
                evidence: evidence[0],
              },
              { op: 'createEdge', fromRef: '$fs', toRef: '$qca', relation: 'variant-of', evidence },
              {
                op: 'createEdge',
                fromRef: 'source:' + source.id,
                toRef: '$qca',
                relation: 'describes',
                evidence,
              },
              { op: 'label', ref: '$fs', add: ['方法'] },
              { op: 'updateEntity', id: 'missing', patch: { name: 'Does not exist' } },
              { op: 'member', ref: '$fs', projectId: project.id },
              { op: 'label', ref: '$fs', add: ['must-roll-back', null] },
            ],
          });
          assert.ok(batch.results[6].error);
          assert.ok(!batch.results[7].error);
          assert.ok(batch.results[8].error);
          const entity = await call('research_read', {
            type: 'entity',
            id: batch.results[1].id,
            limit: 1,
          });
          assert.deepEqual(entity.entity.aliases, ['fuzzy-set QCA']);
          assert.deepEqual(entity.labels, ['方法']);
          assert.equal(entity.entity.description, 'First line');
          assert.ok(entity.descriptionRemaining > 0);
          assert.equal(entity.remaining, 1);
          assert.deepEqual(Object.keys(entity.edges[0]).sort(), [
            'from',
            'layer',
            'relation',
            'to',
          ]);
          const full = await call('research_read', {
            type: 'entity',
            id: batch.results[1].id,
            full: true,
          });
          assert.equal(full.entity.description, 'First line\nSecond line');
          await call('research_write', {
            op: 'updateItem',
            args: { id: item.id, patch: { body: 'Corrected from original evidence' } },
          });
          assert.equal(research.store.revisions(item.id).length, 1);
        } else {
          const listed = await call('workspace_versions', {
            resource: 'knowledge',
            action: 'list',
          });
          assert.equal(listed.rows[0].id, batch.versionId);
          const detail = await call('workspace_versions', {
            resource: 'knowledge',
            action: 'read',
            id: batch.versionId,
          });
          assert.equal(detail.changes.length, 7);
          const restored = await call('workspace_versions', {
            resource: 'knowledge',
            action: 'restore',
            id: batch.versionId,
          });
          assert.deepEqual(restored.skipped, []);
          for (const result of batch.results.slice(2, 5))
            assert.equal(store.getEdge(result.id).status, 'removed');
        }
        yield '已完成。';
      },
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools,
      contextAssembly: createContextAssembly({
        core,
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
      }),
    });
    try {
      const first = await runner.run({ meetingId: meeting.id, participantId: expert.id });
      assert.equal(first.stopReason, 'completed');
      const versions = store.versions.list().rows;
      assert.equal(versions.length, 1);
      assert.equal(versions[0].source, 'ai-turn-end');
      assert.ok(versions[0].closedAt);
      for (const result of batch.results.slice(2, 5)) {
        const edge = store.getEdge(result.id);
        assert.equal(edge.origin, 'ai');
        assert.equal(edge.createdBy, expert.id);
        assert.equal(edge.meetingId, meeting.id);
        assert.equal(edge.turnId, versions[0].turnId);
        assert.equal(edge.evidence[0].ref, 'chunk:' + chunk.id);
      }
      const second = await runner.run({ meetingId: meeting.id, participantId: expert.id });
      assert.equal(second.stopReason, 'completed');
      assert.equal(
        core.db.prepare("SELECT count(*) AS n FROM tool_calls WHERE kind='approval'").get().n,
        0,
      );
    } finally {
      await tools.approvals.close();
      await runtime.close();
    }
  }));

test('graph pages lightweight paths, filters active relations and generates project folder edges without storing them', () =>
  withCore('knowledge-tools-graph', async (core) => {
    const project = await core.projects.create({ name: 'Project graph' });
    const research = createResearch(core);
    const store = createKnowledgeStore(core);
    const source = research.store.createSource({
      projectId: project.id,
      title: 'Methods',
      folderPath: '论文/methods.pdf',
    });
    const entity = store.createEntity({ name: 'fsQCA', aliases: ['Fuzzy QCA'], kind: 'method' });
    const other = store.createEntity({ name: 'QCA', kind: 'method' });
    store.createEdge({
      fromRef: 'source:' + source.id,
      toRef: 'entity:' + entity.id,
      relation: 'uses',
    });
    store.createEdge({
      fromRef: 'entity:' + entity.id,
      toRef: 'entity:' + other.id,
      relation: 'variant-of',
    });
    store.membership(project.id, 'entity:' + entity.id, true);
    const removed = store.createEdge({
      fromRef: 'source:' + source.id,
      toRef: 'entity:' + other.id,
      relation: 'supports',
    });
    store.removeEdge(removed.id);
    const graph = createKnowledgeGraph(core, research);
    const count = core.db.prepare('SELECT count(*) AS n FROM kb_edges').get().n;
    const first = await graph({ query: 'fuzzy qca', projectId: project.id, depth: 2, limit: 1 });
    assert.equal(first.total, 3);
    assert.equal(first.remaining, 2);
    assert.ok(first.paths.length);
    assert.ok(
      first.nodes.every((node) => Object.keys(node).sort().join(',') === 'degree,kind,name,ref'),
    );
    const rest = await graph({
      ref: 'entity:' + entity.id,
      projectId: project.id,
      depth: 2,
      limit: 2,
      offset: 1,
    });
    assert.equal(rest.remaining, 0);
    const all = [...first.edges, ...rest.edges];
    assert.equal(all.filter((edge) => edge.relation === 'in-folder').length, 1);
    assert.ok(!all.some((edge) => edge.relation === 'supports'));
    const folder = await graph({ ref: `folder:${project.id}/论文`, projectId: project.id });
    assert.equal(folder.edges[0].from, 'source:' + source.id);
    assert.equal(core.db.prepare('SELECT count(*) AS n FROM kb_edges').get().n, count);
    const filtered = await graph({
      ref: 'source:' + source.id,
      relations: ['uses'],
      layers: ['curated'],
    });
    assert.equal(filtered.edges.length, 1);
  }));

test('knowledge tools edit, merge, label, supersede and report later-edited records skipped on restore', () =>
  withCore('knowledge-tools-edit', async (core) => {
    const research = createResearch(core);
    const store = createKnowledgeStore(core);
    const tools = createTools(core, research);
    const meeting = core.meetings.create({ members: [{ participantId: 'agent_main' }] });
    const context = {
      participantId: 'agent_main',
      meetingId: meeting.id,
      turnId: 'turn_tool_test',
    };
    try {
      const batch = await tools.run(
        'kb_write',
        {
          ops: [
            { op: 'createEntity', key: 'a', name: 'A', kind: 'method' },
            { op: 'createEntity', key: 'b', name: 'B', kind: 'method' },
            { op: 'createEntity', key: 'c', name: 'C', kind: 'method' },
            { op: 'createEdge', key: 'edge', fromRef: '$a', toRef: '$c', relation: 'uses' },
            { op: 'updateEntity', id: '$b', patch: { aliases: ['Alias B'] } },
            { op: 'updateEdge', id: '$edge', patch: { relation: 'describes' } },
            { op: 'label', ref: '$edge', add: ['old'] },
            { op: 'label', ref: '$edge', remove: ['old'], add: ['new'] },
            { op: 'merge', into: '$b', from: ['$a'] },
            { op: 'remove', ref: '$c' },
          ],
        },
        context,
      );
      assert.ok(
        batch.results.every((row) => !row.error),
        JSON.stringify(batch.results),
      );
      assert.equal(store.getEntity(batch.results[0].ref).entity.status, 'merged');
      assert.equal(store.getEdge(batch.results[3].id).status, 'removed');
      store.closeTurn(context.turnId);
      store.updateEntity(batch.results[1].id, { description: 'User correction' });
      const restored = await tools.run(
        'workspace_versions',
        {
          action: 'restore',
          resource: 'knowledge',
          id: batch.versionId,
        },
        { ...context, turnId: 'turn_restore' },
      );
      assert.deepEqual(restored.skipped, [batch.results[1].ref]);
      assert.match(restored.skippedReason, /changed after/);
      const item = await tools.run(
        'research_write',
        { op: 'createItem', args: { title: 'Code', type: 'code', body: 'v1' } },
        context,
      );
      const replacement = await tools.run(
        'research_write',
        {
          op: 'supersedeItem',
          args: { id: item.id, replacement: { title: 'Code v2', body: 'v2' } },
        },
        context,
      );
      assert.equal(replacement.superseded.status, 'superseded');
      assert.equal(research.store.revisions(item.id).length, 1);
      const source = research.store.createSource({ title: 'Old' });
      const updated = await tools.run(
        'research_write',
        {
          op: 'updateSource',
          args: {
            id: source.id,
            patch: { title: 'Correct title', metadata: { doi: '10.1000/test' } },
          },
        },
        context,
      );
      assert.equal(updated.title, 'Correct title');
    } finally {
      await tools.approvals.close();
    }
  }));
