import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { prepareCredentialIsolation, getProtectedCredentialPaths } from '../adapters/runtime-dsh/credential-isolation.mjs';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';
import { createDshWebHost } from '../adapters/runtime-dsh/web-host.mjs';
import { filterProviderSecretEnv } from '../adapters/runtime-dsh/session-env.mjs';

async function fixture() {
  const base = path.resolve('.sciencescope-local/temp');
  await mkdir(base, { recursive: true });
  return mkdtemp(path.join(base, 'credential-isolation-'));
}

async function assertPrivate(filename, directory = false) {
  if (process.platform !== 'win32') { assert.equal((await stat(filename)).mode & 0o777, directory ? 0o700 : 0o600); return; }
  const script = '$a=Get-Acl -LiteralPath $env:SCIENCESCOPE_TEST_ACL_PATH; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{protected=$a.AreAccessRulesProtected; owner=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; allowed=@($a.Access|Where-Object {$_.AccessControlType -eq "Allow"}|ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value})}|ConvertTo-Json -Compress';
  const { stdout } = await promisify(execFile)('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, env: { ...process.env, SCIENCESCOPE_TEST_ACL_PATH: filename } });
  const acl = JSON.parse(stdout);
  if (directory) assert.equal(acl.protected, true);
  assert.deepEqual(acl.allowed, [acl.owner]);
}

test('credential migration preserves refs/records, concurrent boot, restart and atomic replacement permissions', async () => {
  const root = await fixture(); const home = path.join(root, 'dsh'); const destination = path.join(root, 'secret', 'credentials.yaml');
  await mkdir(home);
  const legacy = path.join(home, '.credentials.yaml');
  const original = 'version: 1\nrefs:\n  SAVED_FIXTURE: migration-fixture\nrecords:\n  llm-pi-ai/fixture:\n    kind: grant\n    payload:\n      access: fixture-grant\n';
  await writeFile(legacy, original);
  try {
    const paths = await Promise.all([prepareCredentialIsolation({ home, credentialPath: destination }), prepareCredentialIsolation({ home, credentialPath: destination })]);
    assert.deepEqual(paths, [destination, destination]);
    await assert.rejects(readFile(legacy), { code: 'ENOENT' });
    assert.equal(await readFile(destination, 'utf8'), original);
    await assertPrivate(path.dirname(destination), true); await assertPrivate(destination);
    const replacement = path.join(path.dirname(destination), 'credential-fixture-replacement.tmp');
    await writeFile(replacement, `${original}# replacement\n`, { mode: 0o600, flag: 'wx' });
    await rename(replacement, destination);
    await assertPrivate(destination);
    await prepareCredentialIsolation({ home, credentialPath: destination });
    assert.match(await readFile(destination, 'utf8'), /replacement/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('migration recovers missing entries but preserves conflicting or malformed original stores without key diagnostics', async () => {
  const root = await fixture();
  try {
    const [destination, legacy] = getProtectedCredentialPaths({ home: root });
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, 'version: 1\nrefs:\n  NEW: new-fixture\n');
    await writeFile(legacy, 'LEGACY: legacy-fixture\n');
    await prepareCredentialIsolation({ home: root });
    assert.match(await readFile(destination, 'utf8'), /NEW: new-fixture/u);
    assert.match(await readFile(destination, 'utf8'), /LEGACY: legacy-fixture/u);
    await writeFile(legacy, 'version: 1\nrefs:\n  NEW: conflicting-private-sentinel\n');
    const current = await readFile(destination, 'utf8');
    await assert.rejects(prepareCredentialIsolation({ home: root }), error => error.code === 'CREDENTIAL_MIGRATION_CONFLICT' && !error.message.includes('conflicting-private-sentinel'));
    assert.equal(await readFile(destination, 'utf8'), current); assert.match(await readFile(legacy, 'utf8'), /conflicting-private-sentinel/u);
    await writeFile(legacy, 'refs: [malformed-private-sentinel\n');
    await assert.rejects(prepareCredentialIsolation({ home: root }), error => error.code === 'CREDENTIAL_INVALID_DOCUMENT' && !error.message.includes('malformed-private-sentinel'));
    assert.equal(await readFile(destination, 'utf8'), current); assert.match(await readFile(legacy, 'utf8'), /malformed-private-sentinel/u);
    await writeFile(destination, '');
    await writeFile(legacy, 'version: 1\nrefs:\n  RECOVERED: empty-store-fixture\n');
    await prepareCredentialIsolation({ home: root });
    assert.match(await readFile(destination, 'utf8'), /version: 1/u);
    assert.match(await readFile(destination, 'utf8'), /RECOVERED: empty-store-fixture/u);
    await assert.rejects(readFile(legacy), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inherited provider keys and common secret variables are filtered case-insensitively without changing host env', () => {
  const base = { K: 'fixture-private', openai_api_key: 'fixture-private', AWS_SECRET_ACCESS_KEY: 'fixture-private', GH_TOKEN: 'fixture-private', DB_PASSWORD: 'fixture-private', PATH: 'path', UV_CACHE_DIR: 'cache', SCIENCESCOPE_STREAM_TOKEN: 'bridge' };
  const result = filterProviderSecretEnv(base, { providerKeyEnv: ['k'], allowedProviderKeyEnv: ['SCIENCESCOPE_STREAM_TOKEN'] });
  assert.deepEqual(result, { PATH: 'path', UV_CACHE_DIR: 'cache', SCIENCESCOPE_STREAM_TOKEN: 'bridge' });
  assert.equal(base.K, 'fixture-private');
});

test('real SDK and web profiles share migrated/saved credentials while shell receives neither saved nor dotenv keys', { timeout: 90000 }, async () => {
  const root = await fixture(); const home = path.join(root, 'dsh'); const workspace = path.join(root, 'workspace'); const credentialPath = path.join(root, 'secret', 'credentials.yaml');
  await mkdir(home); await mkdir(workspace);
  const ref = 'SCIENCESCOPE_PROVIDER_SAVED';
  const saved = 'only-fixture-provider-sentinel'; const capturedHeaders = []; let host; let web;
  await writeFile(path.join(home, '.credentials.yaml'), `version: 1\nrefs:\n  ${ref}: ${saved}\n`);
  await writeFile(path.join(workspace, '.env'), 'K=dotenv-private-fixture\nDOTENV_API_KEY=dotenv-common-private-fixture\n');
  const fixtureServer = createServer(async (request, response) => {
    capturedHeaders.push(request.headers.authorization);
    let body = ''; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body); const tool = input.messages?.find(message => message.role === 'tool');
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    if (tool) {
      assert.doesNotMatch(JSON.stringify(tool.content), /only-fixture-provider-sentinel|dotenv-private-fixture|dotenv-common-private-fixture/u);
      assert.match(JSON.stringify(tool.content), /ENV_EMPTY/u);
      response.end('data: {"choices":[{"delta":{"content":"CREDENTIAL_ISOLATION_OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'); return;
    }
    const shell = input.tools.find(item => item.function.name === (process.platform === 'win32' ? 'pwsh' : 'bash'));
    assert.ok(shell);
    const command = process.platform === 'win32' ? `if ($env:${ref} -or $env:K -or $env:DOTENV_API_KEY) { Write-Output 'ENV_LEAK' } else { Write-Output 'ENV_EMPTY' }` : `if [ -n "$${ref}$K$DOTENV_API_KEY" ]; then printf ENV_LEAK; else printf ENV_EMPTY; fi`;
    const args = { command, description: 'Check credential environment isolation' };
    response.end(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'check-env', type: 'function', function: { name: shell.function.name, arguments: JSON.stringify(args) } }] } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
  try {
    const options = { home, cwd: workspace, credentialPath, protectedPaths: [home, path.dirname(credentialPath)] };
    [host, web] = await Promise.all([createDshHost({ ...options, sessionHeaders: ['x-test'] }), createDshWebHost(options)]);
    const runtimeConfig = { providers: { fixture: { api: 'openai-completions', baseURL: `http://127.0.0.1:${fixtureServer.address().port}/v1`, apiKeyEnv: ref, models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 256 }] }, dotenv: { api: 'openai-completions', baseURL: 'http://127.0.0.1:1/v1', apiKeyEnv: 'K', models: [] } } };
    const credentialInfo = await web.call('credentials', 'describe', { refs: [ref] });
    assert.equal(credentialInfo[ref].configured, true);
    await web.call('credentials', 'set', { ref, value: saved });
    await assertPrivate(credentialPath);
    const sessionId = await host.startSession({ model: { providerId: 'fixture', modelId: 'fixture' }, workspace, runtimeConfig });
    await host.configurePolicy({ sessionId, approvalPolicy: 'never', sandboxMode: 'danger-full-access' });
    const result = await host.send({ sessionId, text: 'Check environment isolation.' });
    assert.equal(result.finalResponse, 'CREDENTIAL_ISOLATION_OK');
    assert.ok(capturedHeaders.length >= 2); assert.ok(capturedHeaders.every(header => header === `Bearer ${saved}`));
    await assert.rejects(readFile(path.join(home, '.credentials.yaml')), { code: 'ENOENT' });
  } finally {
    await host?.close(); await web?.close(); fixtureServer.closeAllConnections(); await new Promise(resolve => fixtureServer.close(resolve)); await rm(root, { recursive: true, force: true });
  }
});
