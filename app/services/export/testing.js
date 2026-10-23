import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createCore } from '../../core/index.js';
import { createResearch } from '../research/index.js';
import { createProjectFiles } from '../project-files.js';
import { createProjectIndex } from '../knowledge/project-index.js';
import { createKnowledgeStore } from '../knowledge/store.js';
import { createVersionStorage } from '../versions/storage.js';
import { createMcpConfig } from '../mcp/config.js';
import { saveKey } from '../providers.js';
import { imageAttachments } from '../research-input/images.js';

/** @param {(fixture:any)=>Promise<void>} work */
export async function withExportFixture(work) {
  const base = fileURLToPath(new URL('../../../.sciencescope-local/temp/r5/', import.meta.url));
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(path.join(base, 'export-'));
  const relative = path.relative(base, dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('Invalid export fixture cleanup path.');
  const dataRoot = path.join(dir, 'data');
  const target = path.join(dir, 'target');
  const external = path.join(dir, 'external');
  await mkdir(target);
  await mkdir(external);
  const core = await createCore({ dataRoot });
  try {
    await work({ core, dir, target, external });
  } finally {
    core.close();
    await rm(dir, { recursive: true, force: true });
  }
}

/** @param {string} folder @returns {Promise<string[]>} */
export async function filesIn(folder) {
  const files = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

/** @param {any} core @param {string} type @param {(event:any)=>boolean} [predicate] */
export function exportEvent(core, type, predicate = () => true) {
  let unsubscribe;
  let timer;
  const promise = new Promise((resolve, reject) => {
    unsubscribe = core.events.subscribe((event) => {
      if (event.type !== type || !predicate(event)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(event.payload);
    });
    timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Missing ${type} event.`));
    }, 30_000);
  });
  void promise.catch(() => {});
  return {
    promise,
    cancel() {
      clearTimeout(timer);
      unsubscribe();
    },
  };
}

/** @param {any} fixture */
export async function populateExportFixture({ core, external }) {
  const internal = await core.projects.create({ name: '内部项目' });
  const outside = await core.projects.create({ name: '外部项目', folder: external });
  await writeFile(path.join(external, 'external-only.txt'), 'Original external research bytes.');
  await writeFile(
    path.join(core.paths.projects, internal.dirName, 'internal-only.txt'),
    'Internal project bytes.',
  );
  const research = createResearch(core);
  const index = createProjectIndex({ core, research, files: createProjectFiles(core) });
  try {
    await index.scanAndWait(outside.id);
  } finally {
    await index.close();
  }
  const projectSource = research.store.listSources({ projectId: outside.id })[0];
  const longOriginalName = `${'原始研究'.repeat(12)}${'original-'.repeat(6)}.txt`;
  const globalSource = await research.importSource({
    name: longOriginalName,
    bytes: Buffer.from('Global source original passage.'),
    kind: 'paper',
  });
  const expert = await core.participants.create({
    kind: 'ai',
    name: '合成专家',
    definition: {
      prompt: 'Synthetic expert instructions.',
      model: { provider: 'fixture', model: 'test-model' },
      skills: ['fixture-skill'],
      tools: { prefer: ['research_read'], avoid: [] },
    },
  });
  const imageBytes = Buffer.from('Synthetic original PNG attachment bytes.');
  const image = await imageAttachments(core).save(`${'image-'.repeat(16)}.png`, imageBytes);
  const meeting = core.meetings.create({
    title: '完整对话标题'.repeat(18),
    projectId: internal.id,
    members: [{ participantId: expert.id }],
  });
  const message = core.messages.post({
    meetingId: meeting.id,
    authorId: 'person_user',
    text: 'Question with evidence.',
    refs: { material: globalSource.id, marked: true },
    researchInput: {
      materials: [{ sourceId: globalSource.id }, image],
      marks: [{ text: 'Marked passage' }],
    },
  });
  const turn = core.turns.start({
    meetingId: meeting.id,
    participantId: expert.id,
    triggerMessageId: message.id,
  });
  core.turns.startToolCall({
    turnId: turn.id,
    callId: 'fixture-call',
    name: 'research_read',
    args: { id: globalSource.id },
    preamble: 'Read source.',
  });
  core.turns.endToolCall(turn.id, 'fixture-call', {
    result: { text: 'Tool result summary' },
    isError: false,
  });
  core.messages.post({
    meetingId: meeting.id,
    authorId: expert.id,
    turnId: turn.id,
    text: 'Full expert response.',
  });
  core.turns.end(turn.id, { status: 'done' });
  const branch = core.meetings.fork(meeting.id, { atMessageId: message.id, title: '归档分支' });
  core.meetings.update(branch.id, { archived: true });
  const standalone = core.meetings.create({ title: '全局对话' });
  core.messages.post({
    meetingId: standalone.id,
    authorId: 'person_user',
    text: 'Standalone question.',
  });
  for (const [resource, key, args] of [
    ['plans', internal.id, { text: '# Research plan' }],
    ['log', internal.id, { text: '# Research log' }],
    ['minutes', meeting.id, { text: '# Meeting minutes' }],
    ['notes', `${internal.id}/研究笔记`, { text: '# Research note' }],
    ['plans', 'global', { text: '# Global plan' }],
  ])
    await core.workspace.edit({ resource, key, op: 'write', args });
  await core.workspace.edit({
    resource: 'map',
    key: internal.id,
    op: 'write',
    args: {
      map: {
        nodes: [
          { id: 'root', parent: null, text: 'Research question' },
          { id: 'child', parent: 'root', text: 'Study design' },
        ],
        edges: [],
      },
    },
  });
  const versions = createVersionStorage(core, (work) => work());
  const manuscript = await versions.importFiles({
    projectId: internal.id,
    groupName: '稿件',
    files: [
      { name: 'first.md', base64: Buffer.from('# First manuscript version.').toString('base64') },
      { name: 'second.md', base64: Buffer.from('# Second manuscript version.').toString('base64') },
    ],
  });
  await core.workspace.edit({
    resource: 'versions',
    key: `${internal.id}/${manuscript.versions[1].id}`,
    op: 'write',
    args: { text: '# Version explanation' },
  });
  const now = new Date().toISOString();
  core.db
    .prepare(
      `INSERT INTO manuscript_comments (id,group_id,version_id,block_id,block_from,block_to,quote_json,author_id,text,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'fixture-comment',
      manuscript.group.id,
      manuscript.versions[1].id,
      'block1',
      0,
      4,
      JSON.stringify({ exact: 'Second' }),
      'person_user',
      'Synthetic annotation',
      now,
      now,
    );
  core.db
    .prepare(
      `INSERT INTO manuscript_bindings (id,group_id,version_id,block_id,block_from,block_to,quote_json,kind,attributed_to,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      'fixture-binding',
      manuscript.group.id,
      manuscript.versions[1].id,
      'block1',
      0,
      4,
      JSON.stringify({ exact: 'Second' }),
      'claim',
      'person_user',
      now,
      now,
    );
  const knowledge = createKnowledgeStore(core);
  const entity = knowledge.createEntity({ name: 'Synthetic method', kind: 'method' });
  knowledge.createEdge({
    fromRef: `source:${globalSource.id}`,
    toRef: `entity:${entity.id}`,
    relation: 'uses',
    evidence: [{ sourceId: globalSource.id, quote: 'original passage' }],
  });
  research.store.createItem({
    title: 'Expert memory',
    type: 'memory',
    subtype: 'preference',
    scope: `expert:${expert.id}`,
    body: 'Preserved expert memory.',
  });
  research.store.createItem({
    title: 'Synthetic paper card',
    type: 'note',
    subtype: 'summary',
    body: 'Readable card summary.',
    payload: {
      card: { question: 'Synthetic question', findings: ['Synthetic finding'] },
      cardSource: `source:${globalSource.id}`,
    },
  });
  const fakeProviderKey = 'FAKE_R5_PROVIDER_KEY_41d391';
  const fakeMcpKey = 'FAKE_R5_MCP_KEY_ba196c';
  await saveKey(core.paths, 'provider-fixture', fakeProviderKey);
  await core.workspace.edit({
    resource: 'settings',
    key: 'app',
    op: 'patch',
    args: {
      changes: {
        providers: [
          {
            id: 'fixture',
            name: 'Fixture provider',
            baseUrl: 'https://example.invalid',
            api: 'openai-completions',
            keyRef: 'provider-fixture',
            models: [{ id: 'test-model' }],
          },
        ],
      },
    },
  });
  await createMcpConfig(core).save(
    {
      name: 'Fixture MCP',
      transport: 'http',
      url: 'https://example.invalid/mcp',
      headers: { Authorization: fakeMcpKey },
    },
    'fixture-mcp',
  );
  const oldHeader = 'FAKE_R5_HEADER_OLD_f428a9';
  const currentHeader = 'FAKE_R5_HEADER_CURRENT_b839df';
  const rawMcpHeader = 'FAKE_R5_MCP_HEADER_RAW_b18a22';
  const rawMcpEnv = 'FAKE_R5_MCP_ENV_RAW_39aacf';
  let current = JSON.parse(await readFile(core.paths.settings, 'utf8'));
  await core.workspace.edit({
    resource: 'settings',
    key: 'app',
    op: 'patch',
    args: {
      changes: { providers: [{ ...current.providers[0], headers: { 'X-Custom': oldHeader } }] },
    },
  });
  await core.workspace.captureSnapshot({ resource: 'settings', key: 'app' });
  current = JSON.parse(await readFile(core.paths.settings, 'utf8'));
  await core.workspace.edit({
    resource: 'settings',
    key: 'app',
    op: 'patch',
    args: {
      changes: {
        providers: [
          {
            ...current.providers[0],
            headers: { 'X-Custom': currentHeader, 'User-Agent': 'Fixture public header value' },
          },
        ],
      },
    },
  });
  await core.workspace.captureSnapshot({ resource: 'settings', key: 'app' });
  current = JSON.parse(await readFile(core.paths.settings, 'utf8'));
  // Older/imported public configuration may still contain plaintext MCP fields.
  current.mcp.servers.push({
    id: 'raw-mcp',
    transport: 'http',
    url: 'https://example.invalid/raw',
    headers: { 'X-Raw': rawMcpHeader },
    env: { RAW_TOKEN: rawMcpEnv, REFERENCED: { keyRef: 'mcp-reference-name' } },
  });
  await writeFile(core.paths.settings, JSON.stringify(current, null, 2));
  await core.workspace.read({ resource: 'settings', key: 'app' });
  core.events.record('fixture.provider.history', {
    copyOfOldHeader: oldHeader,
    copyOfCurrentHeader: currentHeader,
    nestedJson: JSON.stringify({
      saved: oldHeader,
      mcp: {
        servers: [
          { transport: 'http', headers: { 'X-Old': rawMcpHeader }, env: { token: rawMcpEnv } },
        ],
      },
    }),
  });
  await mkdir(path.join(core.paths.skills, 'fixture-skill'), { recursive: true });
  await writeFile(
    path.join(core.paths.skills, 'fixture-skill', 'SKILL.md'),
    '---\nname: fixture-skill\ndescription: Synthetic fixture\n---\n\nSkill instructions.\n',
  );
  for (const excluded of [
    core.paths.logs,
    core.paths.runtime,
    core.paths.backups,
    core.paths.models,
    core.paths.python,
  ]) {
    await mkdir(excluded, { recursive: true });
    await writeFile(path.join(excluded, 'not-exported.txt'), 'FAKE_R5_EXCLUDED_PRIVATE_CONTENT');
  }
  core.db
    .prepare('INSERT INTO python_environments(id,name,version,status,updated_at) VALUES(?,?,?,?,?)')
    .run('env-fixture', 'Research Python', '3.12', 'ready', now);
  core.db
    .prepare('INSERT INTO python_bindings(scope,target_id,environment_id) VALUES(?,?,?)')
    .run('project', internal.id, 'env-fixture');
  return {
    internal,
    outside,
    projectSource,
    globalSource,
    longOriginalName,
    image,
    imageBytes,
    expert,
    meeting,
    branch,
    manuscript,
    fakeProviderKey,
    fakeMcpKey,
    oldHeader,
    currentHeader,
    rawMcpHeader,
    rawMcpEnv,
  };
}
