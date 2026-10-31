import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createMinutesService } from '../secretary/minutes.js';
import { createAppServer } from '../../server/server.js';
import { createHomeStarters } from './index.js';

function gate() {
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, release };
}

const cards = {
  progress: '已在纪要中确定下一步。',
  cards: ['lightbulb', 'circle-help', 'scale', 'list-checks'].map((icon) => ({
    icon,
    title: '核对研究问题',
    sub: '从现有材料继续',
    text: '请核对现有的研究问题。',
    expertId: null,
  })),
};

test('focus HTTP waits for deferred leave minutes before publishing cards and returns the existing focus shape', () =>
  withCore('home-starters-http', async (core) => {
    const project = await core.projects.create({ name: '合成项目' });
    const meeting = core.meetings.create({ projectId: project.id });
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          summary: {
            everyMessages: { enabled: false },
            everyTokens: { enabled: false },
            onEnterProject: false,
            onLeaveProject: true,
          },
        },
      },
    });
    const minutesStarted = gate();
    const releaseMinutes = gate();
    const inputs = [];
    const runtime = createScriptedRuntime({
      script: async function* ({ instructions, input }) {
        inputs.push(input);
        if (instructions.includes('You maintain the complete research meeting minutes')) {
          minutesStarted.release();
          await releaseMinutes.promise;
          yield '# 研究目标\n离开前刚确认的新纪要';
        } else {
          assert.ok(input.includes('离开前刚确认的新纪要'));
          yield JSON.stringify(cards);
        }
      },
    });
    const dependencies = {
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'scripted' }),
    };
    const minutes = createMinutesService({ ...dependencies, debounceMs: 0, pendingDelayMs: 0 });
    const home = createHomeStarters({ ...dependencies, minutes });
    const server = createAppServer({ core, token: 'test-token', minutes, homeStarters: home });
    minutes.start();
    home.start();
    const address = await server.listen();
    const request = async (route, body) => {
      const response = await fetch(`${address}${route}`, {
        method: body ? 'POST' : 'GET',
        headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 200);
      return response.json();
    };
    let foreground;
    try {
      assert.deepEqual(await request('/api/home/starters'), { slot: null });
      assert.deepEqual(await request(`/api/projects/${project.id}/focus`, { focused: true }), {
        focused: true,
      });
      core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '刚刚确认的新决定',
      });
      foreground = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      assert.deepEqual(await request(`/api/projects/${project.id}/focus`, { focused: false }), {
        focused: false,
      });
      await minutes.idle();
      assert.equal((await minutes.status(meeting.id)).updating, true);
      assert.equal(inputs.length, 0);
      core.turns.end(foreground.id, { status: 'done' });
      foreground = null;
      await minutesStarted.promise;
      assert.deepEqual(await request('/api/home/starters'), { slot: null });
      releaseMinutes.release();
      await home.idle();
      const result = await request('/api/home/starters');
      assert.equal(result.slot.projectId, project.id);
      assert.equal(result.slot.progress, cards.progress);
      assert.equal(inputs.length, 2);
      assert.equal(core.messages.since(meeting.id, 0).length, 1);
      assert.equal(
        core.events.since(0).filter((event) => event.type === 'home.starters.updated').length,
        1,
      );
    } finally {
      releaseMinutes.release();
      if (foreground) core.turns.end(foreground.id, { status: 'cancelled' });
      await home.close();
      await minutes.close();
      await runtime.close();
      await server.close();
    }
  }));

test('project settling includes startup minutes and can be cancelled without waiting for the recovery timer', () =>
  withCore('home-starters-recovery-wait', async (core) => {
    const project = await core.projects.create({ name: '恢复中的项目' });
    const meeting = core.meetings.create({ projectId: project.id });
    core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '退出前的新决定' });
    core.db
      .prepare('INSERT INTO secretary_pending_projects(project_id,created_at) VALUES (?,?)')
      .run(project.id, new Date().toISOString());
    const began = gate();
    const release = gate();
    const runtime = createScriptedRuntime({
      script: async function* () {
        began.release();
        await release.promise;
        yield '# 研究目标\n恢复纪要';
      },
    });
    const minutes = createMinutesService({
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'scripted' }),
      pendingDelayMs: 10,
      debounceMs: 0,
    });
    // Recovery timers do not keep the process alive; the real application has
    // its HTTP listener while startup recovery is pending.
    const server = createAppServer({ core, token: 'test-token', minutes });
    await server.listen();
    minutes.start();
    const abort = new AbortController();
    const cancelled = minutes.settled(project.id, { signal: abort.signal });
    abort.abort();
    assert.deepEqual(await cancelled, { errors: [], closed: true });
    let finished = false;
    const settled = minutes.settled(project.id).then((value) => {
      finished = true;
      return value;
    });
    try {
      await began.promise;
      assert.equal(finished, false);
      release.release();
      assert.deepEqual(await settled, { errors: [], closed: false });
      assert.ok((await minutes.status(meeting.id)).text.includes('恢复纪要'));
    } finally {
      release.release();
      await minutes.close();
      await runtime.close();
      await server.close();
    }
  }));

