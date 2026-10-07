import test from 'node:test';
import assert from 'node:assert/strict';
import { withCore } from '../../testing.js';
import { createResearch } from '../research/index.js';
import { createMinutesService } from '../secretary/minutes.js';
import { createScriptedRuntime } from '../../runtime/scripted.js';
import { createMemoryService } from './index.js';

/**
 * @param {(context:any)=>Promise<void>} work
 * @returns {Promise<void>}
 */
function withMemory(work) {
  return withCore('memory', async (core) => {
    const project = await core.projects.create({ name: '科研计划' });
    const meeting = core.meetings.create({
      projectId: project.id,
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const research = createResearch(core);
    const runtime = createScriptedRuntime({
      script: async function* ({ input }) {
        yield `# 研究决定\n${input.match(/### Message #[\s\S]*$/)?.[0] ?? '采用稳健标准误'}`;
      },
    });
    const minutes = createMinutesService({
      core,
      runtime,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    });
    const calls = [];
    const runner = {
      prepare: async () => ({
        model: { provider: 'test', model: 'test' },
        prompt: '',
        contextWindow: null,
        outputTokens: 200,
      }),
      run: async (meetingId, instructions, input) => {
        const turn = core.turns.start({ meetingId, participantId: 'agent_secretary' });
        calls.push({ instructions, input });
        let text;
        if (instructions.includes('memory extraction')) {
          const source = JSON.parse(input).sources.find(
            (candidate) => candidate.kind === 'message',
          );
          text = JSON.stringify({
            candidates: source
              ? [
                  {
                    subtype: 'decision',
                    title: '统计决定',
                    body: source.text,
                    evidence: [{ messageId: source.id, quote: source.text }],
                  },
                ]
              : [],
          });
        } else
          text = JSON.stringify({
            decisions: [
              { candidateIndex: 0, supported: true, duplicateOf: null, rationale: '来源支持' },
            ],
          });
        const usage = { totalTokens: 1000 };
        core.turns.end(turn.id, { status: 'done', usage });
        return { text, turnId: turn.id, usage };
      },
      close: async () => {},
    };
    const options = { core, minutes, research, runner, idleDelayMs: 1 };
    const memory = createMemoryService(options);
    const say = (text, extra = {}) =>
      core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text, ...extra });
    const settings = async (patch) =>
      core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { memory: patch } },
      });
    try {
      await work({
        core,
        project,
        meeting,
        research,
        minutes,
        memory,
        runner,
        calls,
        say,
        options,
        settings,
      });
    } finally {
      await memory.close();
      await minutes.close();
    }
  });
}

test('idle minutes changes extract then verify proposed memories without adding main messages', () =>
  withMemory(async ({ core, project, meeting, memory, minutes, calls, say }) => {
    say('采用稳健标准误');
    await minutes.refresh(meeting.id);
    memory.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await memory.idle();
    assert.equal(memory.inbox(project.id).count, 1);
    const item = memory.inbox(project.id).items[0];
    assert.equal(item.status, 'proposed');
    assert.equal(item.createdBy, 'agent_secretary');
    assert.equal(item.payload.evidence[0].seq, 1);
    assert.equal(item.origin.meetingId, meeting.id);
    assert.equal(calls.length, 2);
    assert.match(calls[0].instructions, /memory extraction/);
    assert.match(calls[1].instructions, /memory verification/);
    assert.equal(core.messages.since(meeting.id, 0).length, 1);
    assert.ok(core.events.since(0).some((event) => event.type === 'memory.status'));
  }));

test('only new minutes deltas are consolidated and repeated no-change runs make no calls', () =>
  withMemory(async ({ meeting, memory, minutes, calls, say }) => {
    const first = say('第一项研究决定');
    await minutes.refresh(meeting.id);
    await memory.consolidate(meeting.id);
    await memory.consolidate(meeting.id);
    assert.equal(calls.length, 2);
    say('第二项研究决定');
    await minutes.refresh(meeting.id);
    await memory.consolidate(meeting.id);
    assert.equal(calls.length, 4);
    const raw = JSON.parse(calls[2].input).sources.filter((source) => source.kind === 'message');
    assert.equal(raw.length, 1);
    assert.equal(raw[0].text, '第二项研究决定');
    assert.equal(
      raw.some((source) => source.id === first.id),
      false,
    );
  }));

