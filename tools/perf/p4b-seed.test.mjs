import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { createCore } from '../../app/core/index.js';
import { createKnowledgeStore } from '../../app/services/knowledge/store.js';
import { createVersions } from '../../app/services/versions/index.js';
import { fixtureMap, seedP4b, versionBytes } from './p4b-seed.mjs';

test('P4b corpus preserves base counts and bytes while real service histories support the new pages', async () => {
  const parent = path.resolve('.sciencescope-local/temp/p4b');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'seed-test-'));
  try {
    const seeded = await seedP4b({ dataRoot: root, tiny: true });
    const reused = await seedP4b({ dataRoot: root, tiny: true });
    assert.equal(reused.projectId, seeded.projectId);
    assert.equal(seeded.counts.projectFiles, 6);
    assert.equal(seeded.counts.messages, 24);
    const core = await createCore({ dataRoot: root });
    const versions = createVersions(core);
    try {
      const nodes = (await core.workspace.read({ resource: 'map', key: seeded.projectId })).value
        .nodes;
      assert.equal(nodes.length, 20);
      assert.equal(nodes.at(-1).floating, true);
      const message = core.messages.get(seeded.p4b.evidenceMessageId);
      const calls = core.turns.toolCalls(message.turnId);
      assert.equal(
        calls.find((call) => call.name === 'research_read').result.source.id,
        seeded.files[0].sourceId,
      );
      const knowledge = createKnowledgeStore(core);
      assert.equal(knowledge.versions.get(seeded.p4b.knowledgeVersionId).closedAt != null, true);
      assert.equal(knowledge.versions.changes(seeded.p4b.knowledgeVersionId).length, 2);
      const group = versions.list(seeded.projectId).find((row) => row.id === seeded.versionGroupId);
      assert.equal(group.versions.length, 4);
      for (const version of group.versions)
        assert.match((await versions.read(version.id)).notes.text, /合成说明/);
      const bytes = await readFile(path.join(seeded.projectFolder, seeded.docx));
      assert.deepEqual(await versionBytes(bytes, 3), await versionBytes(bytes, 3));
      assert.deepEqual(fixtureMap(), fixtureMap());
      assert.equal(fixtureMap().nodes.length, 200);
      await assert.rejects(seedP4b({ dataRoot: root, tiny: true, seed: 'another-seed' }));
    } finally {
      await versions.close();
      core.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
