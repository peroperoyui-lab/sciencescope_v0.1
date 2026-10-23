import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { withCore, tempDir } from '../../testing.js';
import { createCore } from '../../core/index.js';
import { createResearch } from '../research/index.js';
import { createResearchInput } from '../research-input/index.js';
import { createKnowledgeStore } from './store.js';
import { createProjectCopies } from './project-copies.js';
import { hasSourceEdits } from './project-index-edits.js';

const actor = { actorId: 'person_user', origin: 'user' };

/**
 * New filename rows are visible before copying or parsing starts.
 * @param {ReturnType<typeof createResearch>} research
 * @param {string} projectId
 * @param {string} name
 */
function queued(research, projectId, name) {
  return research.store.createSource({
    projectId,
    title: name,
    name,
    kind: 'file',
    folderPath: name,
    contentStatus: 'queued',
  });
}

test('queued sources preserve title and metadata edits, including edits restored to their original value', () =>
  withCore('index-source-edits', async (core) => {
    const project = await core.projects.create({ name: 'Edit checks' });
    const research = createResearch(core);
    const untouched = queued(research, project.id, 'untouched.md');
    assert.equal(hasSourceEdits(core, untouched), false);
    const source = queued(research, project.id, 'edited.md');
    research.store.updateSource(source.id, { title: 'User title' }, actor);
    assert.equal(hasSourceEdits(core, research.store.getSource(source.id), source), true);
    research.store.updateSource(source.id, { title: source.title }, actor);
    assert.equal(hasSourceEdits(core, research.store.getSource(source.id), source), true);
    const metadata = queued(research, project.id, 'metadata.md');
    research.store.updateSource(metadata.id, { metadata: { note: 'Keep me' } }, actor);
    assert.equal(hasSourceEdits(core, research.store.getSource(metadata.id)), true);
    // Ordinary scanning updates with no actor do not invent a user edit.
    research.store.updateSource(untouched.id, { fileSize: 12 });
    assert.equal(hasSourceEdits(core, research.store.getSource(untouched.id)), false);
  }));

test('queued labels and associations protect both live and removed relationships', () =>
  withCore('index-source-links', async (core) => {
    const project = await core.projects.create({ name: 'Reference checks' });
    const research = createResearch(core);
    const knowledge = createKnowledgeStore(core);
    const labeled = queued(research, project.id, 'labeled.md');
    knowledge.label(`source:${labeled.id}`, 'important', true, actor);
    assert.equal(hasSourceEdits(core, labeled), true);
    knowledge.label(`source:${labeled.id}`, 'important', false, actor);
    assert.equal(hasSourceEdits(core, labeled), true, 'reversible label history survives');
    const associated = queued(research, project.id, 'associated.md');
    const entity = knowledge.createEntity({ kind: 'method', name: 'Method' }, actor);
    const edge = knowledge.createEdge(
      { fromRef: `source:${associated.id}`, toRef: `entity:${entity.id}`, relation: 'supports' },
      actor,
    );
    assert.equal(hasSourceEdits(core, associated), true);
    knowledge.removeEdge(edge.id, actor);
    assert.equal(hasSourceEdits(core, associated), true);
    const member = queued(research, project.id, 'member.md');
    knowledge.membership(project.id, `source:${member.id}`, true, actor);
    assert.equal(hasSourceEdits(core, member), true);
  }));

test('annotation drafts and their removed marks remain protected after restart without a baseline', async () => {
  const { dir, cleanup } = await tempDir('index-source-mark-restart');
  let core = await createCore({ dataRoot: dir });
  try {
    const research = createResearch(core);
    const project = await core.projects.create({ name: 'Annotation references' });
    const marked = queued(research, project.id, 'marked.md');
    const untouched = queued(research, project.id, 'untouched.md');
    const input = createResearchInput({ core, research });
    input.change('repro-owner', {
      op: 'mark-add',
      mark: { sourceId: marked.id, text: 'Selected evidence', comment: 'User annotation' },
    });
    assert.equal(hasSourceEdits(core, marked), true);
    input.change('repro-owner', { op: 'marks-clear' });
    input.close();
    core.close();
    core = await createCore({ dataRoot: dir });
    const resumed = createResearch(core);
    assert.equal(hasSourceEdits(core, resumed.store.getSource(marked.id)), true);
    assert.equal(hasSourceEdits(core, resumed.store.getSource(untouched.id)), false);
  } finally {
    core.close();
    await cleanup();
  }
});

test('deleting a detached source keeps its shared project snapshot until explicit orphan cleanup', () =>
  withCore('index-detached-copy', async (core) => {
    const project = await core.projects.create({ name: 'Shared snapshot' });
    const recycled = [];
    const research = createResearch(core, {
      recycle: async (file) => {
        recycled.push(file);
      },
    });
    const originalPath = `project-files/${project.id}/${'a'.repeat(64)}`;
    const file = path.join(core.paths.library, originalPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'Shared original bytes');
    const old = research.store.createSource({
      projectId: project.id,
      title: 'Old evidence',
      name: 'old.md',
      originalPath,
      contentStatus: 'parsed',
    });
    const current = research.store.createSource({
      projectId: project.id,
      title: 'New evidence',
      name: 'new.md',
      originalPath,
      folderPath: 'new.md',
      contentStatus: 'parsed',
    });
    await research.deleteSource(old.id, actor);
    assert.deepEqual(recycled, []);
    assert.equal(await readFile(file, 'utf8'), 'Shared original bytes');
    const copies = createProjectCopies(core, research.store);
    assert.equal((await copies.cleanup(project.id)).removedFiles, 0);
    await research.deleteSource(current.id, actor);
    assert.deepEqual(recycled, []);
    assert.equal((await copies.cleanup(project.id)).removedFiles, 1);
  }));
