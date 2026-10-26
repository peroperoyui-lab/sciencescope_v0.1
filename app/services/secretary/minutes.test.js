import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { withCore } from '../../testing.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createMinutesService, estimateTokens } from './minutes.js';

/**
 * @param {(context:any)=>Promise<void>} work
 * @param {import('../../runtime/scripted.js').Script} [script]
 * @returns {Promise<void>}
 */
function withMinutes(
  work,
  script = async function* () {
    yield '# 研究目标\n保持全部已有事实';
  },
) {
  return withCore('minutes', async (core, dir) => {
    const workFolder = path.join(dir, 'external');
    await mkdir(workFolder);
    const project = await core.projects.create({ name: '科研项目', folder: workFolder });
    const meeting = core.meetings.create({
      projectId: project.id,
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const runtime = createScriptedRuntime({ script });
    const options = {
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'meeting-model' }),
      debounceMs: 0,
      pendingDelayMs: 0,
    };
    const minutes = createMinutesService(options);
    const say = (text, authorId = 'person_user', extra = {}) =>
      core.messages.post({ meetingId: meeting.id, authorId, text, ...extra });
    const configure = async (summary) =>
      core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { summary } },
      });
    try {
      await work({
        core,
        dir,
        project,
        meeting,
        runtime,
        minutes,
        options,
        say,
        configure,
        workFolder,
      });
    } finally {
      await minutes.close();
    }
  });
}

test('message thresholds debounce complete raw text into one background turn, with usage and no main message', () =>
  withMinutes(async ({ core, meeting, minutes, runtime, say, configure }) => {
    assert.equal(estimateTokens('中文あ한국abcd'), 6);
    await configure({ everyMessages: { enabled: true, n: 2 }, everyTokens: { enabled: false } });
    minutes.start();
    say('原始提问');
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    const answer = say('', 'agent_main', { status: 'streaming' });
    await minutes.idle();
    assert.equal(runtime.sessions.size, 0);
    const long = '完整回答'.repeat(17000);
    core.messages.update(answer.id, { text: long, status: 'done' });
    core.turns.end(turn.id, { status: 'done' });
    await minutes.idle();
    const state = await minutes.status(meeting.id);
    assert.equal(state.throughSeq, 2);
    assert.equal(state.messagesRemaining, 2);
    assert.equal(core.messages.since(meeting.id, 0).length, 2);
    const [session] = runtime.sessions.values();
    assert.ok(session.inputs[0].includes(long));
    assert.deepEqual(session.tools, []);
    assert.equal(session.model.model, 'meeting-model');
    const background = core.events
      .since(0)
      .filter((event) => event.type === 'turn.ended' && event.actorId === 'agent_secretary');
    assert.equal(background.length, 1);
    assert.equal(background[0].payload.status, 'done');
    assert.ok(background[0].payload.usage.context);
  }));

test('minutes yield when a foreground turn starts during preparation and resume the pending manual update once', () =>
  withMinutes(async ({ core, meeting, options, runtime, say, configure }) => {
    await configure({
      afterDiscussion: false,
      everyMessages: { enabled: false },
      everyTokens: { enabled: false },
      onEnterProject: false,
      onLeaveProject: false,
    });
    say('准备期间也不能丢失的研究决定');
    let enterPreparation = () => {};
    let releasePreparation = () => {};
    const entered = new Promise((resolve) => {
      enterPreparation = () => resolve(undefined);
    });
    const held = new Promise((resolve) => {
      releasePreparation = () => resolve(undefined);
    });
    const service = createMinutesService({
      ...options,
      defaultModel: async () => {
        enterPreparation();
        await held;
        return { provider: 'test', model: 'meeting-model' };
      },
    });
    service.start();
    let foreground;
    try {
      const refresh = service.refresh(meeting.id);
      await entered;
      foreground = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      releasePreparation();
      await refresh;
      await service.idle();
      const waiting = await service.status(meeting.id);
      assert.equal(runtime.sessions.size, 0);
      assert.equal(waiting.newMessages, 1);
      assert.equal(waiting.updating, true);
      assert.equal(waiting.error, null);
      assert.equal(core.events.since(0).filter((event) => event.type === 'turn.started').length, 1);
      core.turns.end(foreground.id, { status: 'done' });
      await service.idle();
      const completed = await service.status(meeting.id);
      assert.equal(completed.throughSeq, 1);
      assert.equal(completed.newMessages, 0);
      assert.equal(completed.updating, false);
      assert.equal(completed.error, null);
      assert.equal(runtime.sessions.size, 1);
      const events = core.events.since(0);
      assert.equal(events.filter((event) => event.type === 'minutes.updated').length, 1);
      assert.deepEqual(
        events
          .filter((event) => event.type === 'turn.ended' && event.actorId === 'agent_secretary')
          .map((event) => event.payload.status),
        ['done'],
      );
    } finally {
      releasePreparation();
      if (foreground && core.turns.get(foreground.id).status === 'running')
        core.turns.end(foreground.id, { status: 'cancelled' });
      await service.close();
    }
  }));

