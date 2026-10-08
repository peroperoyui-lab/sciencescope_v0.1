import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../testing.js';
import { createCore } from '../core/index.js';
import { createDeliverables } from './deliverables.js';
import { createTools } from './tools.js';
import { createTurnRunner } from './turn-runner.js';
import { createContextAssembly } from './context-assembly.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { createAppServer } from '../server/server.js';

const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII=',
  'base64',
);

test('workspace_present preserves bytes, tool/message provenance, other AI context, restart and default open', async () => {
  const { dir, cleanup } = await tempDir('deliverables');
  let core = await createCore({ dataRoot: dir });
  let server;
  try {
    const project = await core.projects.create({ name: '结果展示' });
    const workFolder = core.workspace.locate.projectDir(project.id);
    await mkdir(workFolder, { recursive: true });
    const source = path.join(workFolder, '图.png');
    await writeFile(source, image);
    await writeFile(path.join(workFolder, '报告.txt'), '研究结果原件');
    const meeting = core.meetings.create({
      projectId: project.id,
      title: '交付物',
      members: [
        { participantId: 'person_user' },
        { participantId: 'agent_main' },
        { participantId: 'agent_statistician' },
      ],
    });
    const runtime = createScriptedRuntime({
      script: async function* ({ call, instructions, input }) {
        if (instructions.includes('你是：主专家')) {
          const result = await call('workspace_present', {
            files: [
              { path: '图.png', description: '地区效应图' },
              { path: '报告.txt', description: '统计报告' },
            ],
          });
          assert.equal(result.files.length, 2);
          assert.deepEqual(Object.keys(result.files[0]), ['path', 'description']);
          yield '请查看图与报告。';
        } else {
          assert.match(input, /交付物：[\s\S]*地区效应图[\s\S]*统计报告/);
          assert.doesNotMatch(input, /iVBOR|研究结果原件/);
          yield '已读到交付物路径和说明。';
        }
      },
    });
    const tools = createTools(core);
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools,
      contextAssembly: createContextAssembly({
        core,
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
      }),
    });
    const question = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: '展示结果',
    });
    await runner.run({
      meetingId: meeting.id,
      participantId: 'agent_main',
      triggerMessageId: question.id,
    });
    const answer = core.messages.list(meeting.id).messages.at(-1);
    assert.equal(answer.deliverables.length, 2);
    const [file, report] = answer.deliverables;
    const call = core.turns.toolCalls(answer.turnId)[0];
    assert.equal(file.toolCallId, call.callId);
    assert.equal(file.turnId, answer.turnId);
    assert.equal(file.messageId, answer.id);
    assert.equal(file.sourcePath, source);
    assert.equal(call.status, 'done');
    assert.deepEqual(await readFile(file.path), image);
    await rm(source);
    await rm(path.join(workFolder, '报告.txt'));
    await runner.run({
      meetingId: meeting.id,
      participantId: 'agent_statistician',
      triggerMessageId: question.id,
    });
    assert.ok(
      [...runtime.sessions.values()].every((session) =>
        session.tools.some((spec) => spec.name === 'workspace_present'),
      ),
    );
    const replay = await createDeliverables(core).present([{ path: '图.png' }], {
      turnId: answer.turnId,
      meetingId: meeting.id,
      callId: call.callId,
    });
    assert.equal(replay.files[0].path, file.path);
    assert.equal(core.messages.get(answer.id).deliverables.length, 2);
    const fork = core.meetings.fork(meeting.id, { atMessageId: answer.id });
    const forkAnswer = core.messages.list(fork.id).messages.at(-1);
    assert.equal(forkAnswer.deliverables.length, 2);
    assert.equal(forkAnswer.deliverables[0].path, file.path);
    assert.notEqual(forkAnswer.deliverables[0].id, file.id);
    core.close();
    core = await createCore({ dataRoot: dir });
    assert.deepEqual(await readFile(core.messages.get(answer.id).deliverables[0].path), image);
    const opened = [];
    server = createAppServer({
      core,
      token: 'test',
      deliverables: {
        open: async (target) => {
          opened.push(target);
        },
      },
    });
    const url = await server.listen();
    const content = await fetch(`${url}/api/deliverables/${file.id}/content?token=test`);
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await content.arrayBuffer()), image);
    const response = await fetch(`${url}/api/deliverables/${report.id}/open`, {
      method: 'POST',
      headers: { authorization: 'Bearer test' },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(opened, [report.path]);
  } finally {
    await server?.close();
    core.close();
    await cleanup();
  }
});

test('missing presented files fail without cards or durable records', async () => {
  const { dir, cleanup } = await tempDir('deliverables-missing');
  const core = await createCore({ dataRoot: dir });
  try {
    const meeting = core.meetings.create({
      title: '缺失文件',
      members: [{ participantId: 'agent_main' }],
    });
    const tools = createTools(core);
    const runtime = createScriptedRuntime({
      script: async function* ({ call }) {
        await call('workspace_present', { files: [{ path: 'missing.png' }] });
        yield '不应成功';
      },
    });
    const runner = createTurnRunner({
      core,
      runtime,
      runtimeName: 'scripted',
      tools,
      contextAssembly: createContextAssembly({
        core,
        defaultModel: async () => ({ provider: 'test', model: 'test' }),
      }),
    });
    await runner.run({ meetingId: meeting.id, participantId: 'agent_main' });
    const answer = core.messages.list(meeting.id).messages.at(-1);
    assert.equal(answer.status, 'failed');
    assert.deepEqual(answer.deliverables, []);
    assert.equal(core.turns.toolCalls(answer.turnId)[0].status, 'failed');
  } finally {
    core.close();
    await cleanup();
  }
});
