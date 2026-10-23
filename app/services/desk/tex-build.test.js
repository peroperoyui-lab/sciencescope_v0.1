import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../../testing.js';
import { createVersions } from '../versions/index.js';
import { createProjectFiles } from '../project-files.js';
import { createDesk } from './index.js';
import { createTexEngines } from './tex-engines.js';
import { createAppServer } from '../../server/server.js';
import { fakeTex } from './tex-fixture.js';

async function setup(core, dir, names, config = {}, timeoutMs = 120000) {
  const folder = path.join(dir, '项目 中文');
  await mkdir(path.join(folder, 'chapters'), { recursive: true });
  await writeFile(
    path.join(folder, 'main.tex'),
    '\\documentclass{article}\n\\include{chapters/one}\n',
  );
  await writeFile(path.join(folder, 'chapters/one.tex'), 'Saved project text');
  const project = await core.projects.create({ name: '编译', folder });
  const fake = await fakeTex(path.join(dir, 'fake tex'), names, config);
  const engines = createTexEngines({ env: fake.env, miktexDirs: [], texliveRoots: [] });
  const versions = createVersions(core);
  const desk = createDesk(core, {
    versions,
    projectFiles: createProjectFiles(core),
    texOptions: { engines, env: fake.env, timeoutMs },
  });
  const group = await desk.registerDocument({ projectId: project.id, path: 'chapters/one.tex' });
  const { session } = await desk.openSession({ groupId: group.id });
  return { desk, versions, folder, project, fake, session, engines };
}

test('TeX HTTP compile uses saved files, bibliography passes, busy response and retained PDF; close removes outputs', () =>
  withCore('tex-http', async (core, dir) => {
    const { desk, versions, folder, fake, session } = await setup(
      core,
      dir,
      ['pdflatex', 'bibtex'],
      { bibliography: 'bibtex' },
    );
    const events = [];
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'desk.compiled') events.push(event.payload);
    });
    const server = createAppServer({ core, versions, desk, token: 'tex-test' });
    const url = await server.listen();
    const request = (route, method = 'GET', body) =>
      fetch(url + '/api/desk/' + route, {
        method,
        headers: { authorization: 'Bearer tex-test', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    try {
      assert.equal((await request(`sessions/${session.id}/pdf`)).status, 404);
      assert.equal(
        (await (await request('tex/engines?refresh=1')).json()).engines[0].id,
        'pdflatex',
      );
      await desk.updateText(session.id, { baseSeq: 0, text: 'UNSAVED text' });
      const before = await readdir(folder, { recursive: true });
      const pending = desk.compile(session.id);
      const busy = await request(`sessions/${session.id}/compile`, 'POST', {});
      assert.equal(busy.status, 409);
      assert.equal((await busy.json()).code, 'DESK_TEX_BUSY');
      const result = await pending;
      assert.equal(result.status, 'ok', result.logTail);
      assert.equal(result.engine, 'pdflatex');
      assert.equal(result.root, 'main.tex');
      assert.deepEqual(result.unsaved, ['chapters/one.tex']);
      const calls = (await readFile(fake.calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls.map((call) => call.name),
        ['pdflatex', 'bibtex', 'pdflatex', 'pdflatex'],
      );
      assert.ok(calls.every((call) => call.noInstall === 'no'));
      assert.ok(
        calls
          .filter((call) => call.name === 'pdflatex')
          .every(
            (call) =>
              call.cwd === folder &&
              call.args.includes('--disable-installer') &&
              call.args.includes('-no-shell-escape'),
          ),
      );
      const response = await request(`sessions/${session.id}/pdf`);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const pdf = Buffer.from(await response.arrayBuffer());
      assert.ok(!pdf.includes('UNSAVED'));
      await fake.set({ failure: true });
      const failed = await (await request(`sessions/${session.id}/compile`, 'POST', {})).json();
      assert.equal(failed.status, 'failed');
      assert.equal(failed.pdf, true);
      assert.equal(failed.errors[0].file, 'main.tex');
      assert.equal(failed.errors[0].line, 7);
      assert.deepEqual(await desk.compiledPdf(session.id), pdf);
      assert.deepEqual(await readdir(folder, { recursive: true }), before);
      assert.deepEqual(
        events.map((event) => event.status),
        ['ok', 'failed'],
      );
      await desk.closeSession(session.id);
      await assert.rejects(access(path.join(core.paths.root, 'temp/desk-build', session.id)), {
        code: 'ENOENT',
      });
    } finally {
      unsubscribe();
      await server.close();
      await desk.shutdown();
    }
  }));

test('latexmk is selected when installed; configured engine overrides magic and biber fallback stays in build directory', () =>
  withCore('tex-latexmk', async (core, dir) => {
    const { desk, fake, session, engines, folder } = await setup(core, dir, [
      'xelatex',
      'lualatex',
      'latexmk',
      'biber',
    ]);
    try {
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { desk: { tex: { engine: 'lualatex' } } } },
      });
      const result = await desk.compile(session.id);
      assert.equal(result.status, 'ok', result.logTail);
      const call = JSON.parse((await readFile(fake.calls, 'utf8')).trim());
      assert.equal(call.name, 'latexmk');
      assert.ok(call.args.includes('-norc'));
      assert.ok(call.args.includes('-pdflua'));
      assert.ok(
        call.args.some((arg) => arg.includes('$lualatex') && arg.includes('--disable-installer')),
        JSON.stringify(call.args),
      );
      // The next detector refresh observes latexmk removal without restarting the app.
      const { rm } = await import('node:fs/promises');
      await rm(fake.files.latexmk);
      await engines.get(true);
      await writeFile(fake.calls, '');
      await fake.set({ bibliography: 'biber' });
      const direct = await desk.compile(session.id);
      assert.equal(direct.status, 'ok', direct.logTail);
      const calls = (await readFile(fake.calls, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        calls.map((entry) => entry.name),
        ['lualatex', 'biber', 'lualatex', 'lualatex'],
      );
      assert.notEqual(calls[1].cwd, folder);
    } finally {
      await desk.shutdown();
    }
  }));

test('TeX timeout kills compiler descendants and startup cleans abandoned builds', () =>
  withCore('tex-timeout', async (core, dir) => {
    const childPid = path.join(dir, 'child-pid');
    const orphan = path.join(core.paths.root, 'temp/desk-build/closed-session');
    await mkdir(orphan, { recursive: true });
    const { desk, session } = await setup(core, dir, ['xelatex'], { hang: true, childPid }, 10000);
    try {
      await desk.texEngines();
      const result = await desk.compile(session.id);
      assert.equal(result.status, 'timeout', result.logTail);
      assert.equal(result.pdf, false);
      const pid = Number(await readFile(childPid, 'utf8'));
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      await assert.rejects(access(orphan), { code: 'ENOENT' });
    } finally {
      await desk.shutdown();
    }
  }));

test('TeX compilation explains missing engines and rejects non-TeX sessions', () =>
  withCore('tex-missing', async (core, dir) => {
    const { desk, session, folder, project } = await setup(core, dir, []);
    try {
      await assert.rejects(desk.compile(session.id), { code: 'DESK_TEX_MISSING' });
      await writeFile(path.join(folder, 'note.md'), '# Note');
      const group = await desk.registerDocument({ projectId: project.id, path: 'note.md' });
      const note = await desk.openSession({ groupId: group.id });
      assert.throws(() => desk.compile(note.session.id), { code: 'DESK_FORMAT' });
    } finally {
      await desk.shutdown();
    }
  }));