test('external provenance survives user acceptance edits and inverse memory history', () =>
  withMemory(async ({ project, meeting, memory, minutes, research, say }) => {
    research.store.createSource({ projectId: project.id, kind: 'webpage', title: '网页来源' });
    say('网页建议使用稳健标准误 [S1]');
    await minutes.refresh(meeting.id);
    await memory.consolidate(meeting.id);
    const item = memory.inbox(project.id).items[0];
    assert.equal(item.payload.originTrust, 'external');
    const accepted = memory.update(item.id, {
      status: 'active',
      body: '已核实的稳健标准误选择',
      subtype: 'convention',
      visibility: 'private',
      scope: 'project',
      payload: { originTrust: 'user', evidence: [] },
      expectedRevision: item.revision,
    });
    assert.equal(accepted.payload.originTrust, 'external');
    assert.equal(accepted.subtype, 'convention');
    assert.equal(accepted.visibility, 'private');
    assert.deepEqual(accepted.payload.evidence, item.payload.evidence);
    assert.equal(memory.inbox(project.id).count, 0);
    assert.equal(research.store.listItems({ projectId: project.id, type: 'memory' }).length, 1);
    const restored = memory.undo(accepted.historyId);
    assert.equal(restored.status, 'proposed');
    assert.equal(restored.body, item.body);
    assert.equal(restored.subtype, item.subtype);
    assert.equal(restored.visibility, item.visibility);
    assert.equal(memory.inbox(project.id).count, 1);
    const rejected = memory.update(item.id, { status: 'rejected' });
    assert.equal(rejected.status, 'rejected');
    assert.equal(research.store.listItems({ projectId: project.id, type: 'memory' }).length, 0);
    assert.equal(memory.historyProject(project.id)[0].resource, 'memory');
    assert.equal(memory.history(item.id).at(-1).actorId, 'agent_secretary');
  }));

test('request budget saves extracted candidates and resumes verification after service restart without repeating extraction', () =>
  withMemory(
    async ({ core, project, meeting, memory, minutes, runner, options, calls, say, settings }) => {
      say('需要保存的研究决定');
      await minutes.refresh(meeting.id);
      await settings({ tokenLimit: 1300 });
      const first = await memory.consolidate(meeting.id);
      assert.equal(first.state, 'skipped');
      assert.equal(first.pending.stage, 'verify');
      assert.equal(calls.length, 1);
      assert.equal(memory.inbox(project.id).count, 0);
      await memory.close();
      const restarted = createMemoryService({ ...options, runner });
      const result = await restarted.consolidate(meeting.id);
      assert.equal(result.state, 'completed');
      assert.equal(calls.length, 2);
      assert.match(calls[1].instructions, /memory verification/);
      assert.equal(result.usage.tokens, 1000);
      assert.equal(result.pending, null);
      assert.equal(restarted.inbox(project.id).count, 1);
      assert.equal(
        core.db.prepare('SELECT COUNT(*) AS count FROM memory_checkpoints').get().count,
        0,
      );
      await restarted.close();
    },
  ));

test('unsupported verification, bad evidence and partial output never confirm memories or advance a failed revision', () =>
  withMemory(async ({ project, meeting, memory, minutes, runner, calls, say }) => {
    say('确认的研究决定');
    await minutes.refresh(meeting.id);
    const original = runner.run;
    runner.run = async (...args) => {
      const response = await original(...args);
      if (args[1].includes('memory verification'))
        response.text = JSON.stringify({
          decisions: [
            { candidateIndex: 0, supported: false, duplicateOf: null, rationale: '不支持' },
          ],
        });
      return response;
    };
    await memory.consolidate(meeting.id);
    assert.equal(memory.inbox(project.id).count, 0);
    say('新增需要整理');
    await minutes.refresh(meeting.id);
    runner.run = async () => {
      const error = Object.assign(new Error('HTTP 429'), { incompleteOutput: '', usage: null });
      error.incompleteOutput = '{"candidates":';
      error.usage = { totalTokens: 15 };
      throw error;
    };
    await assert.rejects(memory.consolidate(meeting.id), /HTTP 429/);
    const state = await memory.status(meeting.id);
    assert.equal(state.state, 'failed');
    assert.ok(state.pending);
    assert.equal(state.usage.tokens, 15);
    assert.ok(state.retainedOutputs.some((output) => output.text === '{"candidates":'));
    assert.equal(state.throughSeq, 1);
    assert.equal(calls.length, 2);
  }));

