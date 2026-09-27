// Browser smoke through the production router: the secretary's conversation
// minutes open from the chat's "…" menu, render, can be edited (the edit is
// the next revision) and refreshed on request. Offline; fake runtime.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {installApiToken} from './smoke-auth.mjs';

const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'minutes-smoke-'));
const sessions = new Map(); let minuteRuns = 0;
const host = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 'offline', name: '离线', models: ['m'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId, noTools}) => { const id = sessionId || `session-${sessions.size + 1}`; sessions.set(id, noTools ? 'minutes' : 'chat'); return id; },
  configurePolicy: async () => {}, configureReasoning: async () => {}, configureBrief: async () => {}, releaseSession: async () => {}, getGoal: async () => null,
  send: async ({sessionId, text, onEvent}) => {
    if (sessions.get(sessionId) === 'minutes') { minuteRuns += 1; const edited = /USER_EDIT/.test(text); return {finalResponse: `## 研究问题与目标\n- 检验随机分组设计（#1）\n\n## 已定结论与决定\n- 第 ${minuteRuns} 次整理${edited ? '，保留了用户修改' : ''}`}; }
    onEvent({type: 'completed', text: '好的，采用随机分组。'}); return {finalResponse: '好的，采用随机分组。'};
  },
};
const server = await createDesktopServer({dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'assets'), runtimeHost: host});
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: {width: 1280, height: 860}, env: {...process.env, TEMP: root, TMP: root}});
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await installApiToken(page, server);
  await page.goto(server.url);
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeMinutes);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await page.evaluate(() => { window.ScienceScopeModels = {available: () => true, selected: () => ({providerId: 'offline', modelId: 'm'})}; });
  await page.locator('[data-draft="main"]').fill('我们用随机分组设计。');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.some(m => m.text.includes('采用随机分组')));
  await page.waitForTimeout(400);
  assert.equal(minuteRuns, 0, 'an ordinary Main turn does not automatically spend a minutes run');

  // Open from the chat's "…" menu and explicitly request the first minutes.
  await page.locator('[data-v="workspace-menu"]').first().click();
  await page.locator('#v-menu [data-v="chat-minutes"]').click();
  await page.waitForSelector('#modal .minutes-dialog [data-minutes-refresh]');
  await page.locator('[data-minutes-refresh]').click();
  await page.waitForSelector('#modal .minutes-dialog h2, #modal .minutes-dialog .minutes-body h2');
  assert.match(await page.locator('[data-minutes-meta]').innerText(), /任务秘书整理 · 第 1 版 · 涵盖第 1–2 条（共 2 条）/);
  assert.match(await page.locator('[data-minutes-body]').innerText(), /研究问题与目标[\s\S]*第 1 次整理/);
  await page.screenshot({path: path.join(base, 'minutes.png')});

  // Edit: saved as the next revision by the user.
  await page.locator('[data-minutes-edit]').click();
  await page.locator('[data-minutes-text]').fill('## 研究问题与目标\n- USER_EDIT 只看成年人');
  await page.locator('[data-minutes-save]').click();
  await page.waitForFunction(() => document.querySelector('[data-minutes-meta]')?.textContent.includes('由你编辑 · 第 2 版'));
  assert.match(await page.locator('[data-minutes-body]').innerText(), /USER_EDIT 只看成年人/);

  // A refresh has nothing new to cover; after another turn the secretary builds on the user's edit.
  await page.locator('[data-minutes-close]').click();
  await page.locator('[data-draft="main"]').fill('再看样本量。');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.filter(m => m.text.includes('采用随机分组')).length === 2);
  await page.locator('[data-v="workspace-menu"]').first().click();
  await page.locator('#v-menu [data-v="chat-minutes"]').click();
  await page.waitForSelector('#modal .minutes-dialog [data-minutes-refresh]');
  await page.locator('[data-minutes-refresh]').click();
  await page.waitForFunction(() => /保留了用户修改/.test(document.querySelector('[data-minutes-body]')?.innerText || ''));
  assert.match(await page.locator('[data-minutes-meta]').innerText(), /任务秘书整理 · 第 3 版 · 涵盖第 1–4 条/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({menuEntry: true, rendered: true, userEdit: true, secretaryBuildsOnEdit: true}));
} finally { await browser?.close(); await server.close(); await rm(root, {recursive: true, force: true}); }
