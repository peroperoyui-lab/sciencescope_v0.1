import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createCore } from '../core/index.js';
import { tempDir } from '../testing.js';
import { createAppServer } from '../server/server.js';
import { createModelCatalog } from '../runtime/pi/catalog.js';
import { createPiRuntime } from '../runtime/pi/runtime.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { sessionStore } from '../runtime/pi/sessions.js';
import { createTurnRunner } from './turn-runner.js';
import { createTools } from './tools.js';
import { createContextAssembly } from './context-assembly.js';
import { providerSettings } from './provider-settings.js';
import { readCredentials, saveKeys, discoverModels } from './providers.js';
import { dataPaths } from '../core/paths.js';

test('provider API stores references, sends header values and removes deleted credentials', async () => {
  const { dir, cleanup } = await tempDir('provider-headers');
  const core = await createCore({ dataRoot: dir, settingsResource: providerSettings(dir) });
  const received = [];
  const remote = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    received.push({ url: request.url, value: request.headers['x-api-key'] });
    if (request.url === '/models') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    } else {
      response.setHeader('content-type', 'text/event-stream');
      response.end(
        [
          {
            choices: [
              { index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null },
            ],
          },
          { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
        ]
          .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
          .join('') + 'data: [DONE]\n\n',
      );
    }
  });
  await new Promise((resolve) => remote.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = remote.address();
  assert.ok(address && typeof address !== 'string');
  const provider = {
    id: 'custom',
    name: '测试服务商',
    baseUrl: `http://127.0.0.1:${address.port}`,
    api: 'openai-completions',
    keyRef: 'custom',
    models: [{ id: 'test-model' }],
    headers: { 'X-Api-Key': 'FAKE_HEADER_INITIAL' },
  };
  const server = createAppServer({ core, token: 'provider-test' });
  const url = await server.listen();
  const catalog = createModelCatalog({
    paths: core.paths,
    providers: async () =>
      (await core.workspace.read({ resource: 'settings', key: 'app' })).value.providers,
  });
  const runtime = createPiRuntime({ home: core.paths.runtime, logs: core.paths.logs, catalog });
  const call = async (method, route, body) => {
    const response = await fetch(url + route, {
      method,
      headers: { authorization: 'Bearer provider-test', 'content-type': 'application/json' },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    let saved = await call('PATCH', '/api/settings', { providers: [provider] });
    const reference = { keyRef: 'provider.custom.headers.X-Api-Key' };
    assert.deepEqual(saved.providers[0].headers['X-Api-Key'], reference);
    assert.doesNotMatch(await readFile(core.paths.settings, 'utf8'), /FAKE_HEADER_INITIAL/);
    saved = await call('PATCH', '/api/settings', { providers: saved.providers });
    assert.deepEqual(saved.providers[0].headers['X-Api-Key'], reference);
    assert.deepEqual((await call('GET', '/api/settings')).providers, saved.providers);
    await saveKeys(core.paths, { custom: 'FAKE_API_KEY' });
    assert.deepEqual((await call('POST', '/api/providers/discover', saved.providers[0])).models, [
      'test-model',
    ]);
    const session = await runtime.startSession({
      model: { provider: 'custom', model: 'test-model' },
      workFolder: dir,
      instructions: 'Reply OK',
      tools: [],
      noTools: true,
      onToolCall: async () => null,
    });
    assert.equal((await runtime.send(session, 'OK?', () => {})).stopReason, 'completed');
    assert.deepEqual(
      received.map((entry) => entry.value),
      ['FAKE_HEADER_INITIAL', 'FAKE_HEADER_INITIAL'],
    );
    await saveKeys(core.paths, { [reference.keyRef]: 'FAKE_UPDATED_REQUEST_HEADER' });
    assert.equal((await runtime.send(session, 'Again?', () => {})).stopReason, 'completed');
    assert.equal(received.at(-1).value, 'FAKE_UPDATED_REQUEST_HEADER');
    await saveKeys(core.paths, {}, [reference.keyRef]);
    const failed = await runtime.send(session, 'Missing header?', () => {});
    assert.equal(failed.stopReason, 'failed');
    assert.equal(failed.error, '请重新填写 测试服务商 的 X-Api-Key。');
    await assert.rejects(discoverModels(core.paths, saved.providers[0]), {
      code: 'PROVIDER_CREDENTIAL',
      message: '请重新填写 测试服务商 的 X-Api-Key。',
    });
    await assert.rejects(catalog.resolve({ provider: 'custom', model: 'test-model' }), {
      code: 'PROVIDER_CREDENTIAL',
    });
    await call('PATCH', '/api/settings', {
      providers: [{ ...provider, headers: { 'X-Api-Key': 'FAKE_REPLACEMENT' } }],
    });
    await call('PATCH', '/api/settings', { providers: [{ ...provider, headers: {} }] });
    assert.equal((await readCredentials(core.paths)).refs[reference.keyRef], undefined);
    await call('PATCH', '/api/settings', { providers: [provider] });
    await call('PATCH', '/api/settings', { providers: [] });
    assert.equal((await readCredentials(core.paths)).refs[reference.keyRef], undefined);
    assert.equal((await readCredentials(core.paths)).refs.custom, 'FAKE_API_KEY');
    const added = await core.workspace.edit({
      resource: 'settings',
      key: 'app',
      op: 'patch',
      args: { changes: { providers: [provider] } },
    });
    await core.workspace.undo(added.revisionId);
    assert.equal((await readCredentials(core.paths)).refs[reference.keyRef], undefined);
  } finally {
    await runtime.close();
    await server.close();
    await new Promise((resolve) => remote.close(resolve));
    core.close();
    await cleanup();
  }
});

test('CLI settings edits and output use the same header credential boundary', async () => {
  const { dir, cleanup } = await tempDir('provider-header-cli');
  const execute = promisify(execFile);
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url));
  try {
    const { stdout } = await execute(
      process.execPath,
      [
        cli,
        '--data',
        dir,
        'edit',
        'settings',
        'app',
        'patch',
        JSON.stringify({
          changes: {
            providers: [{ id: 'cli-provider', headers: { 'X-Token': 'FAKE_CLI_HEADER' } }],
          },
        }),
      ],
      { windowsHide: true },
    );
    assert.doesNotMatch(stdout, /FAKE_CLI_HEADER/);
    assert.deepEqual(JSON.parse(stdout).value.providers[0].headers['X-Token'], {
      keyRef: 'provider.cli-provider.headers.X-Token',
    });
    const paths = dataPaths(dir);
    assert.doesNotMatch(await readFile(paths.settings, 'utf8'), /FAKE_CLI_HEADER/);
    assert.equal(
      (await readCredentials(paths)).refs['provider.cli-provider.headers.X-Token'],
      'FAKE_CLI_HEADER',
    );
  } finally {
    await cleanup();
  }
});