test('token thresholds, completed discussion and project focus consume only new messages', () =>
  withMinutes(async ({ core, meeting, project, runtime, minutes, say, configure }) => {
    await configure({ everyMessages: { enabled: false }, everyTokens: { enabled: true, n: 3 } });
    minutes.start();
    say('中日韩');
    await minutes.idle();
    assert.equal(runtime.sessions.size, 1);
    await configure({ everyTokens: { enabled: false } });
    say('讨论结果', 'agent_methodologist');
    core.events.record(
      'discussion.finished',
      { meetingId: meeting.id },
      { meetingId: meeting.id, projectId: project.id },
    );
    await minutes.idle();
    assert.equal(runtime.sessions.size, 2);
    say('进入项目应补齐');
    minutes.focus(project.id);
    await minutes.idle();
    assert.equal(runtime.sessions.size, 3);
    say('离开项目应补齐');
    minutes.focus(null);
    await minutes.idle();
    assert.equal(runtime.sessions.size, 4);
    const sessions = [...runtime.sessions.values()];
    assert.equal(sessions[3].inputs[0].includes('进入项目应补齐'), false);
    assert.equal((await minutes.status(meeting.id)).newMessages, 0);
  }));

test('user revisions remain authoritative, undo restores coverage, and late adopted reviews enter the next summary once', () =>
  withMinutes(async ({ core, meeting, minutes, runtime, say }) => {
    const first = say('已定事实');
    const review = say('未采纳审核', 'agent_reviewer', {
      adopted: false,
      refs: { discussion: { kind: 'review' } },
    });
    say('后续事实', 'agent_main');
    const original = await minutes.refresh(meeting.id);
    assert.equal(original.throughSeq, 3);
    assert.equal([...runtime.sessions.values()][0].inputs[0].includes(review.text), false);
    const edited = await minutes.edit(
      meeting.id,
      '# 用户纠正\n应使用稳健标准误',
      original.revision,
    );
    assert.equal(edited.throughSeq, 3);
    const next = say('新的实验结果');
    core.messages.update(review.id, { adopted: true });
    const second = await minutes.refresh(meeting.id);
    const input = [...runtime.sessions.values()].at(-1).inputs[0];
    assert.match(input, /用户纠正/);
    assert.ok(input.includes(review.text));
    assert.ok(input.includes(next.text));
    assert.equal(input.includes(first.text), false);
    assert.equal(core.messages.get(review.id).adoptionLocked, true);
    assert.ok(minutes.coveredMessageIds(meeting.id, second.revision).includes(review.id));
    await core.workspace.undo(second.revision);
    assert.equal(minutes.coverage(meeting.id), 3);
    assert.equal((await minutes.status(meeting.id)).newMessages, 2);
    await core.workspace.undo(edited.revision);
    assert.equal(minutes.coverage(meeting.id), 3);
    await core.workspace.undo(original.revision);
    assert.equal(minutes.coverage(meeting.id), 0);
  }));

test('a user edit racing secretary output wins, and concurrent refreshes never overlap', async () => {
  let resume;
  let entered;
  const began = new Promise((resolve) => {
    entered = resolve;
  });
  const hold = new Promise((resolve) => {
    resume = resolve;
  });
  let active = 0;
  let peak = 0;
  await withMinutes(
    async ({ meeting, minutes, say, runtime }) => {
      say('背景原文');
      const refresh = minutes.refresh(meeting.id);
      await began;
      const edited = await minutes.edit(meeting.id, '# 用户在生成时编辑的纪要', null);
      resume();
      await refresh;
      assert.equal((await minutes.status(meeting.id)).text, edited.text);
      assert.equal(minutes.coverage(meeting.id), 0);
      say('用户补充');
      await Promise.all([minutes.refresh(meeting.id), minutes.refresh(meeting.id)]);
      assert.equal(peak, 1);
      assert.equal(runtime.sessions.size, 2);
      assert.match([...runtime.sessions.values()].at(-1).inputs[0], /用户在生成时编辑/);
    },
    async function* () {
      active += 1;
      peak = Math.max(peak, active);
      entered();
      await hold;
      yield '# 秘书生成的纪要';
      active -= 1;
    },
  );
});

