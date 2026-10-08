// Real DSH and its shell, with a local scripted model. No Python download/API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { tempDir } from '../../testing.js';
import { createDshRuntime } from './runtime.js';
import { runtimeProviderConfig } from '../../services/providers.js';

test('DSH shell receives per-session environment and resumes history after an environment change', async () => {
  const { dir, cleanup } = await tempDir('python-dsh');
  const workspace = path.join(dir, 'workspace');
  await mkdir(workspace);
  const requests = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    requests.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish = null) =>
      res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
    if (body.messages.at(-1).role === 'tool') {
      chunk({ content: JSON.stringify(body.messages.at(-1).content) });
      chunk({}, 'stop');
    } else {
      const command =
        process.platform === 'win32'
          ? '$env:VIRTUAL_ENV; $env:PATH'
          : 'printf "%s\\n%s" "$VIRTUAL_ENV" "$PATH"';
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'env-' + requests.length,
            type: 'function',
            function: {
              name: process.platform === 'win32' ? 'pwsh' : 'bash',
              arguments: JSON.stringify({
                command,
                description: 'Inspect selected Python environment',
              }),
            },
          },
        ],
      });
      chunk({}, 'tool_calls');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const runtime = createDshRuntime({
    home: path.join(dir, 'runtime'),
    credentialsPath: path.join(dir, 'secret.yaml'),
    providerConfig: async () =>
      runtimeProviderConfig([
        {
          id: 'fixture',
          baseUrl: `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/v1`,
          api: 'openai-completions',
          keyRef: 'SCIENCESCOPE_FIXTURE_KEY',
          models: [{ id: 'fixture' }],
        },
      ]),
    extraEnv: { SCIENCESCOPE_FIXTURE_KEY: 'fixture' },
  });
  const options = {
    model: { provider: 'fixture', model: 'fixture' },
    workFolder: workspace,
    instructions: 'Inspect environment using bash.',
    tools: [],
    onToolCall: async () => ({}),
  };
  const originalPath = process.env.PATH,
    originalVirtual = process.env.VIRTUAL_ENV;
  try {
    const firstEnv = {
      PATH: path.join(dir, 'first') + path.delimiter + process.env.PATH,
      VIRTUAL_ENV: path.join(dir, 'first'),
    };
    const id = await runtime.startSession({ ...options, env: firstEnv });
    const first = [];
    assert.equal(
      (await runtime.send(id, 'FIRST_ENV_MARKER', (event) => first.push(event))).stopReason,
      'completed',
    );
    assert.ok(
      first.some(
        (event) =>
          event.type === 'tool-result' &&
          !event.isError &&
          JSON.stringify(event.result).includes('first'),
      ),
    );
    const secondEnv = {
      PATH: path.join(dir, 'second') + path.delimiter + process.env.PATH,
      VIRTUAL_ENV: path.join(dir, 'second'),
    };
    assert.equal(await runtime.startSession({ ...options, sessionId: id, env: secondEnv }), id);
    const second = [];
    assert.equal(
      (await runtime.send(id, 'SECOND_ENV_MARKER', (event) => second.push(event))).stopReason,
      'completed',
    );
    assert.ok(
      second.some(
        (event) =>
          event.type === 'tool-result' &&
          !event.isError &&
          JSON.stringify(event.result).includes('second'),
      ),
    );
    assert.ok(JSON.stringify(requests.at(-1)).includes('FIRST_ENV_MARKER'));
    assert.ok(process.env.PATH === originalPath && process.env.VIRTUAL_ENV === originalVirtual);
  } finally {
    await runtime.close();
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
  }
});
