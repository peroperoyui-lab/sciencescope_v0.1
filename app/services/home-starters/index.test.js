import test from 'node:test';
import assert from 'node:assert/strict';
import { createCore } from '../../core/index.js';
import { withCore, tempDir } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createHomeStarters } from './index.js';

function deferred() {
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

function result(progress = '合成资料已整理，下一步复核口径。', expertId = null) {
  return {
    progress,
    cards: Array.from({ length: 4 }, () => ({
      icon: 'book-open',
      title: '复核口径',
      sub: '核对合成资料中的指标',
      text: '请核对合成资料中的指标口径。',
      expertId,
    })),
  };
}

const settled = async () => ({ errors: [], closed: false });
const model = async () => ({ provider: 'test', model: 'secretary-model' });

/** @param {any} core @param {string} name */
async function projectChat(core, name) {
  const project = await core.projects.create({ name });
  const meeting = core.meetings.create({
    projectId: project.id,
    title: `${name}的合成对话`,
    members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
  });
  return { project, meeting };
}

/** @param {(context:any)=>Promise<void>} work @param {any} [options] */
function withStarters(work, options = {}) {
  return withCore('home-starters', async (core) => {
    const { project, meeting } = await projectChat(core, '公开合成项目');
    const runtime = createScriptedRuntime({
      script:
        options.script ??
        async function* () {
          yield JSON.stringify(result());
        },
    });
    const service = createHomeStarters({
      core,
      runtime,
      minutes: options.minutes ?? { settled },
      defaultModel: options.defaultModel ?? model,
    });
    const plan = (text) =>
      core.workspace.edit({
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: `- [ ] ${text}` },
      });
    const leave = async (id = project.id) => {
      service.focus(id, true);
      service.focus(id, false);
      await service.idle();
    };
    service.start();
    try {
      await work({ core, project, meeting, runtime, service, plan, leave });
    } finally {
      await service.close();
    }
  });
}

test('leaving waits for refreshed minutes and records one no-tool secretary turn without adding chat messages', async () => {
  const entered = deferred();
  const ready = deferred();
  await withStarters(
    async ({ core, project, meeting, runtime, service }) => {
      assert.deepEqual(service.slot(), { slot: null });
      service.focus(project.id, true);
      service.focus(project.id, false);
      try {
        await entered.promise;
        assert.equal(runtime.sessions.size, 0);
        await core.workspace.edit({
          resource: 'minutes',
          key: meeting.id,
          op: 'write',
          args: { text: '本次离开刚完成的纪要' },
        });
        ready.resolve();
        await service.idle();
        const { slot } = service.slot();
        assert.equal(slot.projectId, project.id);
        assert.equal(slot.projectName, project.name);
        assert.equal(slot.progress, result().progress);
        assert.equal(slot.cards.length, 4);
        assert.ok(Number.isFinite(Date.parse(slot.writtenAt)));
        assert.equal(runtime.sessions.size, 1);
        const [session] = runtime.sessions.values();
        assert.deepEqual(session.tools, []);
        assert.equal(session.model.model, 'secretary-model');
        assert.equal(JSON.parse(session.inputs[0]).minutes[0].text, '本次离开刚完成的纪要');
        assert.equal(core.messages.since(meeting.id, 0).length, 0);
        assert.equal(core.turns.session(meeting.id, 'agent_secretary'), null);
        const ended = core.events.since(0).filter((event) => event.type === 'turn.ended');
        assert.equal(ended.length, 1);
        assert.equal(ended[0].actorId, 'agent_secretary');
        assert.equal(ended[0].payload.status, 'done');
        assert.ok(ended[0].payload.usage.context);
        assert.equal(
          core.events.since(0).filter((event) => event.type === 'home.starters.updated').length,
          1,
        );
      } finally {
        ready.resolve();
      }
    },
    {
      minutes: {
        settled: async () => {
          entered.resolve();
          await ready.promise;
          return { errors: [], closed: false };
        },
      },
    },
  );
});

test('a foreground turn begun during model preparation keeps starters pending until the foreground ends', async () => {
  const entered = deferred();
  const ready = deferred();
  await withStarters(
    async ({ core, project, meeting, runtime, service }) => {
      service.focus(project.id, false);
      await entered.promise;
      const foreground = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      try {
        ready.resolve();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(runtime.sessions.size, 0);
        assert.deepEqual(service.slot(), { slot: null });
        core.turns.end(foreground.id, { status: 'done' });
        await service.idle();
        assert.equal(runtime.sessions.size, 1);
        assert.equal(service.slot().slot.projectId, project.id);
      } finally {
        ready.resolve();
        if (core.turns.get(foreground.id).status === 'running')
          core.turns.end(foreground.id, { status: 'cancelled' });
      }
    },
    {
      defaultModel: async () => {
        entered.resolve();
        await ready.promise;
        return model();
      },
    },
  );
});