test('an interrupted app recovers focused-project minutes even when its normal close hook never ran', () =>
  withCore('home-starters-crash', async (core) => {
    const project = await core.projects.create({ name: '异常退出的项目' });
    const meeting = core.meetings.create({ projectId: project.id });
    core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '退出前的新事实' });
    await core.workspace.edit({
      resource: 'minutes',
      key: meeting.id,
      op: 'write',
      args: { text: '尚未刷新到的旧纪要' },
    });
    core.db
      .prepare('UPDATE home_starters_state SET focused_project_id=? WHERE id=1')
      .run(project.id);
    assert.equal(
      core.db.prepare('SELECT COUNT(*) AS n FROM secretary_pending_projects').get().n,
      0,
    );
    const calls = [];
    const runtime = createScriptedRuntime({
      script: async function* ({ instructions, input }) {
        if (instructions.includes('You maintain the complete research meeting minutes')) {
          calls.push('minutes');
          yield '# 研究目标\n启动补写的最新事实';
        } else {
          calls.push('home');
          assert.ok(input.includes('启动补写的最新事实'));
          yield JSON.stringify(cards);
        }
      },
    });
    const deps = {
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'scripted' }),
    };
    const minutes = createMinutesService({ ...deps, pendingDelayMs: 0, debounceMs: 0 });
    const home = createHomeStarters({ ...deps, minutes });
    const server = createAppServer({ core, token: 'test-token', minutes, homeStarters: home });
    await server.listen();
    try {
      minutes.start();
      home.start();
      await home.idle();
      assert.deepEqual(calls, ['minutes', 'home']);
      assert.equal(home.slot().slot.projectId, project.id);
      assert.equal((await minutes.status(meeting.id)).newMessages, 0);
    } finally {
      await home.close();
      await minutes.close();
      await runtime.close();
      await server.close();
    }
  }));

test('a foreground turn during preparation makes cards wait again for its newly queued minutes', () =>
  withCore('home-starters-preparation', async (core) => {
    const project = await core.projects.create({ name: '准备期间继续发言' });
    const meeting = core.meetings.create({ projectId: project.id });
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          summary: {
            everyMessages: { enabled: true, n: 1 },
            everyTokens: { enabled: false },
            onEnterProject: false,
            onLeaveProject: true,
          },
        },
      },
    });
    const preparing = gate();
    const releasePreparation = gate();
    const newMinutes = gate();
    const releaseMinutes = gate();
    let preparations = 0;
    let summaryCalls = 0;
    let cardCalls = 0;
    const runtime = createScriptedRuntime({
      script: async function* ({ instructions, input }) {
        if (instructions.includes('You maintain the complete research meeting minutes')) {
          summaryCalls++;
          if (summaryCalls === 2) {
            newMinutes.release();
            await releaseMinutes.promise;
          }
          yield summaryCalls === 1 ? '# 研究目标\n此前的纪要' : '# 研究目标\n后来新纪要中的事实';
        } else {
          cardCalls++;
          assert.ok(input.includes('后来新纪要中的事实'));
          yield JSON.stringify(cards);
        }
      },
    });
    const deps = {
      core,
      runtime,
      defaultModel: async () => {
        if (++preparations === 2) {
          preparing.release();
          await releasePreparation.promise;
        }
        return { provider: 'test', model: 'scripted' };
      },
    };
    const minutes = createMinutesService({ ...deps, pendingDelayMs: 0, debounceMs: 0 });
    const home = createHomeStarters({ ...deps, minutes });
    const server = createAppServer({ core, token: 'test-token', minutes, homeStarters: home });
    await server.listen();
    minutes.start();
    home.start();
    let foreground;
    try {
      minutes.focus(project.id);
      home.focus(project.id, true);
      core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '第一条事实' });
      minutes.focus(null);
      home.focus(project.id, false);
      await preparing.promise;
      foreground = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '准备期间的新事实',
      });
      await minutes.idle();
      releasePreparation.release();
      core.turns.end(foreground.id, { status: 'done' });
      foreground = null;
      await newMinutes.promise;
      assert.equal(cardCalls, 0);
      releaseMinutes.release();
      await home.idle();
      assert.equal(summaryCalls, 2);
      assert.equal(cardCalls, 1);
      assert.equal((await minutes.status(meeting.id)).newMessages, 0);
    } finally {
      releasePreparation.release();
      releaseMinutes.release();
      if (foreground) core.turns.end(foreground.id, { status: 'cancelled' });
      await home.close();
      await minutes.close();
      await runtime.close();
      await server.close();
    }
  }));
