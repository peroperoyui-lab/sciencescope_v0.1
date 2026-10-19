import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createKnowledgeStore } from './store.js';
import { createResearch } from '../research/index.js';
import { createSemantic } from '../research/semantic/index.js';

function embedding() {
  const vector = () => {
    const result = new Float32Array(384);
    result[0] = 1;
    return result;
  };
  return {
    warmup: async () => {},
    close: async () => {},
    embedQuery: async () => vector(),
    embedPassages: async (texts) => texts.map(vector),
  };
}

test('entity keyword and vector projections rebuild without losing catalog or originals, retaining project and visibility choices', () =>
  withCore('knowledge-projection', async (core) => {
    const knowledge = createKnowledgeStore(core),
      research = createResearch(core),
      project = await core.projects.create({ name: 'QCA' });
    const source = await research.importSource({
      name: 'paper.txt',
      bytes: Buffer.from('Original study evidence.'),
    });
    const entity = knowledge.createEntity({
      kind: 'method',
      name: 'QCA',
      nameEn: 'Comparative analysis',
      aliases: ['fsQCA'],
      description: 'Qualitative comparisons',
    });
    const hidden = knowledge.createEntity({
      kind: 'concept',
      name: 'QCA private',
      visibility: 'private',
    });
    knowledge.membership(project.id, 'entity:' + entity.id, true);
    const keyword = (query, options = {}) => research.search(query, options);
    assert.equal(keyword('fsQCA').hits[0].id, entity.id);
    assert.ok(keyword('QCA', { audience: 'agent' }).hits.every((hit) => hit.id !== hidden.id));
    assert.equal(
      keyword('fsQCA', { projectId: project.id, includePersonal: false }).hits[0].id,
      entity.id,
    );
    const semantic = createSemantic(core, {
      embed: embedding(),
      hardware: async () => ({ supported: true }),
    });
    try {
      await semantic.start();
      await semantic.configure('enable');
      await semantic.idle();
      const result = await semantic.search(
        'fsQCA',
        { projectId: project.id, includePersonal: false, audience: 'agent' },
        keyword,
      );
      assert.equal(result.mode, 'hybrid');
      assert.equal(result.hits[0].id, entity.id);
      assert.equal(result.hits[0].type, 'entity');
      core.db.exec(
        "DELETE FROM rb_fts WHERE doc_type='entity'; DELETE FROM rb_vec; DELETE FROM rb_vec_docs;",
      );
      assert.equal(knowledge.getEntity('entity:' + entity.id).entity.name, 'QCA');
      assert.equal(research.store.getSource(source.id).originalPath, source.originalPath);
      knowledge.rebuildIndex();
      await semantic.configure('rebuild');
      await semantic.idle();
      assert.equal(keyword('fsQCA').hits[0].id, entity.id);
      assert.ok(
        (await semantic.search('fsQCA', { audience: 'agent' }, keyword)).hits.some(
          (hit) => hit.id === entity.id,
        ),
      );
      knowledge.removeEntity(entity.id);
      await semantic.idle();
      assert.equal(keyword('fsQCA').total, 0);
      knowledge.versions.restore(knowledge.versions.list().rows[0].id);
      await semantic.idle();
      assert.equal(keyword('fsQCA').hits[0].id, entity.id);
      const link = research.store.createSource({
        title: 'Documentation',
        kind: 'link',
        metadata: { url: 'https://example.org' },
      });
      assert.equal(link.kind, 'link');
      const code = research.store.createItem({
        type: 'code',
        subtype: 'snippet',
        title: 'Example',
        body: 'print(1)',
        payload: { language: 'python', code: 'print(1)' },
      });
      assert.equal(code.type, 'code');
    } finally {
      await semantic.close();
    }
  }));