test('workbench direct updates append or mark user data, retain provenance and can be undone', () =>
  withMinutes(
    async ({ core, project, meeting, minutes, say, configure }) => {
      await core.workspace.edit({
        resource: 'map',
        key: project.id,
        op: 'addNode',
        args: { node: { id: 'root', text: '用户的研究问题' } },
      });
      await core.workspace.edit({
        resource: 'plans',
        key: project.id,
        op: 'write',
        args: { text: '用户说明\n- [ ] 原有任务附加\n- [ ] 原有任务' },
      });
      await core.workspace.edit({
        resource: 'log',
        key: project.id,
        op: 'write',
        args: { text: '用户的原有日志' },
      });
      await configure({ workbench: { map: 'apply', plans: 'apply', log: 'apply' } });
      say('记录新任务和结果');
      const summary = await minutes.refresh(meeting.id);
      const map = (await core.workspace.read({ resource: 'map', key: project.id })).value;
      assert.equal(map.nodes[0].text, '用户的研究问题');
      assert.equal(map.nodes[0].status, 'done');
      assert.equal(map.nodes[1].addedBy, 'agent_secretary');
      assert.equal(map.nodes[1].minutesRevisionId, summary.revision);
      assert.equal(
        (await core.workspace.read({ resource: 'plans', key: project.id })).text,
        '用户说明\n- [ ] 原有任务附加\n- [x] 原有任务\n- [ ] 新任务',
      );
      assert.match(
        (await core.workspace.read({ resource: 'log', key: project.id })).text,
        /^用户的原有日志\n/,
      );
      const snapshots = core.workspace.snapshots({ projectId: project.id });
      assert.deepEqual(snapshots.map((snapshot) => snapshot.resource).sort(), [
        'log',
        'map',
        'minutes',
        'plans',
      ]);
      assert.ok(
        snapshots.every(
          (snapshot) => snapshot.source === 'ai-turn-end' && snapshot.actorId === 'agent_secretary',
        ),
      );
      assert.equal(
        core.workspace.getSnapshot(snapshots.find((snapshot) => snapshot.resource === 'plans').id)
          .text,
        '用户说明\n- [ ] 原有任务附加\n- [x] 原有任务\n- [ ] 新任务',
      );
      const writes = core.workspace
        .history({ meetingId: meeting.id })
        .filter((revision) => revision.resource !== 'minutes');
      assert.equal(writes.length, 5);
      assert.ok(writes.every((revision) => revision.actorId === 'agent_secretary'));
      for (const revision of writes) {
        assert.equal(
          core.db
            .prepare(
              'SELECT minutes_revision_id FROM minutes_workbench_updates WHERE revision_id = ?',
            )
            .get(revision.id).minutes_revision_id,
          summary.revision,
        );
        await core.workspace.undo(revision.id);
      }
      assert.equal(
        (await core.workspace.read({ resource: 'plans', key: project.id })).text,
        '用户说明\n- [ ] 原有任务附加\n- [ ] 原有任务',
      );
      assert.equal(
        (await core.workspace.read({ resource: 'map', key: project.id })).value.nodes.length,
        1,
      );
    },
    async function* ({ instructions }) {
      if (instructions.includes('Return JSON only'))
        yield JSON.stringify({
          operations: [
            { target: 'map', op: 'status', nodeId: 'root', status: 'done' },
            { target: 'map', op: 'add_child', parentId: 'root', text: '秘书添加的方案' },
            { target: 'plans', op: 'complete', text: '- [ ] 原有任务' },
            { target: 'plans', op: 'add', text: '新任务' },
            { target: 'log', op: 'append', title: '本次进展', note: '采用稳健标准误' },
          ],
        });
      else yield '# 研究纪要\n新任务和进展';
    },
  ));

