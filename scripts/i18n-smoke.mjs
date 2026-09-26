// Browser smoke through the production router: the interface language switches
// between Chinese and English from Settings, applies to text, attributes and
// info tips, persists, leaves user data alone and restores Chinese exactly.
// Offline; fake runtime.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'i18n-smoke-'));
const host = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 'offline', name: '离线', models: ['m'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId}) => sessionId || 'session-i1',
  configurePolicy: async () => {}, configureReasoning: async () => {}, releaseSession: async () => {}, getGoal: async () => null,
  send: async ({onEvent}) => { onEvent({type: 'completed', text: '好的'}); return {finalResponse: '好的'}; },
};
const server = await createDesktopServer({dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'assets'), runtimeHost: host});
let browser;
try {
  await apiFetch(server, '/api/workspace', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({projects: [{id: 'p1', name: '新对话测试项目', desc: ''}], pins: [], projectExpanded: {p1: true}})});
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: {width: 1280, height: 860}, env: {...process.env, TEMP: root, TMP: root}});
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await installApiToken(page, server);
  const ready = async () => { await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeI18n); await page.evaluate(() => window.ScienceScopeWorkspace.ready); };
  await page.goto(server.url); await ready();
  const zhSidebar = await page.locator('.sidebar, aside').first().innerText();
  assert.match(zhSidebar, /新对话/); assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');

  // Switch to English in Settings → 个人资料与常规.
  await page.evaluate(() => go('general')); await page.waitForSelector('#desktop-preferences-form');
  await page.locator('[name="language"]').selectOption('en');
  await page.locator('#desktop-preferences-form button[type="submit"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  const settingsText = await page.locator('body').innerText();
  for (const word of ['Reading and interaction', 'Language', 'Interface font', 'Theme', 'Profile and general']) assert.match(settingsText, new RegExp(word));

  // Native window controls still work with translated titles (the × did
  // nothing in English on Windows, 2026-09-26). Fake Tauri window API.
  await page.evaluate(() => go('home'));
  await page.evaluate(() => { window.__windowCalls = []; const w = {close: async () => __windowCalls.push('close'), minimize: async () => __windowCalls.push('minimize'), toggleMaximize: async () => __windowCalls.push('maximize')}; window.__TAURI__ = {...(window.__TAURI__ || {}), window: {getCurrentWindow: () => w}}; });
  const controls = page.locator('.windowctl [data-v="window-info"]');
  assert.deepEqual(await controls.evaluateAll(list => list.map(b => b.title)), ['Minimize', 'Maximize', 'Close main window'], 'titles are translated');
  for (let i = 0; i < 3; i++) await controls.nth(i).click();
  assert.deepEqual(await page.evaluate(() => window.__windowCalls), ['minimize', 'maximize', 'close']);
  await page.evaluate(() => { delete window.__TAURI__.window; });
  await page.evaluate(() => go('general')); await page.waitForSelector('#desktop-preferences-form');
  assert.equal(await page.locator('[name="language"] option[value="zh-CN"]').innerText(), '中文', 'a language keeps its own name');
  assert.match(await page.locator('.settingrow h3 .info-tip').first().getAttribute('data-info-tip'), /^[^\u3400-\u9fff]+$/u, 'info tips are English');

  // Persisted: a reload comes back in English, including attributes and dialogs.
  await page.reload(); await ready();
  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.evaluate(() => newThread('p1')); await page.waitForSelector('[data-draft="main"]');
  assert.match(await page.locator('body').innerText(), /New chat/);
  assert.match(await page.locator('[data-draft="main"]').getAttribute('placeholder'), /^[^\u3400-\u9fff]+$/u, 'placeholders are English');
  assert.match(await page.locator('body').innerText(), /新对话测试项目/, 'user data stays as entered');
  assert.doesNotMatch(await page.locator('body').innerText(), /New chat测试/, 'user data is never half-translated');
  await page.evaluate(() => window.ScienceScopeCreation.newChat(null)); await page.waitForSelector('#modal .creation-dialog');
  assert.match(await page.locator('#modal').innerText(), /Working folder[\s\S]*Python environment[\s\S]*Start chat/);
  await page.locator('[data-creation-cancel]').click();
  // A toast from an error is translated too.
  await page.evaluate(() => toast('请先选择模型。'));
  await page.waitForFunction(() => [...document.querySelectorAll('.toast, #toast, [role="status"]')].some(el => el.textContent.includes('Please choose a model first.')));
  // The built-in notes template follows the language until the user saves one.
  assert.match((await (await apiFetch(server, '/api/secretary/preferences')).json()).notesTemplate, /^# Version notes/);

  // Back to Chinese: the original text returns exactly.
  await page.evaluate(() => go('general')); await page.waitForSelector('#desktop-preferences-form');
  await page.locator('[name="language"]').selectOption('zh-CN');
  await page.locator('#desktop-preferences-form button[type="submit"]').click();
  await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
  assert.match(await page.locator('body').innerText(), /阅读与操作[\s\S]*界面语言/);
  assert.doesNotMatch(await page.locator('.settingsnav').innerText(), /[A-Za-z]{4,}/, 'no English left in the settings navigation');
  await page.screenshot({path: path.join(base, 'i18n-zh-restored.png')});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({switchToEnglish: true, windowControlsInEnglish: true, persists: true, attributesAndTips: true, userDataKept: true, toasts: true, defaultTemplate: true, restoresChinese: true}));
} finally { await browser?.close(); await server.close(); await rm(root, {recursive: true, force: true}); }
