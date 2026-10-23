import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createResearch } from '../research/index.js';
import { createKnowledgeStore } from './store.js';
import { createExpansionIndex } from './expansion-index.js';
import { collectExpansionGraph } from './expansion-graph.js';
import { rankExpansion } from './expansion-rank.js';
import { fuseExpanded, explainExpanded } from './expansion-results.js';
import { populateRetrievalScale } from './retrieval-benchmark.js';
import { RETRIEVAL_QUESTIONS } from './retrieval-corpus.js';
import { createTools } from '../tools.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createTurnRunner } from '../turn-runner.js';
import { createContextAssembly } from '../context-assembly.js';

const ref = (entity) => 'entity:' + entity.id;
const settingsPatch = (core, enabled) =>
  core.workspace.edit({
    resource: 'settings',
    key: 'app',
    op: 'patch',
    args: { changes: { knowledge: { retrievalExpansion: enabled } } },
  });

test('one/two-hop discovery visits each node once and the event-fed adjacency follows edge edits', () =>
  withCore('retrieval-triangle', async (core) => {
    const store = createKnowledgeStore(core);
    const index = createExpansionIndex(core);
    const [a, b, c, d] = ['A', 'B', 'C', 'D'].map((name) =>
      store.createEntity({ name, kind: 'method' }),
    );
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ])
      store.createEdge({ fromRef: ref(from), toRef: ref(to), relation: 'uses' });
    const cd = store.createEdge({ fromRef: ref(c), toRef: ref(d), relation: 'uses' });
    const input = {
      seeds: [{ ref: ref(a), rank: 0 }],
      query: 'A',
      options: { knowledge: true },
      index,
    };
    const one = collectExpansionGraph(core.db, input);
    assert.equal(one.nodes.size, 3);
    assert.deepEqual(one.visited, [ref(a)]);
    const two = collectExpansionGraph(core.db, { ...input, depth: 2 });
    assert.equal(two.nodes.size, 4);
    assert.equal(new Set(two.visited).size, two.visited.length);
    const ranked = rankExpansion(two);
    assert.equal(ranked.paths.get(ref(d)).edges.length, 2);
    assert.ok(ranked.iterations <= 30);
    store.removeEdge(cd.id);
    assert.equal(collectExpansionGraph(core.db, { ...input, depth: 2 }).nodes.size, 3);
    store.createEdge({
      fromRef: ref(b),
      toRef: ref(d),
      relation: 'defines',
      validTo: '2000-01-01',
    });
    assert.equal(collectExpansionGraph(core.db, { ...input, depth: 2 }).nodes.size, 3);
  }));

test('graph retrieval shares global/project scope, memberships and active shared record filtering', () =>
  withCore('retrieval-scope', async (core) => {
    const research = createResearch(core);
    const store = createKnowledgeStore(core),
      index = createExpansionIndex(core);
    const project = await core.projects.create({ name: 'Scope' });
    const other = await core.projects.create({ name: 'Other' });
    const a = store.createEntity({ name: 'Anchor', kind: 'method' });
    const privateEntity = store.createEntity({
      name: 'Private',
      kind: 'method',
      visibility: 'private',
    });
    const paper = research.store.createSource({
      title: 'Other paper',
      kind: 'paper',
      projectId: other.id,
    });
    const file = research.store.createSource({
      title: 'Other code',
      kind: 'file',
      projectId: other.id,
    });
    const local = research.store.createSource({
      title: 'Local',
      kind: 'file',
      projectId: project.id,
    });
    const items = ['active', 'proposed', 'rejected', 'superseded'].map((status) =>
      research.store.createItem({ title: status, body: status, status }),
    );
    const privateItem = research.store.createItem({
      title: 'Private item',
      body: 'Private',
      visibility: 'private',
    });
    for (const target of [
      ref(privateEntity),
      'source:' + paper.id,
      'source:' + file.id,
      'source:' + local.id,
      ...items.map((item) => 'item:' + item.id),
      'item:' + privateItem.id,
    ])
      store.createEdge({ fromRef: ref(a), toRef: target, relation: 'uses' });
    store.membership(project.id, ref(a), true);
    const input = { query: 'Anchor', seeds: [{ ref: ref(a), rank: 0 }], index };
    const global = collectExpansionGraph(core.db, { ...input, options: { knowledge: true } });
    assert.ok(global.nodes.has('source:' + paper.id));
    assert.ok(!global.nodes.has('source:' + file.id));
    assert.ok(!global.nodes.has(ref(privateEntity)));
    assert.deepEqual(
      [...global.nodes.keys()].filter((value) => value.startsWith('item:')),
      ['item:' + items[0].id],
    );
    const scoped = collectExpansionGraph(core.db, {
      ...input,
      options: { projectId: project.id, includePersonal: false },
    });
    assert.deepEqual(new Set(scoped.nodes.keys()), new Set([ref(a), 'source:' + local.id]));
    store.membership(project.id, ref(a), false);
    assert.equal(
      collectExpansionGraph(core.db, {
        ...input,
        options: { projectId: project.id, includePersonal: false },
      }).nodes.size,
      0,
    );
  }));