test('minutes stay in application data and leave existing external copies untouched', () =>
  withMinutes(async ({ meeting, minutes, say, workFolder, configure }) => {
    // A legacy saved setting must not re-enable exports.
    await configure({ saveMarkdown: true });
    say('研究决定');
    const first = await minutes.refresh(meeting.id);
    assert.match(first.text, /研究目标/);
    assert.deepEqual(await readdir(workFolder), []);
    assert.equal(Object.hasOwn(first, 'exportPath'), false);
    assert.equal(Object.hasOwn(first, 'exportError'), false);
    await mkdir(path.join(workFolder, 'minutes'));
    const file = path.join(workFolder, 'minutes', meeting.id + '.md');
    await writeFile(file, '用户保留的旧纪要');
    const edited = await minutes.edit(meeting.id, '# 用户编辑的纪要', first.revision);
    assert.equal((await minutes.status(meeting.id)).text, '# 用户编辑的纪要');
    say('后续研究进展');
    const refreshed = await minutes.refresh(meeting.id);
    assert.equal(refreshed.revisionNumber, edited.revisionNumber + 1);
    assert.equal(refreshed.throughSeq, 2);
    assert.equal(await readFile(file, 'utf8'), '用户保留的旧纪要');
  }));

test('incomplete, failed and empty output preserve prior minutes and coverage until manual retry', async () => {
  let attempt = 0;
  await withMinutes(
    async ({ meeting, minutes, say, core }) => {
      say('不可丢失的原文');
      for (const code of ['MINUTES_INCOMPLETE', 'MINUTES_FAILED', 'EMPTY_MINUTES']) {
        await assert.rejects(minutes.refresh(meeting.id), { code });
        assert.equal(minutes.coverage(meeting.id), 0);
        assert.equal((await minutes.status(meeting.id)).text, '');
        assert.ok((await minutes.status(meeting.id)).error);
        if (code === 'MINUTES_INCOMPLETE')
          assert.equal((await minutes.status(meeting.id)).incompleteOutput, '未完整的纪要');
      }
      const success = await minutes.refresh(meeting.id);
      assert.equal(success.throughSeq, 1);
      const turns = core.events.since(0).filter((event) => event.type === 'turn.ended');
      assert.deepEqual(
        turns.map((event) => event.payload.status),
        ['max_tokens', 'failed', 'failed', 'done'],
      );
    },
    async function* () {
      attempt += 1;
      if (attempt === 1) {
        yield '未完整的纪要';
        yield { stop: 'max_tokens' };
      } else if (attempt === 2) yield { stop: 'failed', error: 'HTTP 429' };
      else if (attempt === 4) yield '# 完整纪要';
    },
  );
});

test('shutdown defers dirty focused projects durably, next startup processes them', () =>
  withMinutes(async ({ core, meeting, project, minutes, options, runtime, say, configure }) => {
    await configure({
      everyMessages: { enabled: false },
      everyTokens: { enabled: false },
      onEnterProject: false,
    });
    minutes.start();
    minutes.focus(project.id);
    say('关闭前留下的新内容');
    await minutes.idle();
    await minutes.close();
    assert.equal(runtime.sessions.size, 0);
    assert.equal(
      core.db.prepare('SELECT COUNT(*) AS count FROM secretary_pending_projects').get().count,
      1,
    );
    const restarted = createMinutesService(options);
    restarted.start();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await restarted.idle();
    assert.equal((await restarted.status(meeting.id)).throughSeq, 1);
    assert.equal(
      core.db.prepare('SELECT COUNT(*) AS count FROM secretary_pending_projects').get().count,
      0,
    );
    await restarted.close();
  }));

test('disabled automatic rules make no calls; manual summary uses the saved secretary model and prompt', () =>
  withMinutes(async ({ core, meeting, project, minutes, runtime, say, configure }) => {
    await core.participants.updateDefinition('agent_secretary', {
      model: { provider: 'test', model: 'secretary-model', effort: 'high' },
      prompt: '用户保存的秘书说明',
    });
    await configure({
      afterDiscussion: false,
      everyMessages: { enabled: false },
      everyTokens: { enabled: false },
      onEnterProject: false,
      onLeaveProject: false,
    });
    minutes.start();
    say('需要整理');
    minutes.focus(project.id);
    core.events.record('discussion.finished', { meetingId: meeting.id }, { meetingId: meeting.id });
    await minutes.idle();
    minutes.focus(null);
    await minutes.idle();
    assert.equal(runtime.sessions.size, 0);
    const status = await minutes.refresh(meeting.id);
    const [session] = runtime.sessions.values();
    assert.equal(session.model.model, 'secretary-model');
    assert.equal(session.model.effort, 'high');
    assert.match(session.instructions, /用户保存的秘书说明/);
    assert.equal(Object.hasOwn(status, 'exportPath'), false);
    assert.equal(status.messagesRemaining, null);
    assert.equal(status.tokensRemaining, null);
  }));