test('user minutes corrections use only the latest source range and preserve external trust from minutes evidence', () =>
  withMemory(async ({ core, project, meeting, memory, minutes, runner, calls, say }) => {
    say('第一项历史决定');
    await minutes.refresh(meeting.id);
    await memory.consolidate(meeting.id);
    say('网页的第二项决定 [S1]');
    const second = await minutes.refresh(meeting.id);
    await memory.consolidate(meeting.id);
    const edited = await minutes.edit(
      meeting.id,
      second.text + '\n第二项决定应采用稳健方法',
      second.revision,
    );
    const original = runner.run;
    runner.run = async (...args) => {
      const response = await original(...args);
      if (args[1].includes('memory extraction'))
        response.text = JSON.stringify({
          candidates: [
            {
              subtype: 'decision',
              title: '纠正网页决定',
              body: '第二项决定应采用稳健方法',
              evidence: [{ minutesRevision: edited.revision, quote: '第二项决定应采用稳健方法' }],
            },
          ],
        });
      return response;
    };
    await memory.consolidate(meeting.id);
    const latestInput = JSON.parse(calls[4].input);
    assert.equal(latestInput.sources.filter((source) => source.kind === 'message').length, 1);
    assert.equal(
      latestInput.sources.some(
        (source) => source.kind === 'message' && source.text === '第一项历史决定',
      ),
      false,
    );
    const item = memory.inbox(project.id).items.find((entry) => entry.title === '纠正网页决定');
    assert.equal(item.payload.originTrust, 'external');
    assert.equal(item.payload.evidence[0].quote, '第二项决定应采用稳健方法');
    assert.equal(item.payload.evidence[0].messageId, undefined);
    const accepted = memory.update(item.id, { status: 'active' });
    memory.undo(accepted.historyId);
    const created = memory.history(item.id).at(-1);
    assert.equal(memory.undo(created.id).status, 'rejected');
    assert.equal(memory.inbox(null).count, 0);
    assert.deepEqual(memory.historyProject(null), []);
    assert.equal(core.messages.since(meeting.id, 0).length, 2);
  }));

test('missing provider usage uses a labelled token estimate and keeps the next stage pending', () =>
  withMemory(async ({ meeting, memory, minutes, runner, say, settings }) => {
    say('需要整理的决定');
    await minutes.refresh(meeting.id);
    const original = runner.run;
    runner.run = async (...args) => ({ ...(await original(...args)), usage: { totalTokens: 0 } });
    runner.prepare = async () => ({
      model: { provider: 'test', model: 'test' },
      prompt: '',
      contextWindow: null,
      outputTokens: 0,
    });
    await settings({ tokenLimit: 40000 });
    const state = await memory.consolidate(meeting.id);
    assert.equal(state.usage.estimatedRequests, 1);
    assert.equal(state.usage.source, 'actual-and-estimated');
    assert.equal(state.state, 'skipped');
    assert.equal(state.pending.stage, 'verify');
  }));

test('long raw sources are read losslessly by configured token pages and only complete source work advances coverage', () =>
  withMemory(async ({ core, meeting, memory, minutes, runner, calls, say }) => {
    const raw = '📚完整原文'.repeat(1800);
    const message = say(raw);
    const summary = await minutes.refresh(meeting.id);
    runner.prepare = async () => ({
      model: { provider: 'test', model: 'test' },
      prompt: '',
      contextWindow: 1500,
      outputTokens: 100,
    });
    const original = runner.run;
    runner.run = async (...args) => {
      const response = await original(...args);
      response.text = JSON.stringify({ candidates: [] });
      return response;
    };
    const result = await memory.consolidate(meeting.id);
    const pieces = calls
      .flatMap((call) => JSON.parse(call.input).sources)
      .filter((source) => source.kind === 'message' && source.id === message.id);
    assert.ok(pieces.length > 1);
    assert.equal(pieces.map((source) => source.text).join(''), raw);
    assert.equal(pieces[0].offset, 0);
    assert.equal(pieces.at(-1).end, raw.length);
    assert.equal(result.throughSeq, 1);
    assert.equal(result.minutesRevision, summary.revision);
    assert.equal(core.messages.get(message.id).text, raw);
  }));

test('changed checkpoint sources discard stale extraction while durable source cursors remain retryable', () =>
  withMemory(async ({ core, meeting, memory, minutes, runner, say, settings }) => {
    const message = say('原始研究决定');
    await minutes.refresh(meeting.id);
    await settings({ tokenLimit: 1300 });
    await memory.consolidate(meeting.id);
    assert.equal((await memory.status(meeting.id)).pending.stage, 'verify');
    core.messages.update(message.id, { text: '用户修订的研究决定' });
    await assert.rejects(memory.consolidate(meeting.id), { code: 'MEMORY_SOURCE_CHANGED' });
    assert.equal((await memory.status(meeting.id)).pending, null);
    assert.equal((await memory.status(meeting.id)).throughSeq, 0);
    await settings({ tokenLimit: null });
    await memory.consolidate(meeting.id);
    assert.equal((await memory.status(meeting.id)).throughSeq, 1);
    assert.equal(runner.prepare != null, true);
  }));

