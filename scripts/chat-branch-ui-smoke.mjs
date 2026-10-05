// T12 message branching acceptance through the production asset/API router.
// --native starts an owned Tauri/WebView2 client with process-local diagnostics.
// Runtime/model responses are deterministic local fixtures; paid requests: zero.
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {mkdir, mkdtemp, copyFile, rm, writeFile} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const native = process.argv.includes('--native');
const output = path.resolve('.sciencescope-local/temp/t12-branch-validation', native ? 'native' : 'browser');
await mkdir(output, {recursive: true});
const root = await mkdtemp(path.join(output, 'run-'));
const evidence = path.join(root, 'evidence');
await mkdir(evidence, {recursive: true});
const dataRoot = path.join(root, 'app');
const sourceId = 't12-source';
const model = {providerId: 't12-local-fixture', modelId: 'offline'};
const errors = [], assetFailures = [], externalRequests = [], screenshots = [], apiBranches = [], forkCalls = [];
const runtimeRequests = [];
const sessions = new Map();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const execute = promisify(execFile);
let server, browser, page, child, diagnosticPort, ownedNative = [], phase = 'setup', nextSession = 0;
let pendingReply = null;
async function noVisibleBranchControls(label) {
  assert.equal(await page.locator('[data-v="branch-message"]:visible').count(), 0, `${label}: no visible branch controls`);
  assert.equal(await page.locator('.chatbottom [data-v="branch-message"]:visible').count(), 0, `${label}: no latest branch control`);
  const menu = page.locator('[data-v="message-menu"]').last();
  await menu.click();
  await page.waitForSelector('#v-menu');
  assert.equal(await page.locator('#v-menu [data-v="branch-message"]:visible').count(), 0, `${label}: no branch menu item`);
  await page.evaluate(() => closeMenu());
}

function makeSession(id) {
  const session = {id, turns: [], lastSeq: 0};
  sessions.set(id, session);
  return session;
}
const runtimeHost = {
  capabilities: {tokenStreaming: true},
  close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: model.providerId, name: 'T12 local fixture', models: [model.modelId], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId, noTools}) => {
    const id = sessionId || (noTools ? `t12-minutes-${++nextSession}` : `t12-session-${++nextSession}`);
    if (!sessions.has(id)) makeSession(id);
    return id;
  },
  configurePolicy: async () => {}, configureReasoning: async () => {}, configureBrief: async () => {},
  releaseSession: async () => {}, getGoal: async () => null, setToolHandler: () => {},
  interrupt: async () => {
    if (pendingReply) {
      pendingReply.interrupted = true;
      pendingReply.release();
    }
  },
  sessionTurns: async ({sessionId}) => {
    const session = sessions.get(sessionId);
    assert.ok(session, `unknown fixture session ${sessionId}`);
    return {turns: session.turns.map(({index, startSeq, endSeq}) => ({index, startSeq, endSeq})), lastSeq: session.lastSeq};
  },
  forkSession: async ({sessionId, atSeq}) => {
    const source = sessions.get(sessionId);
    assert.ok(source, `unknown fork source ${sessionId}`);
    const end = source.turns.find(turn => turn.endSeq === atSeq);
    assert.ok(end, `fork must target a completed turn boundary: ${atSeq}`);
    const childSession = makeSession(`t12-session-${++nextSession}`);
    childSession.turns = structuredClone(source.turns.filter(turn => turn.endSeq <= atSeq));
    childSession.lastSeq = atSeq;
    forkCalls.push({sessionId, atSeq, childSessionId: childSession.id, inheritedTurns: childSession.turns.length});
    return {sessionId: childSession.id, boundarySeq: atSeq, inheritedEventCount: atSeq + 1};
  },
  send: async ({sessionId, text, onEvent}) => {
    const session = sessions.get(sessionId);
    assert.ok(session, `send with unknown session ${sessionId}`);
    if (sessionId.includes('minutes')) {
      onEvent?.({type: 'completed', text: 'LOCAL_MINUTES'});
      return {finalResponse: 'LOCAL_MINUTES'};
    }
    const startSeq = session.lastSeq + 1;
    const index = session.turns.length;
    runtimeRequests.push({sessionId, text, inheritedInputs: session.turns.map(turn => turn.input)});
    if (text.includes('T12_HOLD')) {
      const wait = new Promise(resolve => { pendingReply = {sessionId, release: resolve}; });
      await wait;
      const interrupted = pendingReply.interrupted;
      pendingReply = null;
      if (interrupted) throw new Error('T12_LOCAL_INTERRUPTED');
    }
    if (text.includes('T12_FAIL')) throw new Error('T12_LOCAL_FAILURE');
    const answer = `LOCAL_REPLY_${runtimeRequests.length}`;
    const endSeq = startSeq + 5;
    session.turns.push({index, startSeq, endSeq, input: text, answer});
    session.lastSeq = endSeq;
    onEvent?.({type: 'completed', text: answer});
    return {finalResponse: answer};
  },
};