test('declared model context capacity splits complete raw messages into successive revisioned batches', () =>
  withMinutes(async ({ core, meeting, minutes, runtime, say }) => {
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          providers: [
            { id: 'test', models: [{ id: 'meeting-model', contextWindow: 1600, maxTokens: 200 }] },
          ],
        },
      },
    });
    const raw = ['甲', '乙', '丙'].map((character) => character.repeat(800));
    for (const text of raw) say(text);
    const result = await minutes.refresh(meeting.id);
    assert.equal(result.throughSeq, 3);
    assert.equal(result.newMessages, 0);
    assert.equal(runtime.sessions.size, 3);
    const sessions = [...runtime.sessions.values()];
    for (let index = 0; index < raw.length; index += 1) {
      assert.ok(sessions[index].inputs[0].includes(raw[index]));
      assert.equal(sessions[index].inputs[0].includes(raw[(index + 1) % raw.length]), false);
      if (index) assert.match(sessions[index].inputs[0], /研究目标/);
    }
    const history = core.workspace.history({ resource: 'minutes', key: meeting.id });
    assert.deepEqual(
      history.map((revision) => minutes.coverage(meeting.id, revision.id)),
      [3, 2, 1],
    );
    say('丁'.repeat(2400));
    await assert.rejects(minutes.refresh(meeting.id), { code: 'MODEL_CONTEXT_EXCEEDED' });
    assert.equal(minutes.coverage(meeting.id), 3);
    assert.equal((await minutes.status(meeting.id)).newMessages, 1);
    assert.equal(runtime.sessions.size, 3);
  }));

test('closing immediately after a project switch preserves the previous pending project', () =>
  withMinutes(async ({ core, meeting, project, runtime, options, say }) => {
    const next = await core.projects.create({ name: '切换到另一个项目' });
    await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: {
        changes: {
          summary: {
            onEnterProject: false,
            everyMessages: { enabled: false },
            everyTokens: { enabled: false },
          },
        },
      },
    });
    const service = createMinutesService({ ...options, debounceMs: 60000, pendingDelayMs: 60000 });
    service.start();
    service.focus(project.id);
    say('切换前未整理的事实');
    service.focus(next.id);
    await service.close();
    const rows = core.db.prepare('SELECT project_id FROM secretary_pending_projects').all();
    assert.ok(rows.some((row) => row.project_id === project.id));
    assert.equal(runtime.sessions.size, 0);
    assert.equal(service.coverage(meeting.id), 0);
  }));

test('a meeting bound to its internal project folder keeps canonical minutes free of export headers and false revisions', () =>
  withCore('minutes-internal-export', async (core) => {
    const project = await core.projects.create({ name: '内置项目文件夹' });
    const meeting = core.meetings.create({ projectId: project.id });
    assert.equal(meeting.workFolder, core.workspace.locate.projectDir(project.id));
    const runtime = createScriptedRuntime({
      script: async function* () {
        yield '# 内置纪要\n原始决定';
      },
    });
    const service = createMinutesService({
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    try {
      core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '原始决定' });
      const state = await service.refresh(meeting.id);
      assert.equal(state.text, '# 内置纪要\n原始决定');
      assert.equal(state.revisionNumber, 1);
      assert.equal(state.throughSeq, 1);
      assert.equal(Object.hasOwn(state, 'exportPath'), false);
      const history = core.workspace.history({ resource: 'minutes', key: meeting.id });
      assert.deepEqual(
        history.map((revision) => revision.op),
        ['write'],
      );
      assert.equal(
        await readFile(path.join(meeting.workFolder, 'minutes', meeting.id + '.md'), 'utf8'),
        state.text,
      );
      const [snapshot] = core.workspace.snapshots({ resource: 'minutes', key: meeting.id });
      assert.equal(core.workspace.getSnapshot(snapshot.id).text, state.text);
    } finally {
      await service.close();
    }
  }));
