// T11 browser acceptance through the production asset router and a fake uv.
// All fixture data and screenshots remain beneath project .sciencescope-local/temp.
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const base = path.resolve('.sciencescope-local/temp');
await mkdir(base, {recursive: true});
const fixture = await mkdtemp(path.join(base, 'python-env-ui-'));
const screenshots = await mkdtemp(path.join(base, 'python-env-ui-shots-'));
const dataRoot = path.join(fixture, 'app');
const uvCalls = [], compiledInputs = [], starts = [], releases = [];
let sequence = 0;

const uvRunner = async (_command, args, options) => {
  uvCalls.push([...args]);
  assert.equal(options.env.UV_NO_CONFIG, '1');
  assert.equal(options.env.PIP_CONFIG_FILE, os.devNull);
  assert.ok(options.env.UV_CACHE_DIR.startsWith(path.join(dataRoot, '.sciencescope-local')));
  assert.ok(options.env.TEMP.startsWith(path.join(dataRoot, '.sciencescope-local')));
  if (args[0] === '--version') return {code: 0, stdout: 'Python 3.14.7\n', stderr: ''};
  if (args[0] === 'venv') {
    const scripts = path.join(args.at(-1), process.platform === 'win32' ? 'Scripts' : 'bin');
    await mkdir(scripts, {recursive: true});
    await writeFile(path.join(scripts, process.platform === 'win32' ? 'python.exe' : 'python'), 'fake uv venv');
  }
  if (args[0] === 'pip' && args[1] === 'compile') {
    const input = await readFile(args[2], 'utf8');
    compiledInputs.push(input);
    await writeFile(args[args.indexOf('--output-file') + 1], input);
  }
  return {code: 0, stdout: '', stderr: ''};
};

const host = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 'offline', name: '离线', models: ['m'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async (options) => {
    if (!options.noTools) starts.push(options);
    return options.sessionId || `session-${++sequence}`;
  },
  configurePolicy: async () => {}, configureReasoning: async () => {},
  releaseSession: async (sessionId) => { releases.push(sessionId); }, getGoal: async () => null,
  send: async ({onEvent}) => { onEvent({type: 'completed', text: 'OK'}); return {finalResponse: 'OK'}; },
};

