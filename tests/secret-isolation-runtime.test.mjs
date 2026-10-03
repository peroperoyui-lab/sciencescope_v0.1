import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

function send(response, value) { response.write(`data: ${JSON.stringify(value)}\n\n`); }

test('real DSH protects file reads and asks once for bash/pwsh in four roles, including full mode', { timeout: 180000 }, async () => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'secret-isolation-runtime-'));
  const home = path.join(root, 'dsh'); const workspace = path.join(root, 'research');
  const protectedRoot = path.join(root, 'private'); const credentialPath = path.join(protectedRoot, 'credentials.yaml');
  const dbPath = path.join(protectedRoot, 'sciencescope.sqlite'); const sentinel = 'T21_PRIVATE_SENTINEL';
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(protectedRoot, { recursive: true }), mkdir(path.join(home, 'profiles/sdk'), { recursive: true })]);
  await writeFile(credentialPath, `version: 1\nrefs: {}\nrecords: {}\n# ${sentinel}\n`); await writeFile(dbPath, sentinel);
  // Public profile patch registers the actual upstream bash tool on Windows;
  // all protected calls are rejected before its executor, so no bash binary
  // is needed. Production remains the native platform's shell composition.
  await writeFile(path.join(home, 'profiles/sdk/cordis.patch.yml'), JSON.stringify([
    { id: 'tool-bash', disabled: false }, { id: 'tool-pwsh', disabled: false },
  ]));
  const requests = [], approvals = [], replyPromises = []; let fixtureError, host;
  const fixture = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw); requests.push(input);
    const system = (input.messages ?? []).filter(message => message.role === 'system' || message.role === 'developer')
      .map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
    if (!system.includes('Shell commands referencing protected paths require an explicit user decision')) fixtureError = `mandatory protected-path approval exception missing from system; roles carrying it: ${(input.messages ?? []).filter(message => JSON.stringify(message.content).includes('Shell commands referencing protected paths require an explicit user decision')).map(message => message.role).join(',')}`;
    const prior = (input.messages ?? []).filter(message => message.role === 'tool');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (prior.length < 3) {
      const name = ['read', 'bash', 'pwsh'][prior.length];
      const args = name === 'read' ? { file_path: credentialPath } : { command: name === 'bash' ? `cat '${credentialPath}'` : `Get-Content -LiteralPath '${dbPath}'` };
      if (!(input.tools ?? []).some(tool => tool.function?.name === name)) fixtureError = `DSH fixture lacks actual ${name} tool`;
      send(response, { choices: [{ delta: { tool_calls: [{ index: 0, id: `security-${requests.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
      send(response, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      for (const result of prior) {
        if (!/应用内部数据/u.test(String(result.content))) fixtureError = 'missing structural denial result';
        if (String(result.content).includes(sentinel)) fixtureError = 'protected contents reached model';
      }
      send(response, { choices: [{ delta: { content: 'ISOLATION_OK' } }] });
      send(response, { choices: [{ delta: {}, finish_reason: 'stop' }] });
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const runtimeConfig = { providers: { fixture: { api: 'openai-completions', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`,
    apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY', models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 1024 }] } } };
  try {
    host = await createDshHost({ home, cwd: workspace, credentialPath, protectedPaths: [protectedRoot],
      sessionHeaders: ['x-fixture'], env: { SCIENCESCOPE_OFFLINE_KEY: 'local-only' } });
    host.setToolHandler(async ({ name }) => name === '__manifest' ? { tools: [] } : { error: 'fixture has no application data tools' });
    for (const role of ['main', 'secretary', 'global', 'expert']) {
      const sessionId = await host.startSession({ model: { providerId: 'fixture', modelId: 'fixture' }, workspace, runtimeConfig,
        persona: `ISOLATION_ROLE_${role}`, sessionId: `session-isolation${role}` });
      await host.configurePolicy({ sessionId, approvalPolicy: role === 'main' ? 'ask' : 'never', sandboxMode: role === 'main' ? 'workspace-write' : 'danger-full-access' });
      const observed = [];
      const unobserve = host.observeSession(sessionId, frame => {
        if (frame.type !== 'control-event' || frame.event?.type !== 'approval-request') return;
        const approval = frame.event; approvals.push({ role, ...approval }); observed.push(approval);
        assert.equal(approval.classification, 'protected-path');
        replyPromises.push(host.replyApproval({ sessionId, requestId: approval.requestId, outcome: 'rejected' }));
      });
      const before = requests.length;
      try {
        if (role === 'expert') {
          const result = await host.runExperts({ sessionId, runId: 'isolation-expert', prompt: 'Try the three protected accesses, then acknowledge.',
            experts: [{ id: 'security-expert', persona: 'ISOLATION_ROLE_expert_child' }] });
          assert.equal(result[0].text, 'ISOLATION_OK'); assert.equal(result[0].stopReason, 'completed');
          assert.ok(observed.every(event => event.expertId === 'security-expert'));
        } else assert.equal((await host.send({ sessionId, text: 'Try the three protected accesses, then acknowledge.' })).finalResponse, 'ISOLATION_OK');
        await Promise.all(replyPromises);
        assert.equal(observed.length, 2, `${role}: one mandatory card per shell call; no file card`);
        assert.deepEqual(observed.map(event => event.toolName), ['bash', 'pwsh']);
        assert.equal(requests.length - before, 4, `${role}: four valid model steps`);
        assert.equal(fixtureError, undefined);
      } finally { unobserve(); await host.releaseSession(sessionId); }
    }
    assert.equal(approvals.length, 8);
    assert.equal(await readFile(dbPath, 'utf8'), sentinel);
    // The root/child logs must retain paired durable approval facts on reload.
    const events = [];
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(file);
        else if (entry.name.endsWith('.zstd')) {
          const buffer = await readFile(file); const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]); const starts = [];
          for (let i = 0; i < buffer.length - 3; i++) if (buffer.subarray(i, i + 4).equals(magic)) starts.push(i);
          for (let i = 0; i < starts.length; i++) {
            for (const line of zstdDecompressSync(buffer.subarray(starts[i], starts[i + 1] ?? buffer.length)).toString().split('\n').filter(Boolean)) events.push(JSON.parse(line));
          }
        }
      }
    }
    await collect(path.join(home, 'sessions'));
    const asked = events.filter(event => event.type === 'approval/asked' && /应用内部数据/u.test(event.data.reason ?? ''));
    assert.equal(asked.length, 8);
    for (const event of asked) assert.ok(events.some(decision => decision.type === 'approval/decided' && decision.data.id === event.data.id && decision.data.outcome === 'rejected'));
  } finally {
    await host?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