test('subgraph discloses the 2000-node bound; hub penalty and query fanout change weights without deleting facts', () =>
  withCore('retrieval-hub', async (core) => {
    populateRetrievalScale(core.db, 2100, 2200);
    const graph = collectExpansionGraph(core.db, {
      query: 'Synthetic method 42',
      seeds: [
        { ref: 'entity:scale_0', rank: 0 },
        { ref: 'entity:scale_42', rank: 1 },
      ],
      options: { knowledge: true },
    });
    assert.equal(graph.nodes.size, 2000);
    assert.equal(graph.truncated, true);
    const before = core.db.prepare('SELECT count(*) AS n FROM kb_edges').get().n;
    const plain = rankExpansion(graph, { hubPenalty: false, fanout: false });
    const guarded = rankExpansion(graph);
    assert.ok(guarded.restart.get('entity:scale_0') < plain.restart.get('entity:scale_0'));
    assert.ok(guarded.clipped > 0);
    assert.equal(core.db.prepare('SELECT count(*) AS n FROM kb_edges').get().n, before);
  }));

test('final graph quota allows high relevant graph hits in front and limits explanations to five', () => {
  const original = Array.from({ length: 24 }, (_, index) => ({
    type: 'item',
    id: 'o' + index,
    text: 'original',
    citation: '[@original]',
  }));
  const nodes = new Map([['entity:seed', { name: 'Method' }]]);
  const candidates = Array.from({ length: 10 }, (_, index) => {
    const refId = 'source:g' + index;
    nodes.set(refId, { name: 'Paper ' + index });
    return {
      hit: {
        type: 'chunk',
        id: 'g' + index,
        sourceId: 'g' + index,
        text: 'Original evidence',
        citation: '[S1 p.2]',
      },
      score: 1,
      path: {
        nodes: ['entity:seed', refId],
        edges: [{ from: refId, to: 'entity:seed', relation: 'uses' }],
        strength: 1,
      },
    };
  });
  const context = {
    keywordRankings: [],
    vectorRankings: [
      [...candidates.map((candidate) => candidate.hit), ...original].map(({ type, id }) => ({
        ref: { type, id },
      })),
    ],
  };
  const result = explainExpanded(fuseExpanded(original, candidates, context, 24), { nodes });
  assert.equal(result.length, 24);
  assert.equal(result.filter((hit) => hit.origin === 'graph').length, 6);
  assert.equal(result[0].origin, 'graph');
  assert.equal(result.filter((hit) => hit.via).length, 5);
  assert.ok(result.filter((hit) => hit.via).every((hit) => hit.text.includes('经由：')));
  assert.equal(
    fuseExpanded(original.slice(0, 3), candidates, context, 3).filter(
      (hit) => hit.origin === 'graph',
    ).length,
    0,
  );
});

async function smallGraph(core) {
  const research = createResearch(core),
    store = createKnowledgeStore(core);
  for (let index = 0; index < 3; index++) {
    const source = research.store.createSource({ title: 'anchor ' + index, kind: 'paper' });
    research.store.addChunks(source.id, [{ text: 'anchor background ' + index, page: 1 }]);
  }
  const source = research.store.createSource({ title: 'Hidden original', kind: 'paper' });
  research.store.addChunks(source.id, [
    { text: 'The original experiment used the registered fuzzy comparison protocol.', page: 4 },
  ]);
  const chunk = research.store.chunks(source.id)[0];
  const evidence = [{ ref: 'chunk:' + chunk.id, quote: chunk.text, page: 4 }];
  const entity = store.createEntity({
    name: 'anchor',
    kind: 'method',
    description: 'Do not return this description as graph evidence.',
    evidence,
  });
  const duplicate = store.createEntity({ name: 'anchor alias', kind: 'method', evidence });
  store.createEdge({ fromRef: ref(entity), toRef: 'source:' + source.id, relation: 'uses' });
  store.createEdge({
    fromRef: ref(duplicate),
    toRef: 'source:' + source.id,
    relation: 'uses',
    layer: 'derived',
    weight: 0.5,
  });
  return { research, source, chunk, entity, duplicate, store };
}

