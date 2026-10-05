// End to end with real DSH: the user posts in a meeting over the HTTP API, the
// main expert answers through a local fixture model, uses workspace_edit, and
// the change lands in the project's files as a revision by that AI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { tempDir } from './testing.js';

const TOKEN = 'e2e-token';
const textOf = (content) =>
  typeof content === 'string' ? content : (content ?? []).map((part) => part?.text ?? '').join('');

function startFixtureModel() {
  const server = createServer(async (req, res) => {
    assert.equal(req.headers['x-test-session'], 'r2-session');
    assert.equal(req.headers.authorization, 'Bearer fixture');
    let body = '';
    for await (const chunk of req) body += chunk;
    const { messages } = JSON.parse(body);
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => textOf(m.content))
      .join('\n');
    const lastUser = messages.filter((m) => m.role === 'user').map((m) => textOf(m.content));
    const asksForPlan = lastUser.some((text) => text.includes('PLAN'));
    const afterTool = messages.at(-1)?.role === 'tool';
    const chunk = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (asksForPlan && !afterTool) {
      const projectId = /项目：.*?（id：(prj_[a-z0-9]+)）/.exec(system)?.[1];
      chunk({ content: '我先记到计划里。' });
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_plan',
            type: 'function',
            function: {
              name: 'workspace_edit',
              arguments: JSON.stringify({
                resource: 'plans',
                key: projectId,
                op: 'append',
                args: { text: '- [ ] 清洗面板数据' },
              }),
            },
          },
        ],
      });
      chunk({}, 'tool_calls');
    } else if (afterTool) {
      chunk({ content: '已记下。' });
      chunk({}, 'stop');
    } else {
      chunk({ content: system.includes('你是：主专家') ? '你好，我是主专家。' : '身份不明' });
      chunk({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: /** @type {any} */ (server.address()).port }),
    );
  });
}

test('a person posts, the main expert answers through DSH and edits the plan', async () => {
  const { dir, cleanup } = await tempDir('e2e');
  const fixture = await startFixtureModel();
  const app = await createApp({
    dataRoot: dir,
    token: TOKEN,
  });
  const url = await app.listen();
  const call = async (method, route, body) => {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response.json();
  };
  try {
    await call('POST', '/api/providers/keys/SCIENCESCOPE_FIXTURE_KEY', { key: 'fixture' });
    await call('PATCH', '/api/settings', {
      providers: [
        {
          id: 'fixture',
          baseUrl: `http://127.0.0.1:${fixture.port}/v1`,
          api: 'openai-completions',
          keyRef: 'SCIENCESCOPE_FIXTURE_KEY',
          headers: { 'x-test-session': 'r2-session' },
          models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 1024 }],
        },
      ],
      models: { default: { provider: 'fixture', model: 'fixture' } },
    });
    const project = await call('POST', '/api/projects', { name: '气候政策' });
    const meeting = await call('POST', '/api/meetings', {
      projectId: project.id,
      title: '方法讨论',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });

    await call('POST', `/api/meetings/${meeting.id}/messages`, { text: '你好' });
    await app.conductor.idle();
    let page = await call('GET', `/api/meetings/${meeting.id}/messages`);
    assert.deepEqual(
      page.messages.map((m) => [m.authorId, m.text, m.status]),
      [
        ['person_user', '你好', 'done'],
        ['agent_main', '你好，我是主专家。', 'done'],
      ],
    );

    await call('POST', `/api/meetings/${meeting.id}/messages`, { text: '请把 PLAN 记下' });
    await app.conductor.idle();
    page = await call('GET', `/api/meetings/${meeting.id}/messages`);
    const answer = page.messages.at(-1);
    assert.equal(answer.text, '已记下。');

    const plans = await call('GET', `/api/resources/plans?key=${project.id}`);
    assert.equal(plans.text, '- [ ] 清洗面板数据');
    const [revision] = await call('GET', `/api/revisions?resource=plans&key=${project.id}`);
    assert.equal(revision.actorId, 'agent_main');
    const turn = await call('GET', `/api/turns/${answer.turnId}`);
    assert.equal(turn.toolCalls[0].name, 'workspace_edit');
    assert.equal(turn.toolCalls[0].preamble, '我先记到计划里。');
  } finally {
    await app.close();
    fixture.server.close();
    await cleanup();
  }
});
