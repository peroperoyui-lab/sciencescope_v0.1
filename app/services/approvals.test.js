import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { withCore, tempDir } from '../testing.js';
import { createTools } from './tools.js';
import { createAppServer } from '../server/server.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createTurnRunner } from './turn-runner.js';
import { createContextAssembly } from './context-assembly.js';
import { createConductor } from './conductor.js';

function nextApproval(core) {
  return new Promise((resolve) => {
    const unsubscribe = core.events.subscribe((event) => {
      if (event.type !== 'turn.phase' || event.payload.phase !== 'waiting-approval') return;
      unsubscribe();
      resolve(core.turns.toolCalls(event.payload.id).findLast((row) => row.kind === 'approval'));
    });
  });
}

test(
  'approval API rejects then approves a file edit, returns refusal to the model and preserves the turn',
  { timeout: 15000 },
  () =>
    withCore('approval-flow', async (core) => {
      const outside = await tempDir('approval-project');
      const tools = createTools(core);
      const results = [];
      const runtime = createScriptedRuntime({
        script: async function* ({ call }) {
          results.push(await call('write_file', { path: 'analysis.py', content: 'print(42)' }));
          results.push(await call('write_file', { path: 'analysis.py', content: 'print(43)' }));
          yield 'Finished with the approved file.';
        },
      });
      const runner = createTurnRunner({
        core,
        tools,
        runtime,
        runtimeName: 'scripted',
        contextAssembly: createContextAssembly({
          core,
          defaultModel: async () => ({ provider: 'test', model: 'test' }),
        }),
      });
      const conductor = createConductor({ core, runner });
      conductor.start();
      const server = createAppServer({
        core,
        token: 'test',
        conductor,
        approvals: tools.approvals,
      });
      const base = await server.listen();
      const decide = async (row, decision) => {
        const response = await fetch(`${base}/api/turns/${row.turnId}/approvals/${row.id}`, {
          method: 'POST',
          headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
          body: JSON.stringify({ decision }),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      try {
        const meeting = core.meetings.create({
          workFolder: outside.dir,
          members: [{ participantId: 'agent_main' }],
        });
        assert.equal(meeting.policy.approval, 'ask');
        // Legacy policy JSON reads as ask, without a migration or silent opt-in.
        core.db
          .prepare('UPDATE meetings SET policy_json=? WHERE id=?')
          .run('{"mode":"direct"}', meeting.id);
        assert.equal(core.meetings.get(meeting.id).policy.approval, 'ask');
        const first = nextApproval(core);
        conductor.submit({
          meetingId: meeting.id,
          authorId: 'person_user',
          text: 'Write a script',
        });
        const denied = await first;
        assert.deepEqual(denied.args, {
          tool: 'write_file',
          summary: path.join(outside.dir, 'analysis.py'),
        });
        await assert.rejects(readFile(path.join(outside.dir, 'analysis.py')), { code: 'ENOENT' });
        const second = nextApproval(core);
        assert.equal((await decide(denied, 'reject')).status, 'rejected');
        const allowed = await second;
        assert.equal((await decide(allowed, 'approve')).status, 'approved');
        assert.equal((await decide(allowed, 'approve')).status, 'approved');
        await conductor.idle();
        assert.equal(results[0].message, '用户拒绝了这次操作');
        assert.equal(await readFile(path.join(outside.dir, 'analysis.py'), 'utf8'), 'print(43)');
        assert.equal(core.turns.get(denied.turnId).status, 'done');
        assert.equal(core.turns.get(denied.turnId).error, null);
      } finally {
        conductor.stop();
        tools.approvals.close();
        await conductor.idle();
        await server.close();
        await outside.cleanup();
      }
    }),
);

test(
  'stopping, ending a turn, shutdown and restart cancel pending approvals without failure',
  { timeout: 15000 },
  () =>
    withCore('approval-cancel', async (core) => {
      const tools = createTools(core);
      const meeting = core.meetings.create({});
      const events = [];
      const unsubscribe = core.events.subscribe((event) => events.push(event));
      try {
        for (const mode of ['abort', 'turn', 'close']) {
          const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
          const controller = new AbortController();
          const ready = nextApproval(core);
          const result = tools.run(
            'shell',
            { command: 'echo should-not-run' },
            {
              meetingId: meeting.id,
              turnId: turn.id,
              participantId: 'agent_main',
              signal: controller.signal,
            },
          );
          const row = await ready;
          if (mode === 'abort') controller.abort();
          if (mode === 'turn') core.turns.end(turn.id, { status: 'cancelled' });
          if (mode === 'close') tools.approvals.close();
          assert.equal((await result).cancelled, true);
          assert.equal(
            core.turns.toolCalls(turn.id).find((item) => item.id === row.id).status,
            'cancelled',
          );
          assert.equal(core.turns.get(turn.id).error, null);
        }
        assert.equal(
          events.filter(
            (event) => event.type === 'tool.ended' && event.payload.status === 'cancelled',
          ).length,
          3,
        );
        const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
        core.turns.startToolCall({
          turnId: turn.id,
          callId: 'crashed',
          kind: 'approval',
          status: 'pending',
          name: 'shell',
          args: {},
        });
        const restarted = createTools(core);
        assert.equal(core.turns.toolCalls(turn.id)[0].status, 'cancelled');
        restarted.approvals.close();
      } finally {
        unsubscribe();
        tools.approvals.close();
      }
    }),
);

test(
  'auto bypasses approvals; ask allows data edits and reads but waits for package installs',
  { timeout: 15000 },
  () =>
    withCore('approval-policy', async (core) => {
      const tools = createTools(core);
      const meeting = core.meetings.create({ policy: { approval: 'auto' } });
      const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      const context = { meetingId: meeting.id, turnId: turn.id, participantId: 'agent_main' };
      try {
        const shell = await tools.run('shell', { command: 'echo approval-auto' }, context);
        assert.equal(shell.exitCode, 0);
        assert.equal(core.turns.toolCalls(turn.id).length, 0);
        core.meetings.update(meeting.id, { policy: { approval: 'ask' } });
        await tools.run('write_file', { path: 'analysis.txt', content: 'Research data' }, context);
        await tools.run('read_file', { path: 'analysis.txt' }, context);
        assert.equal(core.turns.toolCalls(turn.id).length, 0);
        const ready = nextApproval(core);
        const install = tools.run(
          'python_env_install',
          { packages: ['humanize'], reason: 'Readability' },
          context,
        );
        const row = await ready;
        assert.match(row.args.summary, /humanize/);
        tools.approvals.decide(turn.id, row.id, 'reject');
        assert.equal((await install).rejected, true);
      } finally {
        tools.approvals.close();
      }
    }),
);
