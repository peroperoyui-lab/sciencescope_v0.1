// Persistent synthetic files permit exact before/after HTTP comparison on the same fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function seed(core, versions) {
  const project = await core.projects.create({ name: 'Synthetic version graph benchmark' });
  const imported = await versions.importFiles({
    projectId: project.id,
    groupName: 'Thirty synthetic manuscript versions',
    files: Array.from({ length: 30 }, (_, index) => ({
      name: `manuscript-${index + 1}.md`,
      base64: Buffer.from(
        `# Synthetic version ${index + 1}\n\n${'Synthetic manuscript evidence. '.repeat(50)}\n`,
      ).toString('base64'),
    })),
  });
  const nodes = [];
  for (const [index, version] of imported.versions.entries()) {
    const title = `Synthetic version ${index + 1}`;
    const label = `label-${index + 1}`;
    const tier = index < 15 ? '草稿' : '投稿';
    const description = `Synthetic metadata description ${index + 1}`;
    const key = index % 7 === 0;
    await versions.updateMetadata(version.id, { title, label, tier, description, key });
    const notes = `# Synthetic notes ${index + 1}\n\n${`Evidence, scope and comparison for version ${index + 1}. `.repeat(24)}\n`;
    await versions.editNotes(version.id, notes, null);
    nodes.push({
      id: version.id,
      number: index + 1,
      title,
      label,
      tier,
      description,
      key,
      parentId: index ? imported.versions[index - 1].id : null,
      original: path.relative(core.paths.root, versions.file(version.id)),
      notes: path.relative(core.paths.root, versions.file(version.id) + '.notes.md'),
      notesExcerpt: Array.from(notes).slice(0, 200).join(''),
      instructions: Array.from({ length: 10 }, (_, item) => `Instruction ${index + 1}-${item}`),
    });
  }
  core.db.transaction(() => {
    const session = core.db.prepare(
      'INSERT INTO desk_sessions(id,group_id,base_version_id,created_at) VALUES(?,?,?,?)',
    );
    const instruction = core.db.prepare(`INSERT INTO desk_changes
      (id,session_id,version_id,seq,block_id,op,instruction,created_at)
      VALUES(?,?,?,?,'paragraph','edit',?,'2026-01-01T00:00:00Z')`);
    for (const node of nodes) {
      const sessionId = `synthetic-graph-session-${node.number}`;
      session.run(sessionId, imported.group.id, node.id, '2026-01-01T00:00:00Z');
      instruction.run(
        `${sessionId}-duplicate`,
        sessionId,
        node.id,
        12,
        `Instruction ${node.number}-0`,
      );
      instruction.run(`${sessionId}-blank`, sessionId, node.id, 13, '  ');
      for (let index = 0; index < 12; index++)
        instruction.run(
          `${sessionId}-${index}`,
          sessionId,
          node.id,
          index,
          `Instruction ${node.number}-${index}`,
        );
    }
  });
  await versions.diffIdle();
  return { schema: 1, projectId: project.id, groupId: imported.group.id, nodes };
}