test('invalid quoted evidence stays failed and current active memories can make verification redundant', () =>
  withMemory(async ({ project, meeting, memory, minutes, runner, research, say }) => {
    const message = say('采用完整病例分析');
    await minutes.refresh(meeting.id);
    const original = runner.run;
    runner.run = async (...args) => {
      const response = await original(...args);
      if (args[1].includes('memory extraction'))
        response.text = JSON.stringify({
          candidates: [
            {
              subtype: 'decision',
              title: '分析策略',
              body: '采用完整病例分析',
              evidence: [{ messageId: message.id, quote: '不存在的原文' }],
            },
          ],
        });
      return response;
    };
    await assert.rejects(memory.consolidate(meeting.id), { code: 'MEMORY_INVALID_EVIDENCE' });
    assert.equal(memory.inbox(project.id).count, 0);
    assert.equal((await memory.status(meeting.id)).throughSeq, 0);
    const existing = research.store.createItem({
      projectId: project.id,
      type: 'memory',
      subtype: 'decision',
      title: '既有策略',
      body: message.text,
    });
    runner.run = async (...args) => {
      const response = await original(...args);
      if (args[1].includes('memory verification'))
        response.text = JSON.stringify({
          decisions: [
            {
              candidateIndex: 0,
              supported: true,
              duplicateOf: existing.id,
              rationale: '与现有记忆重复',
            },
          ],
        });
      return response;
    };
    await memory.consolidate(meeting.id);
    assert.equal(memory.inbox(project.id).count, 0);
    assert.equal((await memory.status(meeting.id)).throughSeq, 1);
  }));

test('foreground execution and disabled idle rules defer consolidation until an explicit request', () =>
  withMemory(async ({ core, project, meeting, memory, minutes, calls, say, settings }) => {
    say('保留待整理的决定');
    await minutes.refresh(meeting.id);
    await settings({ enabled: false });
    memory.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls.length, 0);
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    assert.equal((await memory.consolidate(meeting.id)).state, 'waiting');
    assert.equal(calls.length, 0);
    core.turns.end(turn.id, { status: 'done' });
    await memory.consolidate(meeting.id);
    assert.equal(memory.inbox(project.id).count, 1);
  }));

test('saved extraction with secretary minutes evidence recovers without another extraction and verifies candidates in one sourced batch', () =>
  withMemory(async ({ core, project, meeting, memory, minutes, calls, runner, say, settings }) => {
    const message = say('对应原文确认的研究决定');
    const summary = await minutes.refresh(meeting.id);
    const candidates = ['决定一', '决定二', '决定三'].map((title) => ({
      subtype: 'decision',
      title,
      body: '对应原文确认的研究决定',
      evidence: [
        { minutesRevision: summary.revision, quote: '# 研究决定' },
        { messageId: message.id, quote: message.text },
      ],
    }));
    const store = await import('./store.js');
    core.db.prepare('INSERT INTO memory_checkpoints VALUES (?, ?)').run(
      meeting.id,
      JSON.stringify({
        input: {
          meetingId: meeting.id,
          minutesRevision: summary.revision,
          throughSeq: 1,
          minutesHash: store.hash(summary.text),
          delta: {
            authorId: 'agent_secretary',
            added: ['# 研究决定'],
            removed: [],
            minutesRevision: summary.revision,
          },
          messages: [
            { id: message.id, text: message.text, sha256: store.hash(message.text), seq: 1 },
          ],
        },
        model: { provider: 'test', model: 'test' },
        stage: 'extract',
        pageIndex: 0,
        verificationIndex: 0,
        candidates: [],
        pages: [
          [
            { kind: 'minutes', id: summary.revision, text: '# 研究决定' },
            { kind: 'message', id: message.id, text: message.text, seq: 1 },
          ],
        ],
        outputs: [
          { stage: 'extract', completed: true, text: JSON.stringify({ candidates }), turnId: null },
        ],
      }),
    );
    await settings({ tokenLimit: 1 });
    const held = await memory.consolidate(meeting.id);
    assert.equal(held.pending.stage, 'verify');
    assert.equal(held.usage.requests, 0);
    assert.equal(held.pending.candidates, 3);
    await settings({ tokenLimit: null });
    const original = runner.run;
    runner.run = async (...args) => {
      assert.match(args[1], /memory verification/);
      const input = JSON.parse(args[2]);
      assert.equal(input.candidates.length, 3);
      assert.equal(input.sources[0].text, message.text);
      const response = await original(...args);
      response.text = JSON.stringify({
        decisions: input.candidates.map(({ candidateIndex }) => ({
          candidateIndex,
          supported: true,
          duplicateOf: null,
          rationale: '原文和纪要共同支持',
        })),
      });
      return response;
    };
    const result = await memory.consolidate(meeting.id);
    assert.equal(result.state, 'completed');
    assert.equal(result.usage.requests, 1);
    assert.equal(calls.length, 1);
    assert.equal(memory.inbox(project.id).count, 3);
    assert.equal(
      memory.inbox(project.id).items[0].payload.evidence[0].minutesAuthorId,
      'agent_secretary',
    );
  }));