test('AI workspace_edit executes plaintext headers but persists only references and redacted receipts', async () => {
  const { dir, cleanup } = await tempDir('provider-header-tool');
  const core = await createCore({ dataRoot: dir, settingsResource: providerSettings(dir) });
  const args = {
    resource: 'settings',
    key: 'app',
    op: 'patch',
    args: {
      changes: {
        providers: [
          {
            id: 'tool-provider',
            headers: { 'X-Token': 'FAKE_TOOL_HEADER' },
          },
        ],
      },
    },
  };
  const runtime = createScriptedRuntime({
    script: async function* ({ call }) {
      await call('workspace_edit', args);
      yield 'Saved';
    },
  });
  const runner = createTurnRunner({
    core,
    runtime,
    runtimeName: 'scripted',
    tools: createTools(core),
    contextAssembly: createContextAssembly({
      core,
      defaultModel: async () => ({ provider: 'test', model: 'test' }),
    }),
  });
  try {
    const meeting = core.meetings.create({
      title: 'Headers',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const message = core.messages.post({
      meetingId: meeting.id,
      authorId: 'person_user',
      text: 'Configure provider',
    });
    const result = await runner.run({
      meetingId: meeting.id,
      participantId: 'agent_main',
      triggerMessageId: message.id,
    });
    assert.equal(result.status, 'done');
    assert.equal(
      (await readCredentials(core.paths)).refs['provider.tool-provider.headers.X-Token'],
      'FAKE_TOOL_HEADER',
    );
    const call = core.turns.toolCalls(result.id).find((entry) => entry.name === 'workspace_edit');
    assert.equal(call.args.args.changes.providers[0].headers['X-Token'], '<已移除>');
    assert.deepEqual(call.result.value.providers[0].headers['X-Token'], {
      keyRef: 'provider.tool-provider.headers.X-Token',
    });
    for (const table of ['revisions', 'resource_snapshots', 'tool_calls', 'events'])
      assert.equal(
        JSON.stringify(core.db.prepare(`SELECT * FROM ${table}`).all()).includes(
          'FAKE_TOOL_HEADER',
        ),
        false,
      );
    const store = sessionStore(core.paths.runtime);
    const messages = [
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', name: 'workspace_edit', arguments: args },
          {
            type: 'toolCall',
            name: 'another_tool',
            arguments: { headers: { ordinary: 'unchanged' } },
          },
        ],
      },
    ];
    await store.write('provider-tool', messages);
    assert.equal(
      JSON.stringify(await store.read('provider-tool')).includes('FAKE_TOOL_HEADER'),
      false,
    );
    assert.equal(
      messages[0].content[0].arguments.args.changes.providers[0].headers['X-Token'],
      'FAKE_TOOL_HEADER',
    );
    assert.deepEqual((await store.read('provider-tool'))[0].content[1], messages[0].content[1]);
  } finally {
    await runtime.close();
    core.close();
    await cleanup();
  }
});

