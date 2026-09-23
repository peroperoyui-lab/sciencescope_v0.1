import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVersionOrganizer } from '../scripts/version-organizer.mjs';

async function fixture() {
  await mkdir(path.resolve('.sciencescope-local/temp'), { recursive: true });
  const root = await mkdtemp(path.resolve('.sciencescope-local/temp/version-organizer-'));
  const original = path.join(root, 'paper.txt');
  await writeFile(original, 'new result', 'utf8');
  const version = { id: 'v2', name: 'paper.txt', group: 'paper', number: 2, relativePath: 'paper.txt', status: 'stored' };
  const state = { versions: [version] };
  return {
    root, version, state,
    store: {
      async get() { return structuredClone(state); },
      async resolvePath(_project, relative) { return path.resolve(root, relative); },
      async updateVersion(_project, id, patch) { Object.assign(version, patch); return structuredClone(version); },
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('version organizer uses independent no-tools session and writes a real note', async () => {
    const f = await fixture();
    const calls = [];
    const host = {
      async startSession(options) { calls.push(['start', options]); return 'secretary-session'; },
      async send(options) { calls.push(['send', options]); return { finalResponse: '# Changes\nAdded result.' }; },
      async releaseSession(id) { calls.push(['release', id]); },
    };
    const organizer = createVersionOrganizer({ host, store: f.store, getProject: async () => ({ goal: 'study' }) });
    const result = await organizer.organize({ projectId: 'p', versionId: 'v2', model: { providerId: 'openai', modelId: 'gpt-test' } });
    assert.deepStrictEqual(calls[0][1].model, { providerId: 'openai', modelId: 'gpt-test' }); assert.equal(calls[0][1].noTools, true);
    assert.match(calls[1][1].text, /不要替用户决定研究方向/); assert.match(await readFile(path.join(f.root, 'paper.txt.notes.md'), 'utf8'), /Added result/); assert.equal(result.status, 'organized'); await f.cleanup();
});

test('includes the persisted secretary template in the actual host prompt', async () => {
    const f = await fixture();
    const customTemplate = '# Custom notes\nResearch impact';
    let sentText = '';
    const host = {
      async startSession() { return 'secretary-session'; },
      async send(options) { sentText = options.text; return { finalResponse: 'ok' }; },
      async releaseSession() {},
    };
    const organizer = createVersionOrganizer({ host, store: f.store, getPreferences: async () => ({ notesTemplate: customTemplate }) });
    await organizer.organize({ projectId: 'p', versionId: 'v2', model: { providerId: 'x', modelId: 'y' } });
    assert.match(sentText, /# Custom notes/);
    assert.match(sentText, /Research impact/);
    await f.cleanup();
});

test('marks unsupported files without starting a model session', async () => {
    const f = await fixture(); f.version.name = 'paper.pdf'; f.version.relativePath = 'paper.pdf';
    await writeFile(path.join(f.root, 'paper.pdf'), 'binary-ish', 'utf8');
    let started = false;
    const organizer = createVersionOrganizer({ host: { startSession: async () => { started = true; } }, store: f.store });
    const result = await organizer.organize({ projectId: 'p', versionId: 'v2', model: { providerId: 'x', modelId: 'y' } });
    assert.equal(started, false); assert.equal(result.status, 'unsupported'); await f.cleanup();
});

test('protects duplicate calls for one version', async () => {
    const f = await fixture(); let sends = 0; let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const host = { async startSession() { return 's'; }, async send() { sends++; await gate; return { finalResponse: 'ok' }; }, async releaseSession() {} };
    const organizer = createVersionOrganizer({ host, store: f.store });
    const one = organizer.organize({ projectId: 'p', versionId: 'v2', model: { providerId: 'x', modelId: 'y' } });
    const two = organizer.organize({ projectId: 'p', versionId: 'v2', model: { providerId: 'x', modelId: 'y' } });
    assert.equal(one, two); release(); await Promise.all([one, two]); assert.equal(sends, 1); await f.cleanup();
});