test('the latest project replaces the global slot and an unchanged earlier project reuses its cache without a model request', () =>
  withStarters(async ({ core, project, runtime, service, leave }) => {
    const other = await projectChat(core, '第二个合成项目');
    await leave();
    const first = service.slot();
    await leave(other.project.id);
    assert.equal(service.slot().slot.projectId, other.project.id);
    assert.equal(runtime.sessions.size, 2);
    await leave(project.id);
    assert.deepEqual(service.slot(), first);
    assert.equal(runtime.sessions.size, 2);
    const published = core.events
      .since(0)
      .filter((event) => event.type === 'home.starters.updated');
    assert.deepEqual(
      published.map((event) => event.projectId),
      [project.id, other.project.id, project.id],
    );
  }));

test('turning off leave summaries retains the previous slot and does not generate or republish cached cards', () =>
  withStarters(async ({ core, service, runtime, leave }) => {
    const configure = (onLeaveProject) =>
      core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { summary: { onLeaveProject } } },
      });
    await configure(false);
    await leave();
    assert.deepEqual(service.slot(), { slot: null });
    assert.equal(runtime.sessions.size, 0);
    await configure(true);
    await leave();
    const saved = service.slot();
    await configure(false);
    await leave();
    assert.deepEqual(service.slot(), saved);
    assert.equal(runtime.sessions.size, 1);
    assert.equal(
      core.events.since(0).filter((event) => event.type === 'home.starters.updated').length,
      1,
    );
  }));

test('invalid JSON, three cards, unknown icons and unknown experts preserve the last successful slot and record failures', async () => {
  let response = JSON.stringify(result());
  await withStarters(
    async ({ core, service, runtime, leave, plan }) => {
      await leave();
      const saved = service.slot();
      const three = result();
      three.cards.pop();
      const icon = result();
      icon.cards[0].icon = 'unknown';
      const expert = result();
      expert.cards[0].expertId = 'missing-expert';
      const invalid = [
        'not JSON',
        JSON.stringify(three),
        JSON.stringify(icon),
        JSON.stringify(expert),
      ];
      for (const [index, text] of invalid.entries()) {
        response = text;
        await plan(`第 ${index + 1} 次输入变化`);
        await leave();
        assert.deepEqual(service.slot(), saved);
      }
      assert.equal(runtime.sessions.size, 5);
      assert.equal(
        core.events.since(0).filter((event) => event.type === 'home.starters.failed').length,
        4,
      );
    },
    {
      script: async function* () {
        yield response;
      },
    },
  );
});

test('minutes, missing model and failed model output keep the old slot and expose background failures', async () => {
  let errors = [];
  let choice = await model();
  let fail = false;
  await withStarters(
    async ({ core, service, runtime, leave, plan }) => {
      await leave();
      const saved = service.slot();
      errors = ['纪要刷新失败'];
      await plan('纪要失败期间的新计划');
      await leave();
      errors = [];
      choice = null;
      await plan('没有模型期间的新计划');
      await leave();
      choice = await model();
      fail = true;
      await plan('模型返回失败期间的新计划');
      await leave();
      assert.deepEqual(service.slot(), saved);
      assert.equal(runtime.sessions.size, 2);
      assert.equal(
        core.events.since(0).filter((event) => event.type === 'home.starters.failed').length,
        3,
      );
    },
    {
      minutes: { settled: async () => ({ errors, closed: false }) },
      defaultModel: async () => choice,
      script: async function* () {
        if (fail) yield { stop: 'failed', error: '合成请求失败' };
        else yield JSON.stringify(result());
      },
    },
  );
});

test('the current slot follows the project name, clears deleted expert IDs and hides archived or deleted projects', async () => {
  let expertId;
  await withStarters(
    async ({ core, project, service, leave }) => {
      const expert = await core.participants.create({
        kind: 'ai',
        name: '合成专家',
        definition: { prompt: '核对合成资料。' },
      });
      expertId = expert.id;
      await leave();
      assert.equal(service.slot().slot.cards[0].expertId, expert.id);
      await core.projects.update(project.id, { name: '更新后的合成项目' });
      assert.equal(service.slot().slot.projectName, '更新后的合成项目');
      core.db.prepare('DELETE FROM participants WHERE id=?').run(expert.id);
      assert.equal(service.slot().slot.cards[0].expertId, null);
      await core.projects.update(project.id, { archived: true });
      assert.deepEqual(service.slot(), { slot: null });
      await core.projects.update(project.id, { archived: false });
      core.db.prepare('UPDATE meetings SET project_id=NULL WHERE project_id=?').run(project.id);
      core.db.prepare('DELETE FROM projects WHERE id=?').run(project.id);
      assert.deepEqual(service.slot(), { slot: null });
    },
    {
      script: async function* () {
        yield JSON.stringify(result(undefined, expertId));
      },
    },
  );
});