test('external settings edits prepare headers before GET, snapshots and unrelated patches', async () => {
  const { dir, cleanup } = await tempDir('provider-header-external');
  const core = await createCore({ dataRoot: dir, settingsResource: providerSettings(dir) });
  const server = createAppServer({ core, token: 'external-test' });
  const url = await server.listen();
  const target = { resource: 'settings', key: 'app' };
  const reference = 'provider.external.headers.X-Token';
  const bio = JSON.stringify({
    baseUrl: 'https://example.invalid',
    api: 'example',
    headers: { Example: 'PUBLIC_EXAMPLE' },
  });
  try {
    await core.workspace.edit({
      ...target,
      op: 'patch',
      args: {
        changes: {
          profile: { bio },
          providers: [{ id: 'external', headers: { 'X-Token': 'FAKE_ORIGINAL_EXTERNAL' } }],
        },
      },
    });
    let value = JSON.parse(await readFile(core.paths.settings, 'utf8'));
    value.providers[0].headers['X-Token'] = 'FAKE_EDITED_EXTERNAL';
    await writeFile(core.paths.settings, JSON.stringify(value));
    const response = await fetch(url + '/api/settings', {
      headers: { authorization: 'Bearer external-test' },
    });
    const saved = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(saved.providers[0].headers['X-Token'], { keyRef: reference });
    assert.equal(saved.profile.bio, bio);
    assert.equal((await readCredentials(core.paths)).refs[reference], 'FAKE_EDITED_EXTERNAL');
    await core.workspace.captureSnapshot(target);
    value = JSON.parse(await readFile(core.paths.settings, 'utf8'));
    value.providers[0].headers = {};
    await writeFile(core.paths.settings, JSON.stringify(value));
    await core.workspace.captureSnapshot(target);
    assert.equal((await readCredentials(core.paths)).refs[reference], undefined);
    value.providers[0].headers['X-Token'] = 'FAKE_BEFORE_UNRELATED_PATCH';
    await writeFile(core.paths.settings, JSON.stringify(value));
    await core.workspace.edit({
      ...target,
      op: 'patch',
      args: { changes: { profile: { name: 'Other edit' } } },
    });
    assert.equal(
      (await readCredentials(core.paths)).refs[reference],
      'FAKE_BEFORE_UNRELATED_PATCH',
    );
    assert.equal((await core.workspace.read(target)).value.profile.bio, bio);
    for (const table of ['revisions', 'resource_snapshots'])
      assert.doesNotMatch(
        JSON.stringify(core.db.prepare(`SELECT * FROM ${table}`).all()),
        /FAKE_(?:ORIGINAL_EXTERNAL|EDITED_EXTERNAL|BEFORE_UNRELATED_PATCH)/,
      );
    assert.doesNotMatch(await readFile(core.paths.settings, 'utf8'), /FAKE_/);
  } finally {
    await server.close();
    core.close();
    await cleanup();
  }
});