async function request(route, body) {
  const response = await apiFetch(server, 'api/' + route, body === undefined ? {} : {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
  });
  const value = await response.json();
  return {status: response.status, value};
}
async function ok(route, body) {
  const result = await request(route, body);
  assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.value)}`);
  return result.value;
}
async function chat(text, userId, answerId, researchInput) {
  const response = await postChat({chatId: sourceId, text, userMessageId: userId, assistantMessageId: answerId, researchInput});
  const raw = await response.text();
  assert.equal(response.status, 200, `chat ${text}: ${raw}`);
  const events = raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.ok(events.some(event => event.type === 'completed'), `chat did not complete: ${raw}`);
  return events;
}
function postChat({chatId, text, userMessageId, assistantMessageId, researchInput}) {
  return apiFetch(server, 'api/chat', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({chatId, projectId: null, model, text, title: `T12 ${chatId}`, userMessageId, assistantMessageId, ...(researchInput ? {researchInput} : {})}),
  });
}
async function poll(read, check, label, timeout = 25_000) {
  const until = Date.now() + timeout; let value;
  do { value = await read(); if (check(value)) return value; await pause(100); } while (Date.now() < until);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function processSnapshot() {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout} = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], {
    windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024, env: {...process.env, TEMP: root, TMP: root},
  });
  const result = JSON.parse(stdout);
  return Array.isArray(result) ? result : [result];
}
async function captureNative() {
  const all = await processSnapshot(), ids = new Set([child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of all) if (ids.has(process.ParentProcessId) && !ids.has(process.ProcessId)) { ids.add(process.ProcessId); changed = true; }
  }
  ownedNative = all.filter(process => ids.has(process.ProcessId));
  assert.ok(ownedNative.some(process => process.Name === 'node.exe'), 'native client owns its fixture host child');
  assert.ok(ownedNative.some(process => /webview2/i.test(process.Name)), 'native client owns WebView2 descendants');
}
async function setBranchFlag(enabled) {
  await page.unroute('**/api/status');
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({response, json: {...status, features: {...status.features, branch: enabled}}});
  });
  await page.reload();
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeFeatures?.ready && window.ScienceScopeModels);
  await page.evaluate(() => Promise.all([window.ScienceScopeWorkspace.ready, window.ScienceScopeFeatures.ready]));
  await installModelFixture();
}
async function installModelFixture() {
  await page.evaluate(() => {
    window.ScienceScopeModels.select({providerId: 't12-local-fixture', modelId: 'offline'});
  });
}
async function launch() {
  if (!native) {
    browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {
      headless: true, executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      viewport: {width: 1440, height: 960}, env: {...process.env, TEMP: root, TMP: root},
    });
    page = await browser.newPage();
    await installApiToken(page, server);
    await page.goto(server.url);
  } else {
    assert.equal(process.platform, 'win32', '--native requires Windows');
    const executable = path.join(root, 'sciencescope-desktop.exe');
    await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'), executable);
    diagnosticPort = await freePort();
    child = spawn(executable, [], {
      cwd: root, windowsHide: true, stdio: 'ignore',
      env: {...process.env, SCIENCESCOPE_NODE: process.execPath, SCIENCESCOPE_HOST_SCRIPT: path.resolve('scripts/native-fixture-host.mjs'), SCIENCESCOPE_TEST_HOST_URL: server.url, SCIENCESCOPE_TEST_API_TOKEN: server.apiToken, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${diagnosticPort}`, TEMP: root, TMP: root},
    });
    for (let attempt = 0; attempt < 60; attempt++) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${diagnosticPort}`); break; }
      catch { await pause(500); }
    }
    assert.ok(browser, 'owned native diagnostic connection required');
    page = await poll(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith(server.url) && !candidate.url().includes('surface=')), Boolean, 'actual native main page');
    assert.ok(await page.evaluate(() => !!window.__TAURI__?.core?.invoke), 'actual Tauri bridge required');
    await captureNative();
  }
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/desktop/') && response.status() >= 400) assetFailures.push({url: response.url(), status: response.status()}); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (native && url.origin === 'http://ipc.localhost') return;
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(server.url).origin) externalRequests.push(url.origin);
    if (url.pathname === '/api/chats/branch' && request.method() === 'POST') apiBranches.push(request.postDataJSON());
  });
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
}

try {
  server = await createDesktopServer({dataRoot, outputDir: path.join(root, 'assets'), runtimeHost});
  const actualStatus = await ok('status');
  assert.equal(actualStatus.features.branch, true, 'production detects the connected branch runtime');
  phase = 'seed completed source turns and attachment';
  await chat('Remember A: T12_A', 'u1', 'a1');
  const attachment = await ok('library/import', {name: 't12-evidence.txt', base64: Buffer.from('T12_ATTACHMENT_A').toString('base64'), projectId: null});
  const mark = {id: 't12-mark-1', revision: 0, sourceChatId: sourceId, sourceMessageId: 'a1', selectedText: 'LOCAL_REPLY_1', comment: 'Keep this exact source', speaker: 'assistant'};
  await chat('Remember B: T12_B', 'u2', 'a2', {attachmentIds: [attachment.id], messageQuotes: [mark], annotations: [], contextRefs: []});
  await chat('Remember C: T12_C', 'u3', 'a3');
  const original = await ok(`chats/${sourceId}/messages?limit=60`);
  assert.deepEqual(original.messages.filter(message => message.role === 'user').map(message => message.id), ['u1', 'u2', 'u3']);
  assert.deepEqual(original.messages.filter(message => message.role === 'assistant').map(message => message.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(original.messages.map(message => message.branchMode), ['reask', 'reply', 'reask', 'reply', 'reask', 'reply']);
  const sourceSessionId = [...sessions.values()].find(session => session.turns.some(turn => turn.input.includes('T12_A')))?.id;
  assert.ok(sourceSessionId, 'source runtime session recorded');
  assert.deepEqual(sessions.get(sourceSessionId).turns.map(turn => turn.endSeq), [6, 12, 18]);

  phase = 'browser or actual native client feature flag';
  await launch();
  await setBranchFlag(false);
  await page.evaluate(id => window.SSV2.loadThread(id), sourceId);
  await page.waitForSelector('#message-a1');
  await noVisibleBranchControls('status flag off');
  await setBranchFlag(true);
  await page.evaluate(id => window.SSV2.loadThread(id), sourceId);
  await page.waitForSelector('#message-a1');
  assert.equal(await page.evaluate(() => window.ScienceScopeFeatures.has('branch')), true);

  phase = 'branch actions';
  const reply = page.locator('#message-a1 [data-v="branch-message"][data-branch-mode="reply"]');
  const middleReask = '#message-u2 [data-v="branch-message"][data-branch-mode="reask"]';
  await reply.waitFor();
  await page.locator(middleReask).waitFor();
  await page.locator('#message-u2 [data-v="message-menu"]').click();
  await page.waitForSelector('#v-menu [data-v="branch-message"][data-branch-mode="reask"]');
  assert.match(await page.locator('#v-menu [data-v="branch-message"]').innerText(), /从此处重新提问/);
  await page.evaluate(() => closeMenu());
  const tip = page.locator('#message-a1 .branch-action [data-info-tip]').first();
  await tip.click();
  await page.waitForSelector('#info-pop');
  assert.match(await page.locator('#info-pop').innerText(), /模型上下文|context/i, 'reply explanation is behind info tip');
  assert.equal(await page.evaluate(() => V.chat), sourceId, 'info tip does not branch');
  assert.equal(apiBranches.length, 0, 'info tip does not send API request');
  await page.keyboard.press('Escape');
  await reply.click();
  await poll(() => page.evaluate(() => V.chat), value => value !== sourceId, 'reply branch opens');
  const replyId = await page.evaluate(() => V.chat);
  const replyPage = await ok(`chats/${replyId}/messages?limit=60`);
  assert.equal(replyPage.messages.length, 2, 'reply branch copies one complete turn');
  assert.deepEqual(replyPage.messages.map(message => message.text), original.messages.slice(0, 2).map(message => message.text));
  assert.equal(replyPage.chat.branchedFrom?.chatId, sourceId);
  assert.equal(replyPage.chat.branchedFrom?.messageId, 'a1');
  assert.equal(forkCalls.at(-1)?.atSeq, 6, 'reply forks at that round end');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'Remember A: T12_A');
  assert.equal(sessions.get(forkCalls.at(-1).childSessionId).turns.length, 1, 'reply child runtime retains only first completed turn');
  assert.equal(await page.locator('[data-ws="branch-source"]').count(), 1, 'source hyperlink is shown');
  await page.locator('[data-draft="main"]').fill('T12 child draft keeps focus');
  await page.locator('[data-draft="main"]').focus();
  await poll(() => request(`chats/${replyId}/messages?limit=60`), value => value.value.chat.draftText === 'T12 child draft keeps focus', 'typed reply draft persists');
  await page.locator('[data-ws="branch-source"]').click();
  await poll(() => page.evaluate(() => V.chat), value => value === sourceId, 'source hyperlink returns to exact chat');
  await page.waitForSelector('#message-a1');
  assert.equal(await page.locator('#message-a1 .message-text').count(), 1, 'source hyperlink locates the exact reply');
  assert.equal(await page.locator('#message-a1').isVisible(), true);
  assert.ok(await page.locator('#message-a1').evaluate(element => {
    const row = element.getBoundingClientRect(), pane = element.closest('.messages').getBoundingClientRect();
    return row.top < pane.bottom - 2 && row.bottom > pane.top + 2;
  }), 'source reply lies inside visible transcript viewport');

  await page.locator(middleReask).click();
  await poll(() => page.evaluate(() => V.chat), value => value !== sourceId, 'middle reask opens');
  const reaskId = await page.evaluate(() => V.chat);
  const reaskPage = await ok(`chats/${reaskId}/messages?limit=60`);
  assert.equal(reaskPage.messages.length, 2, 'reask excludes target turn');
  assert.equal(reaskPage.chat.branchedFrom?.messageId, 'u2');
  assert.equal(forkCalls.at(-1)?.atSeq, 6, 'middle reask forks at previous end');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'Remember B: T12_B');
  assert.equal(sessions.get(forkCalls.at(-1).childSessionId).turns.length, 1, 'middle reask child runtime excludes target turn');
  const reaskDraft = await ok(`research-input/draft?scope=main&ownerId=${reaskId}`);
  assert.deepEqual(reaskDraft.attachmentIds, [attachment.id], 'middle reask retains source attachments');
  assert.equal(reaskDraft.messageQuotes[0]?.sourceMessageId, 'a1', 'middle reask retains mark provenance');
  await page.locator('[data-draft="main"]').fill('T12 edited reask draft');
  await poll(() => request(`chats/${reaskId}/messages?limit=60`), value => value.value.chat.draftText === 'T12 edited reask draft', 'edited branch draft persists');
  await page.reload();
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await installModelFixture();
  await page.evaluate(id => window.SSV2.loadThread(id), reaskId);
  await page.waitForSelector('[data-ws="branch-source"]');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'T12 edited reask draft', 'edited draft survives reload');
  await page.locator('[data-draft="main"]').fill('T12_FAIL branched retry text');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await poll(() => request(`chats/${reaskId}/messages?limit=60`), value => value.value.messages.some(message => message.completionStatus === 'failed'), 'branched send fails through production API');
  await poll(() => page.locator('[data-draft="main"]').inputValue(), value => value === 'T12_FAIL branched retry text', 'failed branch send returns draft');
  await page.reload();
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await installModelFixture();
  await page.evaluate(id => window.SSV2.loadThread(id), reaskId);
  await page.waitForSelector('[data-ws="branch-source"]');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'T12_FAIL branched retry text', 'failed branch draft survives restart');
  await page.locator('[data-ws="branch-source"]').click();
  await poll(() => page.evaluate(() => V.chat), value => value === sourceId, 'middle source link returns');
  await page.waitForSelector('#message-u2');
  assert.equal(await page.locator('#message-u2').isVisible(), true);

  await page.locator('#message-a2 [data-v="branch-message"][data-branch-mode="reply"]').click();
  await poll(() => page.evaluate(() => V.chat), value => value !== sourceId, 'attachment reply branch opens');
  const attachmentReplyId = await page.evaluate(() => V.chat);
  const attachmentReplyPage = await ok(`chats/${attachmentReplyId}/messages?limit=60`);
  assert.equal(attachmentReplyPage.messages.length, 4, 'reply at second turn copies through second reply');
  assert.equal(attachmentReplyPage.chat.branchedFrom?.messageId, 'a2');
  assert.equal(forkCalls.at(-1)?.atSeq, 12);
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'Remember B: T12_B');
  const attachmentReplyDraft = await ok(`research-input/draft?scope=main&ownerId=${attachmentReplyId}`);
  assert.deepEqual(attachmentReplyDraft.attachmentIds, [attachment.id], 'reply branch retains source attachments in draft');
  assert.equal(attachmentReplyDraft.messageQuotes[0]?.sourceMessageId, 'a1', 'reply branch retains mark provenance');
  assert.deepEqual(attachmentReplyPage.messages.find(message => message.role === 'user' && message.text === 'Remember B: T12_B')?.researchInput?.attachmentIds, [attachment.id], 'copied visible message retains material receipt');
  await page.locator('[data-ws="branch-source"]').click();
  await poll(() => page.evaluate(() => V.chat), value => value === sourceId, 'attachment reply source link returns');

  await page.locator('#message-u1 [data-v="branch-message"][data-branch-mode="reask"]').click();
  await poll(() => page.evaluate(() => V.chat), value => value !== sourceId, 'first reask opens');
  const firstId = await page.evaluate(() => V.chat);
  const firstPage = await ok(`chats/${firstId}/messages?limit=60`);
  assert.equal(firstPage.messages.length, 0, 'first user message creates empty chat');
  assert.equal(firstPage.chat.branchedFrom?.messageId, 'u1');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'Remember A: T12_A');
  assert.equal(forkCalls.length, 3, 'first reask creates an empty chat without runtime fork');
  assert.equal(await page.locator('.branch-source').isVisible(), true, 'empty first-question branch still shows provenance');
  await page.locator('[data-ws="branch-source"]').click();
  await poll(() => page.evaluate(() => V.chat), value => value === sourceId, 'first source link returns');
  await page.waitForSelector('#message-u1');
  assert.equal(await page.locator('#message-u1').isVisible(), true);
  assert.equal((await ok(`chats/${sourceId}/messages?limit=60`)).messages.length, original.messages.length, 'source transcript unchanged');

  phase = 'rejected incomplete, failed and stopped turns';
  const rejected = await request('chats/branch', {chatId: sourceId, messageId: 'u2', mode: 'reply'});
  assert.equal(rejected.status, 409, 'user message cannot take reply mode');
  assert.equal(rejected.value.code, 'BRANCH_POINT_UNKNOWN');
  await page.evaluate(id => window.SSV2.loadThread(id), sourceId);
  await page.waitForSelector('#message-a3');
  await page.locator('[data-draft="main"]').fill('T12_HOLD');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await poll(() => Promise.resolve(pendingReply), Boolean, 'fixture turn held while incomplete');
  await page.locator('[data-draft="main"]').fill('T12 draft written while streaming');
  await page.locator('[data-draft="main"]').focus();
  const incomplete = await ok(`chats/${sourceId}/messages?limit=60`);
  const pendingUser = incomplete.messages.find(message => message.role === 'user' && message.text === 'T12_HOLD');
  assert.equal(pendingUser?.branchMode, null);
  await page.waitForSelector(`[data-message-id="${pendingUser.id}"]`);
  assert.equal(await page.locator(`[data-message-id="${pendingUser.id}"] [data-v="branch-message"]:visible`).count(), 0, 'pending user has no branch control');
  assert.equal(await page.locator('.chatbottom [data-v="branch-message"]:visible').count(), 0, 'pending latest control hidden');
  await page.locator(`[data-message-id="${pendingUser.id}"] [data-v="message-menu"]`).click();
  await page.waitForSelector('#v-menu');
  assert.equal(await page.locator('#v-menu [data-v="branch-message"]:visible').count(), 0, 'pending menu omits branch');
  await page.evaluate(() => closeMenu());
  const busy = await request('chats/branch', {chatId: sourceId, messageId: 'a3', mode: 'reply'});
  assert.equal(busy.status, 409); assert.equal(busy.value.code, 'CHAT_BUSY');
  await page.locator('[data-draft="main"]').focus();
  pendingReply.release();
  await poll(() => request(`chats/${sourceId}/messages?limit=60`), value => value.value.messages.some(message => message.role === 'assistant' && message.text.startsWith('LOCAL_REPLY_') && message.ordinal > 5 && message.branchMode === 'reply'), 'held turn completes');
  const completedHold = await ok(`chats/${sourceId}/messages?limit=60`);
  const heldAnswer = completedHold.messages.find(message => message.ordinal > 5 && message.role === 'assistant');
  await page.waitForSelector(`[data-message-id="${heldAnswer.id}"] [data-v="branch-message"][data-branch-mode="reply"]`, {state: 'visible'});
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), 'T12 draft written while streaming', 'stream settlement keeps newer draft');
  assert.equal(await page.locator('[data-draft="main"]').evaluate(element => element === document.activeElement), true, 'stream settlement keeps composer focus');

  const failedResponse = await postChat({chatId: 't12-failed', text: 'T12_FAIL', userMessageId: 'u-failed', assistantMessageId: 'a-failed'});
  const failureStream = await failedResponse.text();
  assert.match(failureStream, /"type":"failed"/, 'fixture failure is reported to the client');
  const failedPage = await ok('chats/t12-failed/messages?limit=60');
  assert.deepEqual(failedPage.messages.map(message => message.branchMode), [null, null], 'failed turn has no branch controls');
  await page.evaluate(async () => { const {hostRequest} = await import('/desktop/host-client.mjs'); S.threads = (await hostRequest('chats')).chats; });
  await page.evaluate(id => window.SSV2.loadThread(id), 't12-failed');
  await page.waitForSelector('#message-a-failed');
  await noVisibleBranchControls('failed turn');

  const stopping = postChat({chatId: 't12-stopped', text: 'T12_HOLD_STOP', userMessageId: 'u-stopped', assistantMessageId: 'a-stopped'});
  await poll(() => Promise.resolve(pendingReply), Boolean, 'fixture turn held for stop');
  const stopped = await ok('chat/stop', {chatId: 't12-stopped'});
  assert.equal(stopped.stopped, true);
  const stoppedResponse = await stopping;
  await stoppedResponse.text();
  const stoppedPage = await ok('chats/t12-stopped/messages?limit=60');
  assert.deepEqual(stoppedPage.messages.map(message => message.branchMode), [null, null], 'stopped turn has no branch controls');
  await page.evaluate(async () => { const {hostRequest} = await import('/desktop/host-client.mjs'); S.threads = (await hostRequest('chats')).chats; });
  await page.evaluate(id => window.SSV2.loadThread(id), 't12-stopped');
  await page.waitForSelector('#message-a-stopped');
  await noVisibleBranchControls('stopped turn');

  phase = 'localized screenshot matrix';
  for (const language of ['zh-CN', 'en']) for (const theme of ['light', 'dark']) {
    await ok('preferences', {language, theme});
    await page.reload();
    await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
    await page.evaluate(() => window.ScienceScopeWorkspace.ready);
    await installModelFixture();
    await page.evaluate(id => window.SSV2.loadThread(id), replyId);
    await page.waitForSelector('[data-ws="branch-source"]');
    await page.waitForFunction(({language, theme}) => document.documentElement.lang === language && document.documentElement.dataset.theme === theme, {language, theme});
    assert.match(await page.locator(`#message-${replyPage.messages[1].id} .branch-action`).first().innerText(), language === 'en' ? /Branch from this reply/ : /从此回复分支/);
    assert.match(await page.locator('.branch-source').innerText(), language === 'en' ? /Branched from/ : /分支自/);
    const file = path.join(evidence, `branch-${language === 'en' ? 'en' : 'zh'}-${theme}.png`);
    await page.screenshot({path: file}); screenshots.push(file);
  }

  assert.deepEqual(errors, []); assert.deepEqual(assetFailures, []); assert.deepEqual(externalRequests, []);
  if (native) {
    phase = 'owned native shutdown';
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(error => { if (!/closed/i.test(error.message)) throw error; });
    await poll(async () => child.exitCode, value => value !== null, 'owned native main exits');
    assert.equal(child.exitCode, 0);
    await poll(async () => {
      const all = await processSnapshot();
      return ownedNative.filter(owned => all.some(process => process.ProcessId === owned.ProcessId));
    }, value => value.length === 0, 'all captured owned native descendants exit');
  }
  const result = {passed: true, native, productionRouter: true, actualTauriWebView2: native,
    sourceChatId: sourceId, replyId, reaskId, attachmentReplyId, firstId, sourceMessages: original.messages.length,
    fixtureRuntimeRequests: runtimeRequests.length, fixtureForkCalls: forkCalls,
    branchRequests: apiBranches, screenshots, browserErrors: errors, assetFailures, externalRequests,
    paidRequests: 0, ...(native ? {nativeMainPid: child.pid, nativeMainExitCode: child.exitCode, nativeDiagnosticPort: diagnosticPort, ownedNativeProcesses: ownedNative, ownedNativeProcessesExited: true} : {})};
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({path: path.join(evidence, 'failure.png'), fullPage: true}).catch(() => {});
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({phase, message: error.message, stack: error.stack, errors, assetFailures, forkCalls, apiBranches}, null, 2)).catch(() => {});
  console.error(JSON.stringify({phase, message: error.message, errors, assetFailures, forkCalls, apiBranches, screenshot: path.join(evidence, 'failure.png')}));
  throw error;
} finally {
  pendingReply?.release();
  if (native && child?.exitCode === null) {
    await page?.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});
    await pause(1000);
    if (child.exitCode === null) child.kill();
  }
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  // Preserve per-run evidence and original failures. Remove only owned fixture
  // state, assets and browser profile after native descendants have exited.
  for (const owned of ['app', 'assets', 'profile', 'sciencescope-desktop.exe'])
    await rm(path.join(root, owned), {recursive: true, force: true, maxRetries: 6, retryDelay: 500}).catch(() => {});
}
