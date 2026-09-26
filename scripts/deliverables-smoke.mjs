// Browser smoke through the production router: files an agent presents with
// its answer (DSH `present`) show as a thumbnail / document card; only
// declared files are served; peers receive the answer plus presented files,
// never other tool calls. Offline; fake runtime.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'deliverables-smoke-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const workspaces = new Map(); let expertPrompt = '';
const host = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 'offline', name: '离线', models: ['m'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => ({usedTokens: 32000, contextWindow: 128000, estimated: false}),
  startSession: async ({sessionId, workspace}) => { const id = sessionId || `session-${workspaces.size + 1}`; workspaces.set(id, workspace); return id; },
  configurePolicy: async () => {}, configureReasoning: async () => {}, releaseSession: async () => {}, getGoal: async () => null,
  send: async ({sessionId, onEvent}) => {
    const workspace = workspaces.get(sessionId);
    await mkdir(path.join(workspace, 'figures'), {recursive: true});
    await writeFile(path.join(workspace, 'figures', 'effect.png'), PNG);
    await writeFile(path.join(workspace, 'report.pdf'), '%PDF-1.4\n');
    onEvent({type: 'tool-call', callId: 'r1', name: 'read', argumentsPreview: '{"path":"notes/private.md"}'});
    onEvent({type: 'tool-result', callId: 'r1', isError: false, resultPreview: 'ok'});
    onEvent({type: 'tool-call', callId: 'p1', name: 'present', argumentsPreview: JSON.stringify({files: [{path: 'figures/effect.png', description: '效应量'}, {path: 'report.pdf', description: '报告'}]})});
    onEvent({type: 'tool-result', callId: 'p1', isError: false});
    onEvent({type: 'completed', text: 'ANSWER'}); return {finalResponse: 'ANSWER'};
  },
  runExperts: async ({runId, prompt, experts}) => { expertPrompt = prompt; return experts.map(expert => ({expertId: expert.id, stopReason: 'completed', text: 'EXPERT', ms: 1, context: {usedTokens: 12000, contextWindow: 64000, estimated: false}})); },
  cancelExperts: async () => {},
};
const server = await createDesktopServer({dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'assets'), runtimeHost: host});
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: {width: 1280, height: 860}, env: {...process.env, TEMP: root, TMP: root}});
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await installApiToken(page, server);
  await page.goto(server.url);
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await page.evaluate(() => { window.ScienceScopeModels = {available: () => true, selected: () => ({providerId: 'offline', modelId: 'm'})}; });
  await page.locator('[data-draft="main"]').fill('画一张效应量图');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.some(m => m.text === 'ANSWER'));
  await page.waitForSelector('.deliverable.is-image img[src^="blob:"]');
  assert.deepEqual(await page.locator('.deliverable .deliverable-text b').allInnerTexts(), ['effect.png', 'report.pdf']);
  assert.equal(await page.locator('.deliverable.is-document').count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector('.deliverable img').naturalWidth), 1, 'the thumbnail is the real image');
  const chatId = await page.evaluate(() => V.chat);

  // After a reload the cards come back from the stored tool records.
  await page.reload(); await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
  await page.evaluate(id => window.SSV2.loadThread(id), chatId);
  await page.waitForSelector('.deliverable.is-image img[src^="blob:"]');

  // Only declared files are served.
  const get = p => apiFetch(server, `/api/chats/deliverable?chatId=${encodeURIComponent(chatId)}&path=${encodeURIComponent(p)}`);
  assert.equal((await get('figures/effect.png')).status, 200);
  assert.equal((await get('notes/private.md')).status, 404, 'a file only read is not a deliverable');
  assert.equal((await get('/etc/passwd')).status, 404);
  assert.equal((await get('report.pdf')).status, 415, 'documents open with the default program, not in the page');

  // Peers see the answer and its presented files, not the read call.
  const panel = await apiFetch(server, '/api/experts'); const {experts} = await panel.json();
  await apiFetch(server, '/api/discussion', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chatId, projectId: null, model: {providerId: 'offline', modelId: 'm'}, kind: 'ordered', text: '怎么看？', expertIds: [experts[0].id], userMessageId: 'msg-u2'})}).then(r => r.text());
  assert.match(expertPrompt, /ANSWER\n\[Files presented with this answer\]\n- figures\/effect\.png — 效应量\n- report\.pdf — 报告/);
  assert.doesNotMatch(expertPrompt, /private\.md|"read"/);
  await page.screenshot({path: path.join(base, 'deliverables.png')});

  // Context popover: the ring is the Main expert; the popover adds each expert.
  await page.evaluate(() => window.ScienceScopeExecution.refresh());
  await page.waitForFunction(() => document.querySelector('[data-usage="main"]')?.dataset.contextKnown === 'true');
  await page.locator('.usage-ring[data-usage="main"]').first().hover();
  await page.waitForSelector('#usage-pop .usage-expert');
  const pop = await page.locator('#usage-pop').innerText();
  assert.match(pop, /主专家[\s\S]*25\.0%/); assert.match(pop, new RegExp(`${experts[0].label}[\\s\\S]*18\\.8%`));
  await page.screenshot({path: path.join(base, 'context-popover.png')});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({thumbnail: true, documentCard: true, afterReload: true, onlyDeclaredServed: true, peersSeePresentedOnly: true, expertContexts: true}));
} finally { await browser?.close(); await server.close(); await rm(root, {recursive: true, force: true}); }
