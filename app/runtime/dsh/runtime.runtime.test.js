// Real DSH processes against a local fixture model (OpenAI-compatible
// streaming). No network, no real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { tempDir } from '../../testing.js';
import { runtimeProviderConfig } from '../../services/providers.js';
import { createDshRuntime } from './runtime.js';

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text ?? '').join('')
      : '';

/** A fixture model: says hello, calls a tool when asked, and reports what it saw. */
function startFixtureModel() {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    const all = input.messages.map((message) => textOf(message.content)).join('\n');
    const lastUser = input.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content));
    const asked = lastUser.findLast((text) => /TOOL|HELLO|AGAIN/.test(text)) ?? '';
    const sawToolResult = input.messages.at(-1)?.role === 'tool';
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
    if (asked.includes('TOOL') && !sawToolResult) {
      chunk({ content: 'Let me look.' });
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'workspace_read', arguments: '{"target":"overview"}' },
          },
        ],
      });
      chunk({}, 'tool_calls');
    } else if (sawToolResult) {
      chunk({ content: `TOOL_RESULT:${textOf(input.messages.at(-1).content)}` });
      chunk({}, 'stop');
    } else {
      const marker = all.includes('INSTRUCTION_MARKER') ? 'with-instructions' : 'no-instructions';
      const memory = all.includes('HELLO') && asked.includes('AGAIN') ? 'remembers' : 'fresh';
      chunk({ content: `ANSWER ${marker} ${memory}` });
      chunk({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, requests, port: /** @type {any} */ (server.address()).port }),
    );
  });
}

test('a DSH session follows instructions, streams, calls our tools and resumes', async () => {
  const { dir, cleanup } = await tempDir('dsh-runtime');
  const fixture = await startFixtureModel();
  const runtime = createDshRuntime({
    home: path.join(dir, 'runtime'),
    credentialsPath: path.join(dir, 'secret', 'credentials.yaml'),
    providerConfig: async () =>
      runtimeProviderConfig([
        {
          id: 'fixture',
          baseUrl: `http://127.0.0.1:${fixture.port}/v1`,
          api: 'openai-completions',
          keyRef: 'SCIENCESCOPE_FIXTURE_KEY',
          models: [
            { id: 'fixture', contextWindow: 32768, maxTokens: 512 },
            { id: 'fixture-other', contextWindow: 32768, maxTokens: 512 },
          ],
        },
      ]),
    extraEnv: { SCIENCESCOPE_FIXTURE_KEY: 'fixture' },
  });
  const toolCalls = [];
  const options = {
    model: { provider: 'fixture', model: 'fixture' },
    workFolder: dir,
    instructions: 'You are a test participant. INSTRUCTION_MARKER',
    tools: [
      {
        name: 'workspace_read',
        description: 'Read data.',
        parameters: { target: { type: 'string', required: true } },
      },
    ],
    onToolCall: async ({ name, args }) => {
      toolCalls.push({ name, args });
      return { projects: 2 };
    },
  };
  try {
    const sessionId = await runtime.startSession(options);
    const events = [];
    const first = await runtime.send(sessionId, 'HELLO', (event) => events.push(event));
    assert.equal(first.stopReason, 'completed');
    // The context ring's measurement: what the next request would carry.
    assert.ok(first.usage.context.usedTokens > 0);
    const streamed = events
      .filter((event) => event.type === 'text-delta')
      .map((event) => event.delta)
      .join('');
    assert.equal(streamed, 'ANSWER with-instructions fresh');

    const toolEvents = [];
    const second = await runtime.send(sessionId, 'please use a TOOL', (e) => toolEvents.push(e));
    assert.equal(second.stopReason, 'completed');
    assert.deepEqual(toolCalls, [{ name: 'workspace_read', args: { target: 'overview' } }]);
    const types = toolEvents.map((event) => event.type);
    assert.ok(types.includes('tool-call') && types.includes('tool-result'));
    assert.ok(
      toolEvents.some((event) => event.type === 'step-end' && event.hasToolCalls),
      'the step that called the tool is marked',
    );
    assert.match(
      toolEvents
        .filter((e) => e.type === 'text-delta')
        .map((e) => e.delta)
        .join(''),
      /TOOL_RESULT:.*"projects":2/,
    );

    const background = await runtime.startSession({ ...options, tools: [], noTools: true });
    await runtime.send(background, 'HELLO summary only', () => {});
    assert.equal(
      fixture.requests.at(-1).tools?.length ?? 0,
      0,
      'background text-only work does not inherit SDK tools',
    );
    await runtime.release(background);

    await runtime.release(sessionId);
    const resumed = await runtime.startSession({ ...options, sessionId });
    const later = [];
    await runtime.send(resumed, 'AGAIN', (event) => later.push(event));
    assert.match(
      later
        .filter((e) => e.type === 'text-delta')
        .map((e) => e.delta)
        .join(''),
      /remembers/,
      'a resumed session keeps its working memory',
    );
    const changed = await runtime.startSession({
      ...options,
      sessionId,
      model: { provider: 'fixture', model: 'fixture-other' },
    });
    await runtime.send(changed, 'AGAIN after model selection', () => {});
    assert.equal(changed, sessionId);
    assert.equal(fixture.requests.at(-1).model, 'fixture-other');
    assert.ok(
      fixture.requests.at(-1).messages.some((message) => textOf(message.content).includes('HELLO')),
      'changing the model preserves durable history',
    );
  } finally {
    await runtime.close();
    fixture.server.close();
    await cleanup();
  }
});
