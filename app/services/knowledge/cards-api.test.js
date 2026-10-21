import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from '../../testing.js';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';

test('card API estimates project papers, manually builds other files while disabled, and exposes receipts through jobs', async () => {
  const temp = await tempDir('cards-api');
  const runtime = createScriptedRuntime({
    async *script({ input }) {
      const paragraph = JSON.parse(input).paragraphs[0];
      const evidence = { chunkId: paragraph.chunkId, quote: paragraph.text };
      yield JSON.stringify({
        methods: [{ name: 'fsQCA', variantOf: 'QCA', evidence }],
        software: [{ name: 'QCA', evidence }],
        code: [{ name: 'analysis.R', implements: ['fsQCA'], evidence }],
      });
    },
  });
  const app = await createApp({ dataRoot: temp.dir, token: 'card-test', runtime });
  const url = await app.listen();
  const call = async (route, body = undefined) => {
    const response = await fetch(url + '/api/knowledge/' + route, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: 'Bearer card-test', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  };
  try {
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          knowledge: { cards: { enabled: false } },
          models: { default: { provider: 'fixture', model: 'scripted' } },
          providers: [
            {
              id: 'fixture',
              type: 'openai-compatible',
              baseUrl: 'http://127.0.0.1:1',
              models: [{ id: 'scripted', contextWindow: 100000, maxTokens: 10000 }],
            },
          ],
        },
      },
    });
    await app.knowledgeJobs.idle();
    const project = await app.core.projects.create({ name: 'Cards HTTP' });
    const paper = app.research.store.createSource({
      title: 'Project paper',
      kind: 'paper',
      projectId: project.id,
    });
    const globalPaper = app.research.store.createSource({ title: 'Global paper', kind: 'paper' });
    for (const source of [paper, globalPaper])
      app.research.store.addChunks(source.id, [{ page: 1, text: 'We use fsQCA in this study.' }]);
    const file = app.research.store.createSource({ title: 'Methods file', kind: 'file' });
    app.research.store.addChunks(file.id, [
      {
        page: 7,
        text: 'fsQCA is a variant of QCA. The QCA software is used; analysis.R implements fsQCA.',
      },
    ]);
    const estimate = await call('cards/estimate?projectId=' + project.id);
    assert.equal(estimate.count, 1);
    assert.equal(estimate.currency, 'USD');
    assert.equal(estimate.upperCost, 0.0153);
    assert.equal((await call('cards/estimate')).count, 2);
    assert.equal((await call('jobs')).cards.counts.done, 0);
    await call('cards', { sourceIds: [file.id] });
    await app.knowledgeJobs.idle();
    const job = (await call('jobs')).cards.jobs[0];
    assert.equal(job.state, 'done', JSON.stringify(job));
    assert.equal(job.result.usage.requests, 1);
    assert.equal(job.result.usage.source, 'unreported');
    const entities = app.knowledge.listEntities().rows;
    assert.equal(job.result.entities.length, entities.length);
    const edges = app.core.db
      .prepare("SELECT * FROM kb_edges WHERE status='active' AND layer='extracted'")
      .all();
    const variant = entities.find((row) => row.kind === 'variant');
    const parent = entities.find((row) => row.kind === 'method');
    const code = entities.find((row) => row.kind === 'code');
    assert.ok(
      edges.some(
        (row) =>
          row.relation === 'variant-of' &&
          row.from_ref === 'entity:' + variant.id &&
          row.to_ref === 'entity:' + parent.id,
      ),
    );
    assert.ok(
      edges.some(
        (row) =>
          row.relation === 'implements' &&
          row.from_ref === 'entity:' + code.id &&
          row.to_ref === 'entity:' + variant.id,
      ),
    );
    assert.ok(entities.every((row) => row.evidence[0].chunkId === file.id + '-c0'));
    assert.equal((await call('versions')).rows[0].id, job.result.versionId);
    await call('versions/' + job.result.versionId + '/restore', {});
    assert.equal(app.knowledge.listEntities().total, 0);
  } finally {
    await app.close();
    await temp.cleanup();
  }
});
