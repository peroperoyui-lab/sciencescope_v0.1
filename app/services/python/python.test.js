import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../../app.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { tempDir, withCore } from '../../testing.js';
import { createPython } from './index.js';
import { validatePackages } from './files.js';

import { fakeUv } from './testing.js';

test('stopping a model package-install tool aborts uv instead of leaving installation running', () =>
  withCore('python-tool-stop', async (core) => {
    const fake = fakeUv();
    let block = false;
    let active = false;
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const python = createPython(core, {
      runner: async (command, args, options) => {
        if (!block) return fake.runner(command, args, options);
        active = true;
        started();
        try {
          await new Promise((_, reject) =>
            options.signal.addEventListener('abort', () => reject(options.signal.reason), {
              once: true,
            }),
          );
        } finally {
          active = false;
        }
      },
    });
    try {
      const environment = await python.operate({
        action: 'create',
        name: 'Stop fixture',
        version: '3.14',
      });
      const controller = new AbortController();
      block = true;
      const installing = python.install(
        {
          meetingId: null,
          environmentId: environment.id,
          participantId: 'agent_main',
          signal: controller.signal,
        },
        { packages: ['example-package'], reason: 'Stop verification' },
      );
      const settled = assert.rejects(installing);
      await ready;
      const stoppedAt = performance.now();
      controller.abort();
      await settled;
      assert.equal(active, false);
      assert.ok(performance.now() - stoppedAt < 2000);
    } finally {
      await python.close();
    }
  }));

test('managed environments retain manifests, precedence, failure records and reset deleted bindings', async () => {
  const { dir, cleanup } = await tempDir('python-environments');
  const fake = fakeUv();
  let closed = false;
  const app = await createApp({
    dataRoot: dir,
    token: 'test',
    runtime: createScriptedRuntime({
      script: async function* () {
        yield 'ok';
      },
    }),
    pythonOptions: { runner: fake.runner },
  });
  try {
    const before = JSON.stringify(process.env);
    assert.deepEqual(validatePackages(['pandas>=2, <4', 'requests[socks]==2.32.0']), [
      'pandas>=2,<4',
      'requests[socks]==2.32.0',
    ]);
    assert.throws(() => validatePackages(['--index-url=elsewhere']), /格式/u);
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { python: { installMirror: 'https://example.test/python' } } },
    });
    const builtin = await app.python.operate({ action: 'builtin' });
    assert.equal(builtin.status, 'ready');
    const copy = await app.python.operate({ action: 'copy', id: builtin.id, name: '分析二' });
    assert.deepEqual(copy.lock, builtin.lock);
    assert.ok(fake.calls.every((call) => call.env.UV_NO_CONFIG === '1'));
    assert.equal(
      fake.calls.find((call) => call.args[0] === 'venv').env.UV_PYTHON_INSTALL_MIRROR,
      'https://example.test/python',
    );
    assert.ok(
      fake.calls
        .filter((call) => call.args[0] === '--version')
        .every((call) => !call.env.UV_PYTHON_INSTALL_MIRROR),
    );
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { python: { installMirror: null } } },
    });
    const project = await app.core.projects.create({ name: '中文项目' });
    const meeting = app.core.meetings.create({ projectId: project.id });
    assert.equal((await app.python.resolve(meeting.id)).id, 'system');
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { python: { defaultEnvironment: builtin.id } } },
    });
    assert.equal((await app.python.resolve(meeting.id)).id, builtin.id);
    app.python.bind('project', project.id, copy.id);
    assert.equal((await app.python.resolve(meeting.id)).id, copy.id);
    app.python.bind('meeting', meeting.id, 'system');
    const count = fake.calls.length;
    assert.deepEqual((await app.python.resolve(meeting.id)).env, {});
    assert.equal(fake.calls.length, count);
    app.python.bind('meeting', meeting.id, null);
    await app.python.packages(copy.id, 'add', ['tiny-package'], 'agent_main', 'Need formatting');
    assert.ok(app.python.get(copy.id).packages.includes('tiny-package'));
    const manifest = app.python.exportManifest(copy.id);
    await app.python.importManifest(copy.id, manifest);
    fake.setFail(true);
    await assert.rejects(app.python.packages(copy.id, 'add', ['missing-package']), /安装失败/u);
    assert.equal(app.python.operations()[0].status, 'failed');
    fake.setFail(false);
    await app.python.operate({ action: 'rename', id: copy.id, name: '重命名' });
    await app.python.operate({ action: 'remove', id: copy.id });
    assert.equal((await app.python.resolve(meeting.id)).id, builtin.id);
    const environment = await app.python.resolve(meeting.id);
    assert.ok(environment.env.PATH.startsWith(path.join(dir, 'python', 'envs', builtin.id)));
    assert.equal(environment.env.VIRTUAL_ENV, path.join(dir, 'python', 'envs', builtin.id));
    assert.ok(JSON.stringify(process.env) === before, 'host environment remains unchanged');
    const listing = app.python.list();
    await app.close();
    closed = true;
    assert.ok((await listing).environments.length > 0);
  } finally {
    if (!closed) await app.close();
    await cleanup();
  }
});

test('meeting environment changes on next turn while tool installation retains actor and card', async () => {
  const { dir, cleanup } = await tempDir('python-meeting');
  const fake = fakeUv();
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let first = true;
  const runtime = createScriptedRuntime({
    script: async function* ({ call }) {
      if (first) {
        first = false;
        await gate;
        await call('python_env_install', { packages: ['humanize'], reason: 'Format statistics' });
      }
      yield 'done';
    },
  });
  const app = await createApp({
    dataRoot: dir,
    token: 'test',
    runtime,
    pythonOptions: { runner: fake.runner },
  });
  try {
    const a = await app.python.operate({ action: 'create', name: 'A' });
    const b = await app.python.operate({ action: 'create', name: 'B' });
    await app.core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { models: { default: { provider: 'fake', model: 'fake' } } } },
    });
    const meeting = app.core.meetings.create({
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      policy: { approval: 'auto' },
    });
    app.python.bind('meeting', meeting.id, a.id);
    app.conductor.submit({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: 'Install a package',
    });
    while (!runtime.sessions.size) await new Promise((resolve) => setTimeout(resolve, 5));
    const [id, session] = [...runtime.sessions][0];
    app.python.bind('meeting', meeting.id, b.id);
    assert.ok(session.env.VIRTUAL_ENV.endsWith(a.id));
    release();
    await app.conductor.idle();
    app.conductor.submit({ meetingId: meeting.id, authorId: 'person_user', text: 'Continue' });
    await app.conductor.idle();
    assert.ok(runtime.sessions.get(id).env.VIRTUAL_ENV.endsWith(b.id));
    assert.equal(runtime.sessions.get(id).inputs.length, 2);
    const installed = app.python.operations().find((row) => row.actor_id === 'agent_main');
    assert.equal(installed.reason, 'Format statistics');
    assert.equal(installed.environment_id, a.id);
    const message = app.core.messages.since(meeting.id, 0).find((row) => row.turnId);
    assert.equal(app.core.turns.toolCalls(message.turnId)[0].name, 'python_env_install');
  } finally {
    release();
    await app.close();
    await cleanup();
  }
});
