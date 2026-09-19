import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadBaselineInstructions } from '@deepseek-ai/dsh-agent-instructions';
import { buildResearchContextPatch, createResearchContextPatch } from '../adapters/runtime-dsh/research-context.mjs';

test('research patch roots instruction discovery at the workspace and clears SDK persona', () => {
  const home = resolve('.');
  const workspace = join(home, '.sciencescope-local', 'projects', 'p1');
  const patch = buildResearchContextPatch({ home, workspace });
  assert.deepEqual(patch[0], {
    id: 'agent-instructions',
    config: {
      projectRootMarkers: [],
      dshHome: join(home, '.sciencescope-local', 'dsh', 'research-instruction-home'),
      maxBytes: 65536,
    },
  });
  assert.equal(patch[1].id, 'system-prompt');
  assert.equal(patch[1].config.personaSuffix, '');
  assert.match(patch[1].config.personaPrefix, /Main research coordinator/);
});

test('research patch materialization stays in local temp and is collision-safe', async () => {
  const tempRoot = resolve('.sciencescope-local', 'temp');
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, 'research-context-'));
  try {
    const result = await createResearchContextPatch({ home: root, workspace: join(root, 'project'), patchName: 'one.json' });
    assert.equal(result.patchPath, join(root, '.sciencescope-local', 'temp', 'research-context', 'one.json'));
    assert.deepEqual(JSON.parse(await readFile(result.patchPath, 'utf8')), buildResearchContextPatch({ home: root, workspace: join(root, 'project') }));
    await assert.rejects(() => createResearchContextPatch({ home: root, workspace: join(root, 'project'), patchName: 'one.json' }), /EEXIST/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('research discovery excludes ancestor instructions but retains workspace instructions', async () => {
  const tempRoot = resolve('.sciencescope-local', 'temp');
  await mkdir(tempRoot, { recursive: true });
  const root = await mkdtemp(join(tempRoot, 'research-instructions-'));
  const workspace = join(root, 'projects', 'p1');
  const instructionHome = join(root, 'isolated-home');
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'PARENT_SENTINEL');
    await writeFile(join(workspace, 'AGENTS.md'), 'WORKSPACE_SENTINEL');
    const rendered = await loadBaselineInstructions({
      cwd: workspace,
      dshHome: instructionHome,
      projectRootMarkers: [],
      maxBytes: 65536,
    });
    assert.ok(rendered);
    assert.match(rendered.text, /WORKSPACE_SENTINEL/);
    assert.doesNotMatch(rendered.text, /PARENT_SENTINEL/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
