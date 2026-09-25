// Browser smoke through the production router: unfinished features show no
// notices and no entry points until /api/status reports them; academic sites
// open through the host. Offline; fake runtime.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {installApiToken} from './smoke-auth.mjs';

const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'features-smoke-'));
const opened = [];
const host = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 'offline', name: '离线', models: ['m'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId}) => sessionId || 'session-f1',
  configurePolicy: async () => {}, configureReasoning: async () => {}, releaseSession: async () => {}, getGoal: async () => null,
  send: async ({onEvent}) => { onEvent({type: 'completed', text: 'OK'}); return {finalResponse: 'OK'}; },
};
const server = await createDesktopServer({dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'assets'), runtimeHost: host, openUrl: async url => { opened.push(url); return {opened: true}; }});
const NOTICE = /尚未开放|尚未开发|即将提供|待接入|等待更新|尚未接通|尚未接入|原型|示例/;
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: {width: 1280, height: 860}, env: {...process.env, TEMP: root, TMP: root}});
  const errors = [];
  const open = async (features = null) => {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    await installApiToken(page, server);
    if (features) await page.route('**/api/status', async route => { const response = await route.fetch(); const body = await response.json(); await route.fulfill({response, json: {...body, features: {...body.features, ...features}}}); });
    await page.goto(server.url);
    await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeFeatures);
    await page.evaluate(() => Promise.all([window.ScienceScopeWorkspace.ready, window.ScienceScopeFeatures.ready]));
    await page.evaluate(() => { window.ScienceScopeModels = {available: () => true, selected: () => ({providerId: 'offline', modelId: 'm'})}; });
    return page;
  };
  const menuTexts = async (page, selector, index = 0) => {
    await page.locator(selector).nth(index).click(); await page.waitForSelector('#v-menu');
    const texts = await page.locator('#v-menu .menu-line').allInnerTexts();
    await page.evaluate(() => closeMenu()); return texts.join(' | ');
  };

  const page = await open();
  const status = await page.evaluate(() => window.ScienceScopeFeatures.has('branch'));
  assert.equal(status, false);

  // Home: academic sites open in the system browser through the host.
  await page.locator('[data-action="open-site"][data-site="WOS"]').first().click();
  await page.waitForFunction(() => true); for (let i = 0; i < 20 && !opened.length; i++) await page.waitForTimeout(50);
  assert.deepEqual(opened, ['https://www.webofscience.com/']);
  assert.deepEqual(await page.evaluate(() => [route === 'browser', V.panel === 'browser', !!document.querySelector('.browser-panel')]), [false, false, false], 'no in-app browser page');
  const refused = await page.evaluate(async () => { try { await (await import('./desktop/host-client.mjs')).hostRequest('open-url', {url: 'file:///C:/Windows/system32/cmd.exe'}); return 'opened'; } catch (error) { return error.message; } });
  assert.match(refused, /http/, 'non-web addresses are refused'); assert.equal(opened.length, 1);

  // A chat: no branch buttons, no browser button, menus without hidden entries.
  await page.locator('[data-draft="main"]').fill('你好');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.some(m => m.text === 'OK'));
  assert.equal(await page.locator('[data-v="branch-message"]:visible').count(), 0, 'branch entry points hidden');
  assert.equal(await page.locator('[data-v="browser"]:visible').count(), 0, 'browser entry point hidden');
  const help = await menuTexts(page, '[data-v="top-menu"]', 3);
  assert.doesNotMatch(help, /页面目录|开发说明/); assert.match(help, /键盘快捷键/);
  assert.doesNotMatch(await menuTexts(page, '[data-v="top-menu"]', 2), /内置浏览器/);
  assert.doesNotMatch(await menuTexts(page, '[data-v="workspace-menu"]'), /修改记录/);
  assert.doesNotMatch(await menuTexts(page, '[data-v="attach-menu"]'), /项目材料与引用/);
  assert.doesNotMatch(await menuTexts(page, '.message:not(.user) [data-v="message-menu"]'), /分支/);

  // Hidden routes do not navigate; settings nav and palette omit them.
  for (const target of ['help', 'usage', 'browser-settings', 'changes', 'context', 'version-note', 'diff', 'map-history']) {
    const before = await page.evaluate(() => route);
    await page.evaluate(r => go(r), target);
    assert.equal(await page.evaluate(() => route), before, `${target} is not navigable`);
  }
  await page.evaluate(() => go('general')); await page.waitForSelector('.settingsnav');
  assert.equal(await page.locator('.settingsnav [data-route="usage"]:visible, .settingsnav [data-route="browser-settings"]:visible').count(), 0);
  await page.keyboard.press('Control+K'); await page.waitForSelector('#command-query');
  await page.keyboard.type('用量'); await page.waitForTimeout(200);
  assert.doesNotMatch(await page.locator('#command-results').innerText(), /用量分析/);
  await page.keyboard.press('Escape');

  // No notice words on the pages a user can reach.
  for (const target of ['home', 'projects', 'project-new', 'general', 'models', 'persona', 'experts', 'behavior', 'secretary-settings', 'assistant-settings', 'library-settings', 'environment', 'shortcuts', 'plugins', 'database', 'library', 'sources']) {
    await page.evaluate(r => go(r), target); await page.waitForTimeout(250);
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, NOTICE, `${target} shows a notice`);
  }

  // Flags on: the same entry points come back.
  const enabled = await open({branch: true, inAppBrowser: true, usage: true, changeLog: true});
  await enabled.evaluate(() => go('general')); await enabled.waitForSelector('.settingsnav');
  assert.equal(await enabled.locator('.settingsnav [data-route="usage"]:visible').count(), 1, 'usage returns with its flag');
  assert.match(await menuTexts(enabled, '[data-v="top-menu"]', 2), /内置浏览器/);
  assert.doesNotMatch(await menuTexts(enabled, '[data-v="top-menu"]', 3), /页面目录/, 'prototype pages never return');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({sitesOpenExternally: true, entryPointsHidden: true, menusFiltered: true, routesBlocked: true, noNotices: true, flagsRestore: true}));
} finally { await browser?.close(); await server.close(); await rm(root, {recursive: true, force: true}); }
