import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { withCore, tempDir } from '../testing.js';
import { createTools } from './tools.js';
import { createApprovalRules } from './approval-rules.js';
import { createAppServer } from '../server/server.js';

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
  'always allow spans one project, excludes compound commands, and deletion asks again',
  { timeout: 30000 },
  () =>
    withCore('always-allow', async (core) => {
      const outside = await tempDir('always-files');
      const tools = createTools(core);
      const server = createAppServer({ core, token: 'test', approvals: tools.approvals });
      const base = await server.listen();
      const project = await core.projects.create({ name: 'First', folder: outside.dir });
      const other = await core.projects.create({ name: 'Second' });
      const first = core.meetings.create({ projectId: project.id });
      const second = core.meetings.create({ projectId: project.id });
      const third = core.meetings.create({ projectId: other.id });
      const decide = async (row, decision, scope = undefined) => {
        const response = await fetch(`${base}/api/turns/${row.turnId}/approvals/${row.id}`, {
          method: 'POST',
          headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
          body: JSON.stringify({ decision, scope }),
        });
        assert.equal(response.status, 200);
        return response.json();
      };
      function run(meeting, name, args) {
        const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
        const context = {
          meetingId: meeting.id,
          participantId: 'agent_main',
          turnId: turn.id,
          callId: 'command',
        };
        core.turns.startToolCall({ turnId: turn.id, callId: context.callId, name, args });
        return {
          turn,
          done: tools.run(name, args, context).then((result) => {
            const call = core.turns.endToolCall(turn.id, context.callId, {
              result,
              isError: false,
            });
            core.turns.end(turn.id, { status: 'done' });
            return call;
          }),
        };
      }
      try {
        const ready = nextApproval(core);
        const initial = run(first, 'shell', { command: 'echo first' });
        const row = await ready;
        const prefix = row.args.scopes.find((scope) => scope.kind === 'prefix');
        assert.equal(prefix.value, 'echo');
        const saved = await decide(row, 'always', prefix);
        assert.equal((await decide(row, 'always', prefix)).id, saved.id);
        const ruleId = saved.result.approvedBy.ruleId;
        assert.equal((await initial.done).result.approvedBy.ruleId, ruleId);
        const automatic = run(second, 'shell', { command: 'echo second' });
        assert.equal((await automatic.done).result.approvedBy.ruleId, ruleId);
        assert.equal(core.turns.toolCalls(automatic.turn.id).length, 1);
        for (const { meeting, command } of [
          { meeting: second, command: 'echo third && echo fourth' },
          { meeting: third, command: 'echo other' },
        ]) {
          const pending = nextApproval(core);
          const attempt = run(meeting, 'shell', { command });
          const request = await pending;
          if (command.includes('&&'))
            assert.deepEqual(
              request.args.scopes.map((scope) => scope.kind),
              ['exact'],
            );
          await decide(request, 'reject');
          assert.equal((await attempt.done).result.rejected, true);
        }
        await core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { approvals: { rules: [] } } },
        });
        const again = nextApproval(core);
        const removed = run(second, 'shell', { command: 'echo after-delete' });
        await decide(await again, 'reject');
        await removed.done;

        const fileReady = nextApproval(core);
        const file = run(first, 'write_file', {
          path: path.join(outside.dir, 'first.txt'),
          content: 'one',
        });
        const fileRequest = await fileReady;
        await decide(
          fileRequest,
          'always',
          fileRequest.args.scopes.find((scope) => scope.kind === 'folder'),
        );
        await file.done;
        const nested = run(second, 'write_file', {
          path: path.join(outside.dir, '子目录', 'second.txt'),
          content: 'two',
        });
        assert.ok((await nested.done).result.approvedBy.ruleId);
        assert.equal(core.turns.toolCalls(nested.turn.id).length, 1);
      } finally {
        tools.approvals.close();
        await server.close();
        await outside.cleanup();
      }
    }),
);

test('standalone rules stay local; menu scopes and concurrent package approvals retain their meaning', () =>
  withCore('approval-scopes', async (core) => {
    const rules = createApprovalRules(core);
    const first = core.meetings.create({});
    const other = core.meetings.create({});
    const context = { meetingId: first.id };
    const shell = await rules.scopes('shell', { command: 'npm install sample' }, context);
    assert.equal(shell[1].value, 'npm install');
    await rules.remember('shell', shell[1], first.id);
    assert.equal(
      (await rules.matching('shell', { command: 'npm install another' }, context)).length,
      1,
    );
    assert.equal(
      (await rules.matching('shell', { command: 'npm install another' }, { meetingId: other.id }))
        .length,
      0,
    );
    const packages = await rules.scopes(
      'python_env_install',
      { packages: ['Some_Package==1.0', 'humanize'] },
      context,
    );
    assert.deepEqual(
      packages.map(({ kind, value }) => ({ kind, value })),
      [
        { kind: 'package', value: 'some-package' },
        { kind: 'package', value: 'humanize' },
        { kind: 'any', value: '' },
      ],
    );
    await Promise.all(
      packages.slice(0, 2).map((choice) => rules.remember('python_env_install', choice, first.id)),
    );
    assert.equal(
      (
        await rules.matching(
          'python_env_install',
          { packages: ['some.package>=2', 'humanize'] },
          context,
        )
      ).length,
      2,
    );
    assert.equal(
      (await rules.matching('python_env_install', { packages: ['humanize', 'another'] }, context))
        .length,
      0,
    );
    assert.equal(
      (await core.workspace.read({ resource: 'settings', key: 'app' })).value.approvals.rules
        .length,
      3,
    );
  }));
