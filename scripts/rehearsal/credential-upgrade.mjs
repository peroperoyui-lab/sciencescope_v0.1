#!/usr/bin/env node
/**
 * Historical -> current DSH credential-store rehearsal. No real keys or paid
 * provider requests. Each boot uses a separate process and the same owned home.
 * Run from the checkout after materializing exact 46f4e8f sources:
 *   node scripts/rehearsal/credential-upgrade.mjs
 * Optional: --historical-source <worktree>, --source-metadata <tree.json>
 * All artifacts stay below .sciencescope-local/temp/dot/upgrade/credentials.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { access, mkdir, mkdtemp, readFile, writeFile, stat, readdir, realpath } from 'node:fs/promises';
import * as zlib from 'node:zlib';

const script = fileURLToPath(import.meta.url);
const latestSource = path.resolve(path.dirname(script), '../..');
const outputBase = path.join(latestSource, '.sciencescope-local/temp/dot/upgrade/credentials');
const historicalRevision = '46f4e8f9bc100c70828baff21e15900fbf7a36a9';
const expectedLatestRevision = 'edf02f33ccb720c1e0d9178cb03a11ea28f47052';
const providerId = 'sciencescope-credential-upgrade-fixture';
const modelId = 'offline-credential-upgrade';
const credentialRef = 'SCIENCESCOPE_CREDENTIAL_UPGRADE_FIXTURE_API_KEY';
const resultPrefix = 'CREDENTIAL_REHEARSAL_RESULT ';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const blobSha = value => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');
const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('@deepseek-ai/dsh-credentials-local'))('yaml');
const option = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
async function exists(file) { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function privateFile(file, directory = false) {
  assert.notEqual(process.platform, 'win32', 'This VM rehearsal verifies POSIX modes only; native Windows ACL acceptance remains separate.');
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, directory ? 0o700 : 0o600, 'Credential store has owner-only permissions');
  return mode.toString(8).padStart(4, '0');
}

// The driver never prints or persists child stdout/stderr. Only counts, hashes
// and leak flags are saved, including on failure. Dummy values arrive on stdin,
// never in argv, provider configuration, model prompts or process environment.
async function worker(config) {
  let host, web, step = 'import-profile';
  const result = { passed: false, stage: config.stage, sourceRevision: config.sourceRevision };
  try {
    const { createDshHost } = await import(pathToFileURL(path.join(config.source, 'adapters/runtime-dsh/host.mjs')));
    const { createDshWebHost } = await import(pathToFileURL(path.join(config.source, 'adapters/runtime-dsh/web-host.mjs')));
    const { createProviderService } = await import(pathToFileURL(path.join(config.source, 'adapters/runtime-dsh/provider-service.mjs')));
    const options = { home: config.home, cwd: config.workspace, credentialPath: config.credentialPath, timeoutMs: 60000, sessionHeaders: ['x-upgrade-session'] };
    step = 'boot-web-profile';
    web = await createDshWebHost(options);
    const providers = createProviderService(web.call);
    if (config.seed) {
      step = 'save-historical-credential';
      await providers.saveProvider({ id: providerId, name: 'Synthetic localhost credential upgrade', baseUrl: config.providerUrl, protocol: 'openai-chat-completions', models: [modelId] });
      await web.call('credentials', 'set', { ref: credentialRef, value: config.dummy });
      result.seededThroughHistoricalCredentialsApi = true;
      assert.equal(await exists(path.join(config.home, '.credentials.yaml')), true, 'Historical profile writes the legacy credential store');
      assert.equal(await exists(config.credentialPath), false, 'Historical profile must not write the current isolated store');
    }
    step = 'describe-saved-credential';
    const described = await web.call('credentials', 'describe', { refs: [credentialRef] });
    assert.equal(described[credentialRef]?.configured, true, 'Saved credential remains configured');
    result.savedCredentialConfigured = true;
    const runtimeConfig = await providers.getRuntimeConfig();
    assert.equal(runtimeConfig.providers[providerId].apiKeyEnv, credentialRef, 'Provider keeps the same credential reference');
    assert.equal(runtimeConfig.providers[providerId].baseURL, config.providerUrl, 'Provider settings survive unchanged');
    assert.equal(runtimeConfig.providers[providerId].api, 'openai-completions', 'Provider protocol survives unchanged');
    assert.equal(runtimeConfig.providers[providerId].displayName, 'Synthetic localhost credential upgrade', 'Provider display name survives unchanged');
    assert.deepEqual(runtimeConfig.providers[providerId].models.map(model => typeof model === 'string' ? model : model.id), [modelId], 'Provider model selection survives unchanged');
    assert.equal(JSON.stringify(runtimeConfig).includes(config.dummy), false, 'Provider configuration contains no credential value');
    result.providerReferencePreserved = true;
    result.providerConfigurationPreserved = true;
    result.runtimeConfigHasDummyValue = false;
    step = 'boot-sdk-profile';
    host = await createDshHost(options);
    const sessionId = await host.startSession({ model: { providerId, modelId }, workspace: config.workspace, runtimeConfig, noTools: true, sessionId: config.sessionId });
    assert.equal(sessionId, config.sessionId, 'Use the same durable session identity across the upgrade and restart');
    step = 'authenticated-localhost-turn';
    const events = [];
    const answer = await host.send({ sessionId, text: `Reply with the acknowledgement for ${config.stage}.`, onEvent: event => events.push(event) });
    assert.equal(answer.finalResponse, config.expectedReply, 'Real DSH returns the localhost fixture acknowledgement');
    assert.equal(JSON.stringify(events).includes(config.dummy), false, 'Runtime events contain no credential value');
    result.realDshSdk = true;
    result.realDshWebProfile = true;
    result.sameHome = await realpath(config.home) === config.home;
    result.sameSessionIdentity = sessionId === config.sessionId;
    result.completedEvents = events.filter(event => event.type === 'completed').length;
    result.eventsContainDummyValue = false;
    result.answerMatchesExpectedFixture = true;
    result.passed = true;
  } catch (error) {
    result.failedStep = step;
    result.errorCode = /^[A-Z0-9_]+$/u.test(String(error.code ?? '')) ? error.code : error.name;
    // Never include assertion values, provider errors or raw stack traces.
  } finally {
    try { await host?.close(); await web?.close(); result.profilesClosed = true; }
    catch { result.profilesClosed = false; result.passed = false; }
  }
  process.stdout.write(`${resultPrefix}${JSON.stringify(result)}\n`);
  process.exitCode = result.passed ? 0 : 1;
}

async function sourceProof(source, metadataPath) {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  assert.equal(metadata.truncated, false, 'Historical source tree metadata is complete');
  assert.equal(metadata.sha, 'ce47f2cc8be341b05433a22f371672498fb987c1', 'Metadata belongs to the exact historical revision');
  assert.equal((await runFile('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim(), historicalRevision, 'Historical worktree is pinned to its exact commit');
  const entries = metadata.tree.filter(entry => entry.type === 'blob');
  const required = ['package.json', 'package-lock.json', 'desktop/provider-draft.mjs', ...entries.filter(entry => entry.path.startsWith('adapters/runtime-dsh/') && entry.path.endsWith('.mjs')).map(entry => entry.path)];
  const hashes = {};
  for (const relative of required) {
    const expected = entries.find(entry => entry.path === relative)?.sha;
    assert.ok(expected, `Historical tree has ${relative}`);
    const bytes = await readFile(path.join(source, relative));
    assert.equal(blobSha(bytes), expected, `Historical bytes match exact tree for ${relative}`);
    hashes[relative] = sha256(bytes);
  }
  const oldHost = await readFile(path.join(source, 'adapters/runtime-dsh/host.mjs'), 'utf8');
  assert.equal(oldHost.includes('prepareCredentialIsolation'), false, 'Historical source predates T21 migration');
  return { revision: historicalRevision, treeSha: metadata.sha, verifiedFiles: required.length, beforeT21: true, filesSha256: hashes };
}

// Delivery commits may add verification material while the product remains the
// pinned baseline. Compare the complete tracked working tree, then verify the
// modules this rehearsal actually imports against their pinned Git blob hashes.
export async function latestSourceProof(source = latestSource, baselineRevision = expectedLatestRevision) {
  const checkoutRevision = (await runFile('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
  const changed = (await runFile('git', ['diff', '--name-only', '-z', '--no-renames', baselineRevision, '--'], { cwd: source })).stdout.split('\0').filter(Boolean);
  const allowed = relative => ['scripts/rehearsal/', 'docs/archive/legacy/dot/', 'tests/'].some(prefix => relative.startsWith(prefix));
  assert.equal(changed.every(allowed), true, 'Only rehearsal, report and test differences may follow the pinned product baseline');
  const tree = (await runFile('git', ['ls-tree', '-r', '-z', baselineRevision, '--', 'adapters/runtime-dsh', 'desktop/provider-draft.mjs', 'package.json', 'package-lock.json'], { cwd: source })).stdout.split('\0').filter(Boolean);
  const hashes = {};
  for (const entry of tree) {
    const [metadata, relative] = entry.split('\t');
    const [, type, expected] = metadata.split(' ');
    if (type !== 'blob') continue;
    const bytes = await readFile(path.join(source, relative));
    assert.equal(blobSha(bytes), expected, `Current product bytes match the pinned baseline for ${relative}`);
    hashes[relative] = sha256(bytes);
  }
  assert.ok(Object.keys(hashes).length, 'Pinned product module verification is nonempty');
  return { baselineRevision, checkoutRevision, allowedVerificationDifferencesOnly: true, verificationOnlyChangedPaths: changed, productMatchesPinnedBaseline: true, verifiedFiles: Object.keys(hashes).length, filesSha256: hashes };
}

async function boot(config, logsRoot) {
  const child = spawn(process.execPath, [script, '--worker'], {
    cwd: config.source,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: path.join(logsRoot, 'isolated-os-home'), TEMP: logsRoot, TMP: logsRoot, TMPDIR: logsRoot, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0);
  child.stdout.on('data', data => { stdout = Buffer.concat([stdout, data]); });
  child.stderr.on('data', data => { stderr = Buffer.concat([stderr, data]); });
  child.stdin.end(JSON.stringify(config));
  const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  const outputHasDummyValue = stdout.includes(Buffer.from(config.dummy)) || stderr.includes(Buffer.from(config.dummy));
  const line = stdout.toString('utf8').split('\n').find(value => value.startsWith(resultPrefix));
  const result = line ? JSON.parse(line.slice(resultPrefix.length)) : { passed: false, stage: config.stage, failedStep: 'worker-result-missing' };
  Object.assign(result, { workerExitCode: exitCode, stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr), outputHasDummyValue });
  await writeFile(path.join(logsRoot, `${config.stage}.json`), JSON.stringify(result, null, 2) + '\n');
  assert.equal(outputHasDummyValue, false, 'Child diagnostic streams contain no dummy value');
  assert.equal(result.passed, true, `Credential rehearsal stage ${config.stage}: ${result.failedStep ?? 'unknown'}`);
  assert.equal(exitCode, 0, 'Worker completed cleanly');
  return result;
}

async function auditOwnedArtifacts(directory, dummy, excluded) {
  const result = { filesScanned: 0, compressedFilesScanned: 0, compressedFilesNotScanned: 0, dummyValueFound: false };
  async function scan(root) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const filename = path.join(root, entry.name);
      if (excluded.has(filename)) continue;
      if (entry.isDirectory()) { await scan(filename); continue; }
      if (!entry.isFile()) continue;
      let bytes = await readFile(filename);
      result.filesScanned++;
      if (bytes.includes(Buffer.from(dummy))) result.dummyValueFound = true;
      const zstd = bytes.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
      if (zstd) {
        if (zlib.zstdDecompressSync) { bytes = zlib.zstdDecompressSync(bytes); result.compressedFilesScanned++; }
        else { result.compressedFilesNotScanned++; continue; }
      } else if (bytes[0] === 0x1f && bytes[1] === 0x8b) { bytes = zlib.gunzipSync(bytes); result.compressedFilesScanned++; }
      if (bytes.includes(Buffer.from(dummy))) result.dummyValueFound = true;
    }
  }
  await scan(directory);
  return result;
}

async function driver() {
  await mkdir(outputBase, { recursive: true });
  const root = await mkdtemp(path.join(outputBase, 'run-'));
  const evidence = path.join(root, 'evidence');
  const home = path.join(root, 'app/.sciencescope-local/dsh');
  const credentialPath = path.join(root, 'app/.sciencescope-local/secret/credentials.yaml');
  const legacyPath = path.join(home, '.credentials.yaml');
  const workspace = path.join(root, 'workspace');
  await Promise.all([mkdir(evidence, { recursive: true }), mkdir(home, { recursive: true }), mkdir(workspace), mkdir(path.join(evidence, 'isolated-os-home'), { recursive: true })]);
  const dummy = 'SYNTHETIC-LOCALHOST-ONLY-' + randomBytes(32).toString('hex');
  const source = path.resolve(option('--historical-source') ?? path.join(latestSource, '.sciencescope-local/temp/dot/upgrade/sources/46f4e8f'));
  const metadataPath = path.resolve(option('--source-metadata') ?? path.join(latestSource, '.sciencescope-local/temp/dot/upgrade/source-metadata/46f4e8f-tree.json'));
  let fixture, activeStage = 'setup';
  const requests = [];
  const stages = [];
  const result = { passed: false, historicalRevision, latestRevision: expectedLatestRevision, platform: process.platform, node: process.version, paidProviderRequests: 0, realProviderAcceptance: false, modelProvider: 'localhost-synthetic-SSE-fixture', evidenceRoot: path.relative(latestSource, evidence), stages };
  try {
    result.latestSourceProof = await latestSourceProof();
    result.sourceProof = await sourceProof(source, metadataPath);
    result.dshVersion = JSON.parse(await readFile(path.join(latestSource, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version;
    result.historicalDshVersion = JSON.parse(await readFile(path.join(source, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8')).version;
    fixture = createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk;
      let input; try { input = JSON.parse(raw); } catch { response.writeHead(400); response.end(); return; }
      const record = { stage: activeStage, route: request.url, authorizationMatchesSavedDummy: request.headers.authorization === `Bearer ${dummy}`, modelBodyContainsDummyValue: raw.includes(dummy), model: input.model, earlierUserTurns: input.messages.filter(message => message.role === 'user' && JSON.stringify(message.content).includes('Reply with the acknowledgement for ')).length - 1 };
      requests.push(record);
      if (!record.authorizationMatchesSavedDummy || record.modelBodyContainsDummyValue || request.url !== '/v1/chat/completions') { response.writeHead(401); response.end(); return; }
      const reply = 'CREDENTIAL_UPGRADE_' + activeStage.toUpperCase() + '_OK';
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
    });
    await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
    const providerUrl = `http://127.0.0.1:${fixture.address().port}/v1`;
    const common = { home, workspace, credentialPath, providerUrl, dummy, sessionId: 'session-credentialupgraderehearsal' };
    activeStage = 'historical';
    stages.push(await boot({ ...common, stage: activeStage, source, sourceRevision: historicalRevision, seed: true, expectedReply: 'CREDENTIAL_UPGRADE_HISTORICAL_OK' }, evidence));
    const original = await readFile(legacyPath);
    const originalValue = yaml.parse(original.toString('utf8'));
    assert.equal(originalValue.refs[credentialRef], dummy, 'Historical saved dummy is present');
    assert.equal(await exists(credentialPath), false);
    result.legacyCredentialCreatedByHistoricalProfile = true;
    result.credentialRefCount = Object.keys(originalValue.refs ?? {}).length;
    activeStage = 'upgraded';
    stages.push(await boot({ ...common, stage: activeStage, source: latestSource, sourceRevision: expectedLatestRevision, seed: false, expectedReply: 'CREDENTIAL_UPGRADE_UPGRADED_OK' }, evidence));
    const migrated = await readFile(credentialPath);
    assert.equal(isDeepStrictEqual(yaml.parse(migrated.toString('utf8')), originalValue), true, 'Complete credential document survives semantically');
    assert.equal(await exists(legacyPath), false, 'Legacy credential source is removed after verified migration');
    result.legacyCredentialRemoved = true;
    result.credentialDocumentPreserved = true;
    result.originalStoreBytesPreserved = original.equals(migrated);
    result.secretDirectoryMode = await privateFile(path.dirname(credentialPath), true);
    result.credentialFileMode = await privateFile(credentialPath);
    activeStage = 'restarted';
    stages.push(await boot({ ...common, stage: activeStage, source: latestSource, sourceRevision: expectedLatestRevision, seed: false, expectedReply: 'CREDENTIAL_UPGRADE_RESTARTED_OK' }, evidence));
    assert.deepEqual(await readFile(credentialPath), migrated, 'Restart does not rewrite or lose the credential document');
    assert.equal(await exists(legacyPath), false, 'Restart does not recreate the legacy credential source');
    result.restartStoreUnchanged = true;
    result.restartCredentialMode = await privateFile(credentialPath);
    result.restartDirectoryMode = await privateFile(path.dirname(credentialPath), true);
    assert.equal(requests.length, 3, 'Exactly one local model handshake per boot');
    assert.equal(requests.every(request => request.authorizationMatchesSavedDummy && !request.modelBodyContainsDummyValue), true);
    assert.deepEqual(requests.map(request => request.earlierUserTurns), [0, 1, 2], 'The same real DSH session also retains historical context across both boots');
    result.physicalLocalhostRequests = requests.length;
    result.authenticatedOnAllBoots = true;
    result.historicalRuntimeContextRetained = true;
    result.artifactAudit = await auditOwnedArtifacts(root, dummy, new Set([credentialPath, legacyPath]));
    assert.equal(result.artifactAudit.dummyValueFound, false, 'No dummy value occurs in logs, settings, session records or evidence');
    assert.equal(result.artifactAudit.compressedFilesNotScanned, 0, 'All compressed artifacts were auditable');
    result.noCredentialValueInLogsOrEvidence = true;
    result.passed = true;
  } catch (error) {
    result.failedStage = activeStage;
    result.failureCode = error.code ?? error.name;
    // This summary cannot contain private values from an upstream assertion.
    result.failureSummary = `Credential upgrade rehearsal failed during ${activeStage}; inspect stage booleans and source readiness.`;
  } finally {
    fixture?.closeAllConnections();
    if (fixture?.listening) await new Promise(resolve => fixture.close(resolve));
    await writeFile(path.join(evidence, 'handshakes.json'), JSON.stringify(requests, null, 2) + '\n');
    await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify({ passed: result.passed, historicalRevision, latestRevision: expectedLatestRevision, evidenceRoot: result.evidenceRoot, physicalLocalhostRequests: requests.length, legacyCredentialRemoved: result.legacyCredentialRemoved ?? false, credentialDocumentPreserved: result.credentialDocumentPreserved ?? false, restartStoreUnchanged: result.restartStoreUnchanged ?? false, noCredentialValueInLogsOrEvidence: result.noCredentialValueInLogsOrEvidence ?? false, ...(result.passed ? {} : { failedStage: result.failedStage, failureCode: result.failureCode }) }) + '\n');
  process.exitCode = result.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) {
  if (process.argv.includes('--worker')) {
    let raw = ''; for await (const chunk of process.stdin) raw += chunk;
    await worker(JSON.parse(raw));
  } else {
    await driver();
  }
}