async function snapshot(core, manifest) {
  const files = [];
  for (const node of manifest.nodes) {
    for (const kind of ['original', 'notes']) {
      const bytes = await fs.readFile(path.join(core.paths.root, node[kind]));
      files.push({ versionId: node.id, kind, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
  return JSON.parse(
    JSON.stringify({
      files,
      group: core.db.prepare('SELECT * FROM version_groups WHERE id=?').get(manifest.groupId),
      versions: core.db
        .prepare('SELECT * FROM manuscript_versions WHERE group_id=? ORDER BY number')
        .all(manifest.groupId),
      instructions: core.db
        .prepare(
          'SELECT c.* FROM desk_changes c JOIN manuscript_versions v ON v.id=c.version_id WHERE v.group_id=? ORDER BY c.rowid',
        )
        .all(manifest.groupId),
      revisions: core.db
        .prepare(
          "SELECT * FROM revisions WHERE resource='versions' AND resource_key LIKE ? ORDER BY rowid",
        )
        .all(`versions:${manifest.projectId}/%`),
    }),
  );
}

function validate(value, manifest) {
  assert.equal(value.group.id, manifest.groupId);
  assert.equal(value.group.projectId, manifest.projectId);
  assert.equal(value.nodes.length, 30);
  for (const [index, expected] of manifest.nodes.entries()) {
    const node = value.nodes[index];
    for (const key of [
      'id',
      'number',
      'parentId',
      'title',
      'label',
      'tier',
      'description',
      'key',
      'notesExcerpt',
      'instructions',
    ])
      assert.deepEqual(node[key], expected[key], `Version ${index + 1}: ${key}`);
    assert.equal(node.displayTitle, expected.title);
  }
}

async function sample(core, route, manifest) {
  const prepare = core.db.prepare;
  const readFile = fs.readFile;
  const notesFiles = new Set(
    manifest.nodes.map((node) => path.resolve(core.paths.root, node.notes)),
  );
  const sql = {
    total: 0,
    versionMetadata: 0,
    projectDirectory: 0,
    revisions: 0,
    instructions: 0,
    other: 0,
  };
  const notes = { reads: 0, bytes: 0, active: 0, maxConcurrent: 0 };
  core.db.prepare = (statement) => {
    sql.total++;
    if (/\bdesk_changes\b/u.test(statement)) sql.instructions++;
    else if (/\b(?:manuscript_versions|version_groups)\b/u.test(statement)) sql.versionMetadata++;
    else if (/\bprojects\b/u.test(statement)) sql.projectDirectory++;
    else if (/\brevisions\b/u.test(statement)) sql.revisions++;
    else sql.other++;
    return prepare(statement);
  };
  // Keep the actual filesystem and workspace revision semantics; only count calls.
  fs.readFile = async function (file, ...args) {
    const isNotes = typeof file === 'string' && notesFiles.has(path.resolve(file));
    if (!isNotes) return readFile(file, ...args);
    notes.reads++;
    notes.active++;
    notes.maxConcurrent = Math.max(notes.maxConcurrent, notes.active);
    try {
      const value = await readFile(file, ...args);
      notes.bytes += typeof value === 'string' ? Buffer.byteLength(value) : value.length;
      return value;
    } finally {
      notes.active--;
    }
  };
  syncBuiltinESMExports();
  const started = performance.now();
  try {
    const response = await fetch(route, {
      headers: { authorization: 'Bearer synthetic-version-graph' },
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    const wallMs = performance.now() - started;
    assert.equal(response.status, 200, bytes.toString());
    const value = JSON.parse(bytes.toString());
    validate(value, manifest);
    assert.equal(notes.reads, 30);
    assert.equal(notes.active, 0);
    return {
      wallMs,
      requests: 1,
      responseBodyBytes: bytes.length,
      responseSha256: hash(bytes),
      sql,
      notes: { reads: notes.reads, bytes: notes.bytes, maxConcurrent: notes.maxConcurrent },
      value,
    };
  } finally {
    core.db.prepare = prepare;
    fs.readFile = readFile;
    syncBuiltinESMExports();
  }
}

async function measure({ sourceRoot, dataRoot, phase, baseline }) {
  const load = (file) => import(pathToFileURL(path.resolve(sourceRoot, file)).href);
  const [{ createCore }, { createVersions }, { createAppServer }] = await Promise.all([
    load('app/core/index.js'),
    load('app/services/versions/index.js'),
    load('app/server/server.js'),
  ]);
  const core = await createCore({ dataRoot });
  const versions = createVersions(core, {
    diffs: { compute: async () => ({ diff: { status: 'originals-only' } }) },
  });
  let server;
  try {
    const manifestFile = path.join(dataRoot, 'perf-version-graph.json');
    let manifest;
    if (baseline) {
      manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
      assert.deepEqual(await snapshot(core, manifest), baseline.inputSnapshot);
    } else {
      assert.equal(phase, 'before', 'After runs require --baseline and the same --data fixture.');
      manifest = await seed(core, versions);
      await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    }
    const inputSnapshot = await snapshot(core, manifest);
    server = createAppServer({ core, versions, token: 'synthetic-version-graph' });
    const url = await server.listen();
    const route = `${url}/api/version-groups/${manifest.groupId}/graph`;
    const first = await sample(core, route, manifest);
    const expectedFile = path.join(dataRoot, 'expected-graph-response.json');
    if (baseline) {
      const expected = JSON.parse(await fs.readFile(expectedFile, 'utf8'));
      assert.deepEqual(first.value, expected);
      assert.equal(first.responseSha256, baseline.firstCall.responseSha256);
    } else await fs.writeFile(expectedFile, JSON.stringify(first.value, null, 2), { flag: 'wx' });
    await sample(core, route, manifest);
    const measured = [];
    for (let index = 0; index < 3; index++) {
      const result = await sample(core, route, manifest);
      assert.deepEqual(result.value, first.value);
      assert.equal(result.responseSha256, first.responseSha256);
      const { value, ...receipt } = result;
      measured.push(receipt);
    }
    assert.deepEqual(await snapshot(core, manifest), inputSnapshot);
    const { value, ...firstCall } = first;
    return {
      schema: 1,
      kind: 'version-graph-http',
      phase,
      generatedAt: new Date().toISOString(),
      node: process.version,
      fixtureDirectory: path.relative(process.cwd(), dataRoot),
      fixture: {
        versions: 30,
        notesFiles: 30,
        instructionRows: 420,
        returnedInstructions: 300,
        notesBytes: inputSnapshot.files
          .filter((file) => file.kind === 'notes')
          .reduce((total, file) => total + file.bytes, 0),
        description:
          'Thirty small Markdown originals with real note files and workspace revisions; synthetic completed diff computation outside timing.',
      },
      protocol: {
        firstCall:
          'First graph request in this process, reported separately; OS filesystem caches are not cleared.',
        warmups: 1,
        measuredRuns: 3,
        instrumentation:
          'SQL prepare calls; actual fs.promises.readFile operations on the thirty known notes paths, delegated to the real filesystem and restored after each request.',
        sqlCategories:
          'Disjoint categories: desk_changes; manuscript_versions/version_groups (including workspace note-path lookup); projects; revisions; other.',
        parity: baseline
          ? 'Exact full JSON and response-byte hash match on the same preserved fixture.'
          : 'Every response matches all thirty known nodes and the full first response.',
        excludes: [
          'fixture creation',
          'diff computation',
          'UI',
          'document parsing',
          'models',
          'agent runtime',
        ],
      },
      firstCall,
      measured: {
        wallMsMedian: median(measured.map((entry) => entry.wallMs)),
        responseBodyBytes: measured[0].responseBodyBytes,
        sql: measured[0].sql,
        notes: measured[0].notes,
        samples: measured,
      },
      unchangedInputs: true,
      inputSnapshot,
    };
  } finally {
    if (server) await server.close();
    await versions.close();
    core.close();
  }
}

const { values } = parseArgs({
  options: {
    source: { type: 'string' },
    out: { type: 'string' },
    data: { type: 'string' },
    phase: { type: 'string', default: 'before' },
    baseline: { type: 'string' },
  },
});
if (!values.out || !['before', 'after'].includes(values.phase))
  throw new Error(
    'Use --phase before|after --out <ignored receipt.json> [--data existing-fixture --baseline before.json] [--source checkout].',
  );
const allowed = path.resolve('.sciencescope-local/temp/p4c/part4');
const output = path.resolve(values.out);
if (!output.startsWith(allowed + path.sep))
  throw new Error('Receipts belong under .sciencescope-local/temp/p4c/part4.');
if (values.phase === 'after' && (!values.data || !values.baseline))
  throw new Error('After runs reuse --data from the before receipt and require --baseline.');
if (values.data && !values.baseline)
  throw new Error('Reusing --data requires --baseline so the preserved fixture is only read.');
await fs.mkdir(path.dirname(output), { recursive: true });
const handle = await fs.open(output, 'wx');
try {
  const dataRoot = values.data
    ? path.resolve(values.data)
    : await fs.mkdtemp(path.join(allowed, 'graph-fixture-'));
  if (!dataRoot.startsWith(allowed + path.sep))
    throw new Error('Fixtures belong under .sciencescope-local/temp/p4c/part4.');
  const baseline = values.baseline ? JSON.parse(await fs.readFile(values.baseline, 'utf8')) : null;
  const result = await measure({
    sourceRoot: values.source ?? fileURLToPath(new URL('../../', import.meta.url)),
    dataRoot,
    phase: values.phase,
    baseline,
  });
  await handle.writeFile(JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      ...result,
      inputSnapshot: undefined,
      measured: { ...result.measured, samples: undefined },
    }),
  );
} catch (error) {
  await handle.writeFile(
    JSON.stringify(
      { phase: values.phase, failed: true, node: process.version, error: error.stack },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await handle.close();
}
