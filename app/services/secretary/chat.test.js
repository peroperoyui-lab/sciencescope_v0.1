import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createSecretaryChat } from './chat.js';
import { createMinutesService } from './minutes.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';

/**
 * @param {(context:any)=>Promise<void>} work
 * @returns {Promise<void>}
 */
function withSecretary(work) {
  return withCore('secretary-chat', async (core) => {
    const project = await core.projects.create({ name: '方法研究' });
    const main = core.meetings.create({
      projectId: project.id,
      title: '研究进展',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const runtime = createScriptedRuntime({
      script: async function* () {
        yield '# 研究纪要\n已确认研究目标';
      },
    });
    const minutes = createMinutesService({
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    const secretary = createSecretaryChat({ core, minutes });
    const meeting = secretary.ensure(main.id);
    const say = (text, authorId = 'person_user', extra = {}) =>
      core.messages.post({ meetingId: main.id, authorId, text, ...extra });
    try {
      await work({ core, project, main, meeting, minutes, secretary, say });
    } finally {
      await minutes.close();
    }
  });
}

test('opening secretary creates one attached ordinary meeting whose chat and cursor stay separate', () =>
  withSecretary(async ({ core, main, meeting, secretary, say }) => {
    assert.equal(secretary.ensure(main.id).id, meeting.id);
    assert.equal(meeting.attachedToMeetingId, main.id);
    assert.equal(meeting.policy.respondent, 'agent_secretary');
    assert.deepEqual(
      meeting.members.map((member) => member.participantId),
      ['person_user', 'agent_secretary'],
    );
    await core.workspace.edit({
      resource: 'plans',
      key: main.projectId,
      op: 'write',
      args: { text: '现有工作台计划' },
    });
    say('主会议原文');
    core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '秘书的独立问题' });
    const packet = await secretary.catchUp(meeting.id);
    assert.match(packet.text, /主会议原文/);
    assert.match(packet.text, /现有工作台计划/);
    assert.equal(packet.text.includes('秘书的独立问题'), false);
    assert.equal(secretary.cursor(meeting.id).throughSeq, 0);
    assert.equal(core.messages.since(main.id, 0).length, 1);
    assert.equal(secretary.snapshot(main.id).meeting.id, meeting.id);
  }));

test('only completed secretary answers commit the frozen raw packet and adopted reviews', () =>
  withSecretary(async ({ core, main, meeting, secretary, say }) => {
    say('第一条原文');
    const review = say('审核指出偏误', 'agent_reviewer', {
      adopted: false,
      refs: { discussion: { kind: 'review' } },
    });
    const packet = await secretary.catchUp(meeting.id);
    assert.equal(packet.text.includes(review.text), false);
    say('此包之后的新消息');
    for (const status of ['failed', 'cancelled', 'max_tokens']) {
      packet.commit({ status });
      assert.equal(secretary.cursor(meeting.id).throughSeq, 0);
    }
    packet.commit({ status: 'done' });
    assert.equal(secretary.cursor(meeting.id).throughSeq, 2);
    const next = await secretary.catchUp(meeting.id);
    assert.match(next.text, /此包之后的新消息/);
    assert.equal(next.text.includes('第一条原文'), false);
    next.commit({ status: 'done' });
    core.messages.update(review.id, { adopted: true });
    const adopted = await secretary.catchUp(meeting.id);
    assert.ok(adopted.text.includes(review.text));
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_secretary' });
    adopted.commit({ status: 'done', turnId: turn.id });
    core.turns.end(turn.id, { status: 'done' });
    assert.equal(core.messages.get(review.id).adoptionLocked, true);
    assert.equal((await secretary.catchUp(meeting.id)).text.includes(review.text), false);
    assert.equal(core.turns.session(main.id, 'agent_main'), null);
  }));

test('lost secretary memory rebuilds from latest minutes and full uncovered raw, despite a saved cursor', () =>
  withSecretary(async ({ meeting, main, minutes, secretary, say }) => {
    say('被纪要覆盖的旧原文');
    await minutes.refresh(main.id);
    say('纪要之后的原文', 'agent_main');
    (await secretary.catchUp(meeting.id)).commit({ status: 'done' });
    assert.equal(secretary.cursor(meeting.id).minutesRevisionNumber, 1);
    const regular = await secretary.catchUp(meeting.id);
    assert.equal(regular.text.includes('纪要之后的原文'), false);
    const rebuilt = await secretary.catchUp(meeting.id, { rebuilding: true });
    assert.match(rebuilt.text, /研究纪要/);
    assert.ok(rebuilt.text.includes('纪要之后的原文'));
    assert.equal(rebuilt.text.includes('被纪要覆盖的旧原文'), false);
  }));

test('large backlog waits for minutes but excludes messages and summary revisions created after its highwater', () =>
  withSecretary(async ({ core, main, meeting, minutes, say }) => {
    const old = say('先前原文');
    await minutes.refresh(main.id);
    const raw = say('中文'.repeat(8000));
    let resume = () => {};
    let entered = () => {};
    const hold = new Promise((resolve) => {
      resume = () => resolve(undefined);
    });
    const began = new Promise((resolve) => {
      entered = () => resolve(undefined);
    });
    const delayed = createSecretaryChat({
      core,
      minutes: {
        coverage: minutes.coverage,
        coveredMessageIds: minutes.coveredMessageIds,
        refresh: async () => {
          entered();
          await hold;
          return minutes.refresh(main.id);
        },
      },
    });
    const collecting = delayed.catchUp(meeting.id, { rebuilding: true });
    await began;
    say('未来主会议消息');
    resume?.();
    const packet = await collecting;
    assert.equal(packet.throughSeq, raw.seq);
    assert.equal(packet.text.includes('未来主会议消息'), false);
    assert.ok(packet.text.includes(raw.text));
    assert.equal(packet.text.includes(old.text), false);
    assert.equal(minutes.coverage(main.id), 3);
    assert.equal(
      packet.minutesRevision,
      core.workspace.history({ resource: 'minutes', key: main.id })[1].id,
    );
    packet.commit({ status: 'done' });
    assert.equal(delayed.cursor(meeting.id).throughSeq, 2);
  }));

test('a refresh timeout or failure preserves every pending message verbatim and does not advance until success', () =>
  withSecretary(async ({ core, meeting, minutes, say }) => {
    const text = '中文'.repeat(16000);
    say(text);
    let release = () => {};
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const service = createSecretaryChat({
      core,
      minutes: {
        coverage: minutes.coverage,
        coveredMessageIds: minutes.coveredMessageIds,
        refresh: () => held,
      },
      refreshWaitMs: 1,
    });
    const packet = await service.catchUp(meeting.id);
    assert.ok(packet.text.includes(text));
    assert.match(packet.text, /still running/);
    assert.equal(service.cursor(meeting.id).throughSeq, 0);
    release?.();
    packet.commit({ status: 'done' });
    assert.equal(service.cursor(meeting.id).throughSeq, 1);
    const failed = createSecretaryChat({
      core,
      minutes: {
        coverage: minutes.coverage,
        coveredMessageIds: minutes.coveredMessageIds,
        refresh: async () => {
          throw new Error('HTTP 429');
        },
      },
    });
    say(text);
    const retry = await failed.catchUp(meeting.id, { contextWindow: 1000 });
    assert.ok(retry.text.includes(text));
    assert.match(retry.text, /refresh failed/);
  }));

test('main draft proposals are editable persistent cards, filled text is returned without sending and decisions can be undone', () =>
  withSecretary(async ({ core, main, meeting, secretary }) => {
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_secretary' });
    const proposal = secretary.propose(
      { meetingId: meeting.id, participantId: 'agent_secretary', turnId: turn.id },
      { text: '请检查固定效应模型' },
    );
    core.turns.end(turn.id, { status: 'done' });
    assert.equal(proposal.mainMeetingId, main.id);
    assert.equal(proposal.actorId, 'agent_secretary');
    assert.equal(proposal.status, 'pending');
    const filled = secretary.decide(proposal.id, {
      text: '请加入稳健标准误检验',
      status: 'filled',
    });
    assert.equal(filled.text, '请加入稳健标准误检验');
    assert.equal(core.messages.since(main.id, 0).length, 0);
    const restarted = createSecretaryChat({ core, minutes: null });
    assert.equal(restarted.snapshot(main.id).proposals[0].text, filled.text);
    assert.equal(restarted.snapshot(main.id).proposals[0].status, 'filled');
    restarted.undo(filled.historyId);
    assert.equal(restarted.list(main.id)[0].status, 'pending');
    assert.equal(restarted.list(main.id)[0].text, proposal.text);
    const dismissed = restarted.decide(proposal.id, { status: 'dismissed' });
    assert.equal(dismissed.status, 'dismissed');
    assert.equal(restarted.history(proposal.id)[0].actorId, 'person_user');
    const otherRole = restarted.propose(
      { meetingId: main.id, participantId: 'agent_main' },
      { text: '主专家也可生成草稿', mainMeetingId: main.id },
    );
    assert.equal(otherRole.status, 'pending');
  }));

test('generic main invocations have no secretary packet and stopping a backlog wait cancels immediately', () =>
  withSecretary(async ({ core, main, meeting, minutes, secretary, say }) => {
    assert.equal(await secretary.catchUp(main.id), null);
    say('中文'.repeat(8000));
    let started = () => {};
    let release = () => {};
    const began = new Promise((resolve) => {
      started = () => resolve(undefined);
    });
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const waiting = createSecretaryChat({
      core,
      minutes: {
        coverage: minutes.coverage,
        coveredMessageIds: minutes.coveredMessageIds,
        refresh: () => {
          started();
          return held;
        },
      },
    });
    const controller = new AbortController();
    const packet = waiting.catchUp(meeting.id, { signal: controller.signal });
    await began;
    controller.abort();
    await assert.rejects(packet, { code: 'TURN_CANCELLED' });
    assert.equal(waiting.cursor(meeting.id).throughSeq, 0);
    release?.();
  }));
