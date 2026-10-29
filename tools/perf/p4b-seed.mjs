// P4b extends the unchanged P4a v2 corpus through public offline services.
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createCore } from '../../app/core/index.js';
import { createVersions } from '../../app/services/versions/index.js';
import { createResearch } from '../../app/services/research/index.js';
import { createKnowledgeStore } from '../../app/services/knowledge/store.js';
import { seedFixture } from './seed.mjs';

export function fixtureMap(count = 200) {
  return {
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `p4b-node-${index}`,
      parent: index === 0 || index === count - 1 ? null : `p4b-node-${Math.floor((index - 1) / 4)}`,
      text: index === 0 ? '城市韧性研究' : `合成研究节点 ${index}：证据、口径与比较`,
      ...(index === count - 1 ? { floating: true, x: 80, y: 80 } : {}),
    })),
    edges: [
      { id: 'p4b-link', from: 'p4b-node-1', to: 'p4b-node-2', label: '对照', directed: true },
    ],
  };
}

export async function versionBytes(original, number) {
  const zip = await JSZip.loadAsync(original);
  const file = zip.file('word/document.xml');
  const xml = await file.async('string');
  zip.file(
    'word/document.xml',
    xml.replace(
      '<w:sectPr/>',
      `<w:p><w:r><w:t>P4b 合成第 ${number} 版：核对证据与案例 ${number}。</w:t></w:r></w:p><w:sectPr/>`,
    ),
    { date: new Date('2026-10-27T00:00:00Z') },
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function verify(core, versions, manifest) {
  const count = (sql) => Number(core.db.prepare(sql).get(manifest.projectId).n);
  assert.equal(
    count('SELECT count(*) n FROM rb_sources WHERE project_id=?'),
    manifest.counts.sources,
  );
  assert.equal(
    count(
      'SELECT count(*) n FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id WHERE s.project_id=?',
    ),
    manifest.counts.chunks,
  );
  assert.equal(
    count(
      'SELECT count(*) n FROM messages m JOIN meetings g ON g.id=m.meeting_id WHERE g.project_id=?',
    ),
    manifest.counts.messages,
  );
  for (const file of manifest.files) {
    const bytes = await readFile(path.join(manifest.projectFolder, file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const group = versions
    .list(manifest.projectId)
    .find((entry) => entry.id === manifest.versionGroupId);
  assert.equal(group.versions.length, manifest.p4b.versions);
  assert.equal(
    (await core.workspace.read({ resource: 'map', key: manifest.projectId })).value.nodes.length,
    manifest.p4b.mapNodes,
  );
  return manifest;
}

/** No models are assembled; the only writes target this explicitly selected fixture profile. */
export async function seedP4b({ dataRoot, seed = 'p4a-20261027', tiny = false }) {
  const root = path.resolve(dataRoot);
  const file = path.join(root, 'perf-p4b-manifest.json');
  let previous;
  try {
    previous = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous) {
    assert.equal(previous.seed, seed);
    assert.equal(previous.profile, tiny ? 'tiny' : 'full');
  }
  const manifest = previous ?? structuredClone(await seedFixture({ dataRoot: root, seed, tiny }));
  const core = await createCore({ dataRoot: root });
  const versions = createVersions(core);
  const research = createResearch(core);
  const knowledge = createKnowledgeStore(core);
  const save = () => writeFile(file, JSON.stringify(manifest, null, 2));
  try {
    if (manifest.p4b?.phase === 'complete') return await verify(core, versions, manifest);
    manifest.p4b ??= { phase: 'building', versions: tiny ? 4 : 30, mapNodes: tiny ? 20 : 200 };
    await save();
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { features: { editingDesk: true } } },
    });
    const original = await readFile(path.join(manifest.projectFolder, manifest.docx));
    let listed = versions
      .list(manifest.projectId)
      .find((entry) => entry.id === manifest.versionGroupId).versions;
    for (let number = 3; number <= manifest.p4b.versions; number++) {
      let version = listed.find((entry) => entry.title === `P4b 合成版本 ${number}`);
      if (!version)
        version = await versions.createVersion(
          {
            groupId: manifest.versionGroupId,
            parentId:
              number === 3
                ? manifest.compareVersionIds[1]
                : listed.find((entry) => entry.number === number - 1).id,
            name: path.basename(manifest.docx),
            bytes: await versionBytes(original, number),
            origin: 'desk',
            title: `P4b 合成版本 ${number}`,
          },
          { actorId: 'person_user' },
        );
      listed = versions
        .list(manifest.projectId)
        .find((entry) => entry.id === manifest.versionGroupId).versions;
      console.log(JSON.stringify({ phase: 'p4b-versions', number }));
      await save();
    }
    for (const version of listed) {
      const key = `${manifest.projectId}/${version.id}`;
      const notes = await core.workspace.read({ resource: 'versions', key });
      await versions.editNotes(
        version.id,
        `# 第 ${version.number} 版合成说明\n\n核查城市韧性证据、案例范围和阈值。版本 ${version.number} 为可重复的性能夹具；没有模型请求。\n`,
        notes.revisionId,
      );
    }
    await versions.diffIdle();
    await core.workspace.edit({
      resource: 'map',
      key: manifest.projectId,
      op: 'write',
      args: { map: fixtureMap(manifest.p4b.mapNodes) },
    });
    manifest.p4b.planCount = tiny ? 3 : 12;
    manifest.p4b.logCount = tiny ? 3 : 20;
    const plans = Array.from(
      { length: manifest.p4b.planCount },
      (_, i) => `- [ ] P4b 合成计划 ${i + 1}\n  核对案例口径与证据 ${i + 1}。\n  due: 2026-11-02\n`,
    ).join('');
    const log = Array.from(
      { length: manifest.p4b.logCount },
      (_, i) =>
        `\n## 2026-10-${String(1 + i).padStart(2, '0')} P4b 合成日志 ${i + 1}\n\n核对第 ${i + 1} 组案例和原文，记录证据来源与下一步。\n`,
    ).join('');
    await core.workspace.edit({
      resource: 'plans',
      key: manifest.projectId,
      op: 'write',
      args: { text: plans },
    });
    await core.workspace.edit({
      resource: 'log',
      key: manifest.projectId,
      op: 'write',
      args: { text: log },
    });
    const message = core.messages.get(manifest.lastMessageId);
    const turnId = message.turnId;
    const sourceId = manifest.files[0].sourceId;
    const callId = 'p4b-local-read';
    if (!core.turns.toolCalls(turnId).some((entry) => entry.callId === callId)) {
      core.turns.startToolCall({
        turnId,
        callId,
        name: 'research_read',
        args: { id: sourceId },
        preamble: 'P4b 合成历史：真实读取本地资料，无模型调用。',
      });
      core.turns.endToolCall(turnId, callId, {
        result: await research.read({ id: sourceId }),
        isError: false,
      });
    }
    if (!knowledge.versions.list({ turnId }).rows.length) {
      const actor = {
        actorId: 'agent_main',
        projectId: manifest.projectId,
        meetingId: manifest.longestMeetingId,
        turnId,
      };
      const entity = knowledge.createEntity(
        { kind: 'concept', name: 'P4b 合成城市韧性', description: '原始合成资料对应的性能夹具。' },
        actor,
      );
      const chunk = research.store.chunks(sourceId)[0];
      knowledge.createEdge(
        {
          fromRef: `source:${sourceId}`,
          toRef: `entity:${entity.id}`,
          relation: 'discusses',
          evidence: [
            { ref: `chunk:${chunk.id}`, quote: chunk.text.slice(0, 80), page: chunk.page },
          ],
        },
        actor,
      );
      manifest.p4b.knowledgeVersionId = knowledge.closeTurn(turnId).id;
    }
    Object.assign(manifest.p4b, {
      evidenceMeetingId: manifest.longestMeetingId,
      evidenceMessageId: message.id,
      dragNodeId: `p4b-node-${manifest.p4b.mapNodes - 1}`,
      toolCallsAdded: 1,
    });
    manifest.p4b.phase = 'complete';
    await verify(core, versions, manifest);
    await save();
    console.log(
      JSON.stringify({ phase: 'p4b-complete', counts: manifest.counts, p4b: manifest.p4b }),
    );
    return manifest;
  } finally {
    await versions.close();
    core.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  assert.ok(args.includes('--data'), '--data required');
  seedP4b({
    dataRoot: args[args.indexOf('--data') + 1],
    tiny: args.includes('--tiny'),
    ...(args.includes('--seed') ? { seed: args[args.indexOf('--seed') + 1] } : {}),
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