test('an older project finishing after another leave cannot publish over the latest request', async () => {
  const entered = deferred();
  const ready = deferred();
  let calls = 0;
  await withStarters(
    async ({ core, project, service }) => {
      const other = await projectChat(core, '新的合成项目');
      service.focus(project.id, false);
      try {
        await entered.promise;
        service.focus(other.project.id, false);
        ready.resolve();
        await service.idle();
        assert.equal(service.slot().slot.projectId, other.project.id);
        const published = core.events
          .since(0)
          .filter((event) => event.type === 'home.starters.updated');
        assert.deepEqual(
          published.map((event) => event.projectId),
          [other.project.id],
        );
        assert.equal(calls, 2);
      } finally {
        ready.resolve();
      }
    },
    {
      script: async function* ({ input }) {
        if (++calls === 1) {
          entered.resolve();
          await ready.promise;
        }
        yield JSON.stringify(result(JSON.parse(input).projectName));
      },
    },
  );
});

test('a superseded result from the same project cannot overwrite its newer cache or slot', async () => {
  const entered = deferred();
  const ready = deferred();
  let calls = 0;
  await withStarters(
    async ({ core, project, service, plan }) => {
      service.focus(project.id, false);
      try {
        await entered.promise;
        await plan('第二次离开前新写入的计划');
        service.focus(project.id, false);
        ready.resolve();
        await service.idle();
        assert.equal(service.slot().slot.progress, '第 2 份合成结果');
        assert.equal(calls, 2);
        const cache = core.db
          .prepare('SELECT result_json,pending_seq FROM home_starters WHERE project_id=?')
          .get(project.id);
        assert.equal(JSON.parse(String(cache.result_json)).progress, '第 2 份合成结果');
        assert.equal(cache.pending_seq, null);
        assert.equal(
          core.events.since(0).filter((event) => event.type === 'home.starters.updated').length,
          1,
        );
      } finally {
        ready.resolve();
      }
    },
    {
      script: async function* () {
        const number = ++calls;
        if (number === 1) {
          entered.resolve();
          await ready.promise;
        }
        yield JSON.stringify(result(`第 ${number} 份合成结果`));
      },
    },
  );
});

for (const interrupted of ['focused', 'pending']) {
  test(`a ${interrupted} project survives a real database reopen and is caught up exactly once`, async () => {
    const fixture = await tempDir('home-starters-restart');
    let core = await createCore({ dataRoot: fixture.dir });
    const entered = deferred();
    const runtime = createScriptedRuntime({
      script: async function* () {
        yield JSON.stringify(result());
      },
    });
    let service;
    try {
      const { project } = await projectChat(core, '重启的合成项目');
      service = createHomeStarters({
        core,
        runtime,
        defaultModel: model,
        minutes: {
          settled: async (_id, { signal }) => {
            entered.resolve();
            await new Promise((resolve) =>
              signal.addEventListener('abort', () => resolve(undefined), { once: true }),
            );
            return { errors: [], closed: true };
          },
        },
      });
      service.focus(project.id, true);
      if (interrupted === 'pending') {
        service.start();
        service.focus(project.id, false);
        await entered.promise;
        await service.close();
      } else {
        // Reopen the durable focus checkpoint without the normal close hook,
        // as when the previous process stops before recovery can enqueue it.
        assert.equal(
          core.db.prepare('SELECT focused_project_id FROM home_starters_state').get()
            .focused_project_id,
          project.id,
        );
      }
      core.close();
      core = await createCore({ dataRoot: fixture.dir });
      service = createHomeStarters({ core, runtime, defaultModel: model, minutes: { settled } });
      service.start();
      await service.idle();
      assert.equal(service.slot().slot.projectId, project.id);
      assert.equal(runtime.sessions.size, 1);
      await service.close();
      service = createHomeStarters({ core, runtime, defaultModel: model, minutes: { settled } });
      service.start();
      await service.idle();
      assert.equal(runtime.sessions.size, 1);
    } finally {
      await service?.close();
      core.close();
      await fixture.cleanup();
    }
  });
}