test('search reads its setting, deduplicates evidenced paths, and degrades for empty/error/timeout graphs', () =>
  withCore('retrieval-fallback', async (core) => {
    const { research, chunk } = await smallGraph(core);
    const off = research.search('anchor', { limit: 12 });
    assert.equal(off.graph.reason, 'disabled');
    await settingsPatch(core, true);
    const on = research.search('anchor', { limit: 12 });
    assert.equal(on.graph.used, true);
    assert.ok(on.total >= on.hits.length);
    const evidence = on.hits.filter((hit) => hit.id === chunk.id);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].origin, 'graph');
    assert.equal(evidence[0].page, 4);
    assert.match(evidence[0].text, /original experiment/);
    assert.ok(!evidence[0].text.includes('Do not return'));
    assert.ok(on.hits.filter((hit) => hit.origin === 'graph').length <= on.hits.length / 4);
    assert.equal(research.search('anchor', { graph: false }).graph.reason, 'disabled');
    const error = createResearch(core, {
      expansion: {
        collect: () => {
          throw new Error('fixture');
        },
      },
    }).search('anchor', { limit: 12 });
    assert.equal(error.graph.reason, 'error');
    assert.deepEqual(
      error.hits.map((hit) => hit.id),
      off.hits.map((hit) => hit.id),
    );
    const timed = createResearch(core, { expansion: { timeoutMs: 0 } }).search('anchor', {
      limit: 12,
    });
    assert.equal(timed.graph.reason, 'timeout');
    const fresh = await core.projects.create({ name: 'Empty graph' });
    const source = research.store.createSource({ title: 'lonely', projectId: fresh.id });
    research.store.addChunks(source.id, [{ text: 'lonely passage' }]);
    assert.equal(
      research.search('lonely', { projectId: fresh.id, includePersonal: false }).graph.reason,
      'empty-graph',
    );
    await settingsPatch(core, false);
    assert.equal(research.search('anchor').graph.reason, 'disabled');
  }));

test('zero-similarity edges preserve probability and parallel edges do not consume neighbour slots', () => {
  const nodes = new Map(
    Array.from({ length: 17 }, (_, index) => [String(index), { relevance: 17 - index }]),
  );
  const graph = {
    nodes,
    edges: Array.from({ length: 16 }, (_, index) => ({
      from: '0',
      to: String(index + 1),
      strength: 1,
    })),
    degrees: new Map(),
    seeds: [{ ref: '0', rank: 0 }],
    depth: 1,
  };
  graph.edges.push({ from: '0', to: '1', strength: 1 });
  assert.equal(rankExpansion(graph).clipped, 1);
  graph.edges.forEach((edge) => (edge.strength = 0));
  const ranked = rankExpansion(graph);
  assert.equal(
    [...ranked.scores.values()].reduce((sum, score) => sum + score, 0),
    1,
  );
});

test('an entity discovered through a relationship resolves the chunkId evidence written by paper cards', () =>
  withCore('retrieval-card-evidence', async (core) => {
    const { research, store, entity, source, chunk } = await smallGraph(core);
    for (const row of core.db.prepare('SELECT id FROM kb_edges').all()) store.removeEdge(row.id);
    const target = store.createEntity({
      name: 'Fuzzy protocol',
      kind: 'method',
      evidence: [{ chunkId: chunk.id, quote: chunk.text, page: 4 }],
    });
    store.createEdge({ fromRef: ref(entity), toRef: ref(target), relation: 'variant-of' });
    const found = research
      .search('anchor', { graph: { depth: 1 }, limit: 12 })
      .hits.find((hit) => hit.id === chunk.id);
    assert.equal(found.sourceId, source.id);
    assert.equal(found.origin, 'graph');
    assert.equal(found.page, 4);
    assert.equal(found.via.at(-1).ref, ref(target));
    research.store.addChunks(source.id, [{ text: 'Updated original protocol.', page: 5 }]);
    const updated = research
      .search('anchor', { graph: { depth: 1 }, limit: 12 })
      .hits.find((hit) => hit.id === chunk.id);
    assert.match(updated.text, /Updated original protocol/);
    assert.equal(updated.page, 5);
  }));

test('research_search graph parameter works in a scripted expert turn without an approval card', () =>
  withCore('retrieval-tool', async (core) => {
    const { research, chunk } = await smallGraph(core);
    const meeting = core.meetings.create({ title: 'Graph evidence', policy: { approval: 'ask' } });
    const tools = createTools(core, research);
    const spec = tools.specs.find((tool) => tool.name === 'research_search');
    assert.ok(spec.parameters.graph);
    assert.match(spec.description, /depth:2/);
    const runtime = createScriptedRuntime({
      async *script({ call }) {
        const result = await call('research_search', {
          query: 'anchor',
          graph: { depth: 2 },
          limit: 12,
        });
        assert.equal(result.graph.used, true);
        assert.ok(result.hits.some((hit) => hit.id === chunk.id && hit.via));
        yield 'The original evidence is on page 4.';
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
      const turn = await runner.run({ meetingId: meeting.id, participantId: 'agent_main' });
      assert.equal(turn.stopReason, 'completed');
      assert.equal(
        core.db.prepare("SELECT count(*) AS n FROM tool_calls WHERE kind='approval'").get().n,
        0,
      );
    } finally {
      await tools.approvals.close();
      await runtime.close();
    }
  }));

test('the frozen synthetic evaluation contains ten general and ten method questions with source labels', () => {
  assert.equal(RETRIEVAL_QUESTIONS.length, 20);
  assert.equal(RETRIEVAL_QUESTIONS.filter((question) => question.group === 'method').length, 10);
  assert.equal(new Set(RETRIEVAL_QUESTIONS.map((question) => question.id)).size, 20);
  assert.ok(RETRIEVAL_QUESTIONS.every((question) => question.correct.length > 0));
});