let browser, server;
const get = async route => {
  const response = await apiFetch(server, route);
  if (response.status !== 200) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response.json();
};
const eventually = async (read, predicate, label) => {
  for (let i = 0; i < 60; i++) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

try {
  server = await createDesktopServer({dataRoot, outputDir: path.join(fixture, 'assets'), runtimeHost: host,
    pythonOptions: {runner: uvRunner}, pythonBootstrap: false});
  browser = await chromium.launchPersistentContext(path.join(fixture, 'profile'), {
    executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: {width: 1360, height: 900}, env: {...process.env, TEMP: fixture, TMP: fixture},
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installApiToken(page, server);
  await page.goto(server.url + '#environment');
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeCreation);
  await page.evaluate(() => { window.ScienceScopeModels = {available: () => true, selected: () => ({providerId: 'offline', modelId: 'm'})}; go('environment'); });
  await page.waitForSelector('[data-python-root] [data-python-create]');
  assert.equal((await get('api/python/envs')).envs.length, 0, 'fixture does not bootstrap the full built-in package set');

  // Settings create, install, copy and rename all use the real local API.
  await page.locator('[data-python-create] [name="name"]').fill('分析 A');
  await page.locator('[data-python-create] [name="version"]').fill('3.14.7');
  await page.locator('[data-python-create] button').click();
  const first = await eventually(() => get('api/python/envs'), value => value.envs.some(env => env.name === '分析 A' && env.status === 'ready'), 'environment A');
  const envA = first.envs.find(env => env.name === '分析 A');
  await page.locator(`[data-python-action="inspect"][data-env="${envA.id}"]`).click();
  await page.waitForSelector('[data-python-packages]');
  await page.locator('[data-python-packages]').fill('numpy==2.5.3');
  await page.locator('[data-python-action="add"]').click();
  await eventually(() => get('api/python/envs'), value => value.envs.find(env => env.id === envA.id)?.packages.includes('numpy==2.5.3'), 'installed package manifest');
  assert.ok(compiledInputs.some(input => input.includes('numpy==2.5.3')) && uvCalls.some(args => args[0] === 'pip' && args[1] === 'sync'), 'package request compiles and syncs');
  await page.waitForFunction(id => document.querySelector(`[data-python-count="${id}"]`)?.textContent === '1', envA.id);

  await page.locator('[data-python-create] [name="name"]').fill('分析 B');
  await page.locator('[data-python-create] [name="templateId"]').selectOption(envA.id);
  await page.locator('[data-python-create] button').click();
  const copied = await eventually(() => get('api/python/envs'), value => value.envs.find(env => env.name === '分析 B' && env.status === 'ready'), 'copied environment B');
  const envB = copied.envs.find(env => env.name === '分析 B');
  assert.deepEqual(envB.packages, ['numpy==2.5.3']);
  assert.ok(uvCalls.some(args => args[0] === 'pip' && args[1] === 'sync'), 'copy installs its manifest through uv');
  await page.locator(`[data-python-action="inspect"][data-env="${envB.id}"]`).click();
  await page.locator('[data-python-rename] [name="name"]').fill('分析 B 改名');
  await page.locator('[data-python-rename] button').click();
  await eventually(() => get('api/python/envs'), value => value.envs.find(env => env.id === envB.id)?.name === '分析 B 改名', 'renamed environment B');

  // An unsaved settings draft survives an unrelated settings redraw.
  await page.locator('[data-python-settings] [name="defaultEnvId"]').selectOption(envB.id);
  await page.locator('[data-python-settings] [name="indexUrl"]').fill('https://mirror.example/simple');
  await page.evaluate(() => render());
  await page.waitForSelector('[data-python-settings]');
  assert.equal(await page.locator('[data-python-settings] [name="defaultEnvId"]').inputValue(), envB.id);
  assert.equal(await page.locator('[data-python-settings] [name="indexUrl"]').inputValue(), 'https://mirror.example/simple');
  await page.locator('[data-python-settings] button.btn').click();
  await eventually(() => get('api/python/settings'), value => value.defaultEnvId === envB.id, 'saved default environment');
  assert.equal((await get('api/python/settings')).indexUrl, 'https://mirror.example/simple');

  // Creation details select the saved default for both a project and an independent chat.
  await page.evaluate(() => go('project-new'));
  await page.waitForSelector('#new-project-python');
  assert.equal(await page.locator('#new-project-python').inputValue(), envB.id);
  await page.locator('#new-project-name').fill('Python 环境项目');
  await page.locator('[data-action="create-project"]').click();
  await page.waitForFunction(() => S.projects.some(project => project.name === 'Python 环境项目'));
  const projectId = await page.evaluate(() => S.projects.find(project => project.name === 'Python 环境项目').id);
  await eventually(() => get(`api/python/resolve?projectId=${encodeURIComponent(projectId)}`), value => value.envId === envB.id, 'project environment binding');

  await page.evaluate(() => window.ScienceScopeCreation.newChat(null));
  await page.waitForSelector('#modal .creation-dialog #chat-python');
  assert.equal(await page.locator('#chat-python').inputValue(), envB.id);
  await page.locator('#chat-python').selectOption(envA.id);
  await page.locator('[data-creation-start]').click();
  await page.waitForFunction(() => !document.querySelector('#modal'));
  const chatId = await page.evaluate(() => V.chat);
  const send = async text => {
    const before = await page.evaluate(() => S.messages.filter(message => message.text === 'OK').length);
    await page.locator('[data-draft="main"]').fill(text);
    await page.locator('[data-composer="main"] [data-v="send"]').click();
    await page.waitForFunction(({text, before}) => !V.pending.has(V.chat) && S.messages.some(message => message.text === text) && S.messages.filter(message => message.text === 'OK').length > before, {text, before});
  };
  await send('首轮使用 A');
  assert.equal((await get(`api/python/resolve?chatId=${encodeURIComponent(chatId)}`)).envId, envA.id);
  assert.ok(starts.at(-1)?.sessionEnv?.env?.VIRTUAL_ENV?.includes(envA.id), 'first turn starts in A');

  // The chat menu changes the binding and tells the user when it applies.
  await page.locator('[data-v="workspace-menu"]').first().click();
  await page.locator(`[data-python-chat="${chatId}"]`).click();
  try { await page.locator(`[data-python-choice="${envB.id}"]`).waitFor({timeout: 5000}); }
  catch (caught) {
    const menu = await page.locator('#v-menu').evaluateAll(elements => elements.map(element => element.outerHTML));
    await page.screenshot({path: path.join(screenshots, 'menu-choice-failure.png')});
    const direct = await page.evaluate(async id => {
      try {
        const {showPythonChoice} = await import('/desktop/python-settings.mjs');
        await showPythonChoice(document.querySelector('[data-v="workspace-menu"]'), {scope: 'chat', targetId: id});
        return document.querySelector('#v-menu')?.outerHTML || 'no menu';
      } catch (error) { return String(error); }
    }, chatId);
    throw new Error(`Python menu did not open: ${JSON.stringify({menu, errors, direct: direct.slice(0, 1500), body: (await page.locator('body').innerText()).slice(-1000), screenshots})}`, {cause: caught});
  }
  await page.waitForFunction(() => {const menu = document.querySelector('#v-menu'); return menu && Number(getComputedStyle(menu).opacity) > 0.99;});
  await page.screenshot({path: path.join(screenshots, 'python-chat-menu-zh-CN-light.png')});
  await page.locator(`[data-python-choice="${envB.id}"]`).click();
  await page.waitForFunction(() => document.body.innerText.includes('Python 环境将在下一轮生效。'));
  await eventually(() => get(`api/python/resolve?chatId=${encodeURIComponent(chatId)}`), value => value.envId === envB.id, 'chat environment binding');
  await send('第二轮使用 B');
  assert.ok(starts.at(-1)?.sessionEnv?.env?.VIRTUAL_ENV?.includes(envB.id),
    `next turn starts in B: ${JSON.stringify({starts: starts.map(start => ({sessionId: start.sessionId, sessionEnv: start.sessionEnv})), releases})}`);
  assert.ok(releases.length > 0, 'the prior runtime session was released before the new turn');

  // Four inspectable screenshots of the environment settings surface.
  await page.evaluate(() => go('environment'));
  await page.waitForSelector('[data-python-root] [data-python-packages]');
  for (const [language, theme] of [['zh-CN', 'light'], ['zh-CN', 'dark'], ['en', 'light'], ['en', 'dark']]) {
    await page.evaluate(({language, theme}) => { window.ScienceScopeI18n.setLanguage(language); document.documentElement.dataset.theme = theme; }, {language, theme});
    await page.locator('[data-python-packages]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const name = `python-environments-${language}-${theme}.png`;
    await page.screenshot({path: path.join(screenshots, name)});
  }
  assert.deepEqual(errors, []);
  assert.ok(uvCalls.every(args => !args.includes('--index-url')), 'the mirror is supplied only by settings-derived uv environment');

  // SQLite-backed settings, environments and bindings survive a fresh host instance.
  await browser.close(); browser = null;
  await server.close(); server = null;
  server = await createDesktopServer({dataRoot, outputDir: path.join(fixture, 'assets-reopened'), runtimeHost: host,
    pythonOptions: {runner: uvRunner}, pythonBootstrap: false});
  const reopened = await get('api/python/envs');
  assert.equal(reopened.defaultEnvId, envB.id);
  assert.deepEqual(reopened.envs.find(env => env.id === envB.id)?.packages, ['numpy==2.5.3']);
  assert.equal((await get(`api/python/resolve?chatId=${encodeURIComponent(chatId)}`)).envId, envB.id);
  console.log(JSON.stringify({api: true, settingsUi: true, creationDetails: true, nextTurn: true,
    persistence: true, screenshots, uvCalls: uvCalls.length}));
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixture, {recursive: true, force: true});
}
