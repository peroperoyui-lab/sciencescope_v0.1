// T10 settings through production assets/API and the real local semantic service.
// Downloads and model/provider calls are deliberately excluded. --native uses
// an isolated actual Tauri/WebView2 client, never the user's running client.
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {mkdir, mkdtemp, copyFile, rm, writeFile, stat} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const native = process.argv.includes('--native');
const output = path.resolve('.sciencescope-local/temp/t10-validation', native ? 'native' : 'semantic-ui');
await mkdir(output, {recursive: true});
const root = await mkdtemp(path.join(output, 'run-'));
const dataRoot = path.join(root, 'app');
const errors = [], assetFailures = [], externalRequests = [], nativeIpcRequests = [], actions = [], screenshots = [];
let server, browser, page, child, ownedNative = [], phase = 'setup', runtimeCalls = 0, diagnosticPort;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const execute = promisify(execFile);
const runtimeHost = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 't10-offline', name: 'T10 offline fixture', models: ['offline'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId}) => sessionId || 'session-t10-unused',
  configurePolicy: async () => {}, configureReasoning: async () => {}, configureBrief: async () => {},
  releaseSession: async () => {}, getGoal: async () => null, setToolHandler: () => {},
  send: async () => {runtimeCalls++; throw Error('This settings smoke must not invoke a model');},
};
async function request(route, body) {
  const response = await apiFetch(server, 'api/' + route, body === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const result = await response.json(); assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`); return result;
}
async function poll(read, check, label, timeout = 25000) {
  const until = Date.now() + timeout; let value;
  do {value = await read(); if(check(value))return value; await pause(100);} while(Date.now() < until);
  throw Error(`${label}: ${JSON.stringify(value)}`);
}
function persistedEnabled() {
  const database = new DatabaseSync(path.join(dataRoot, '.sciencescope-local/state/sciencescope.sqlite'), {readOnly: true});
  try {return database.prepare('SELECT enabled FROM rb_embedding_settings WHERE id=1').get().enabled;} finally {database.close();}
}
async function ready() {
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopePreferences?.ready);
  await page.evaluate(() => Promise.all([window.ScienceScopeWorkspace.ready, window.ScienceScopePreferences.ready]));
}
async function settings() {
  await page.evaluate(() => go('library-settings'));
  await page.waitForSelector('[data-semantic-settings] [data-semantic-action]');
}
const section = () => page.locator('section').filter({has: page.locator('[data-semantic-settings]')});
const button = action => page.locator(`[data-semantic-action="${action}"]`);
async function freePort() {
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
async function processSnapshot() {
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const {stdout} = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], {windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024, env: {...process.env, TEMP: root, TMP: root}});
  const result = JSON.parse(stdout); return Array.isArray(result) ? result : [result];
}
async function captureNative() {
  const all = await processSnapshot(), ids = new Set([child.pid]); let changed = true;
  while(changed) {changed = false; for(const process of all)if(ids.has(process.ParentProcessId) && !ids.has(process.ProcessId)) {ids.add(process.ProcessId); changed = true;}}
  ownedNative = all.filter(process => ids.has(process.ProcessId));
  assert.ok(ownedNative.some(process => process.Name === 'node.exe'), 'native owns its readiness host child');
  assert.ok(ownedNative.some(process => /webview2/i.test(process.Name)), 'native owns actual WebView2 descendants');
}
async function launch() {
  if(!native) {
    browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {headless: true, executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', viewport: {width: 1440, height: 960}, env: {...process.env, TEMP: root, TMP: root}});
    page = await browser.newPage(); await installApiToken(page, server);
  } else {
    assert.equal(process.platform, 'win32', '--native requires Windows');
    const executable = path.join(root, 'sciencescope-desktop.exe');
    await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'), executable);
    diagnosticPort = await freePort();
    child = spawn(executable, [], {cwd: root, windowsHide: true, stdio: 'ignore', env: {...process.env, SCIENCESCOPE_NODE: process.execPath, SCIENCESCOPE_HOST_SCRIPT: path.resolve('scripts/native-fixture-host.mjs'), SCIENCESCOPE_TEST_HOST_URL: server.url, SCIENCESCOPE_TEST_API_TOKEN: server.apiToken, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${diagnosticPort}`, TEMP: root, TMP: root}});
    for(let attempt = 0; attempt < 60; attempt++) {try {browser = await chromium.connectOverCDP(`http://127.0.0.1:${diagnosticPort}`); break;} catch {await pause(500);}}
    assert.ok(browser, 'owned native diagnostic connection required');
    page = await poll(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith(server.url) && !candidate.url().includes('surface=')), Boolean, 'actual native main page');
    assert.ok(await page.evaluate(() => !!window.__TAURI__?.core?.invoke), 'actual Tauri bridge required');
    await captureNative();
  }
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {if(response.url().includes('/desktop/') && response.status() >= 400)assetFailures.push({url: response.url(), status: response.status()});});
  page.on('request', request => {
    const url = new URL(request.url());
    if(native && url.origin === 'http://ipc.localhost')nativeIpcRequests.push(url.origin);
    else if(['http:', 'https:'].includes(url.protocol) && url.origin !== new URL(server.url).origin)externalRequests.push(url.origin);
    if(url.pathname === '/api/research/embedding' && request.method() === 'POST')actions.push(request.postDataJSON()?.action);
  });
  if(!native)await page.goto(server.url);
  await ready(); await settings();
}
try {
  server = await createDesktopServer({dataRoot, outputDir: path.join(root, 'assets'), runtimeHost});
  await launch();
  phase = 'real default state and hardware';
  const initial = await poll(() => request('research/embedding'), value => value.hardware !== null, 'actual hardware detection completes');
  assert.equal(initial.enabled, false); assert.equal(initial.state, 'disabled'); assert.equal(persistedEnabled(), 0);
  assert.equal(initial.hardware.supported, true, `This machine must really satisfy T10 model-missing acceptance: ${JSON.stringify(initial.hardware)}`);
  await button('enable').waitFor(); assert.equal(await button('download').count(), 1); assert.equal(await button('rebuild').isEnabled(), false);
  const fixture = (await request('research/items', {item: {projectId: null, type: 'memory', subtype: 'goal', title: 'T10_UI_NEEDLE', body: 'This canonical entry stays readable during keyword fallback.'}})).item;

  phase = 'enable persists and missing model falls back';
  await button('enable').click();
  const enabled = await poll(() => request('research/embedding'), value => value.enabled && value.state === 'model-missing', 'enabled real service reports missing model');
  assert.equal(persistedEnabled(), 1); assert.equal(enabled.download, null);
  await button('disable').waitFor(); await page.waitForFunction(() => document.querySelector('[data-semantic-settings]')?.textContent.includes('本次为关键词检索'));
  const search = await request('research/search?q=T10_UI_NEEDLE');
  assert.equal(search.mode, 'keyword'); assert.equal(search.fallbackReason, 'model-missing');
  assert.ok(search.hits.some(hit => hit.ref.type === 'item' && hit.ref.id === fixture.id), 'real keyword fallback returns canonical content');
  await page.reload(); await ready(); await settings(); await button('disable').waitFor();
  assert.equal((await request('research/embedding')).enabled, true); assert.equal(persistedEnabled(), 1);

  phase = 'bilingual info tip and four language/theme screenshots';
  for(const language of ['zh-CN', 'en'])for(const theme of ['light', 'dark']) {
    await request('preferences', {language, theme}); await page.reload(); await ready(); await settings();
    await page.waitForFunction(({language, theme}) => document.documentElement.lang === language && document.documentElement.dataset.theme === theme, {language, theme});
    const expectedStatus = language === 'en' ? 'Model is not downloaded' : '模型未下载';
    await poll(() => section().innerText(), text => text.includes(expectedStatus), 'localized semantic status');
    const heading = language === 'en' ? 'Local hybrid retrieval' : '本地混合检索';
    assert.match(await section().locator('h2').innerText(), new RegExp(heading));
    assert.equal(await button('download').innerText(), language === 'en' ? 'Download or repair local model' : '下载或修复本地模型');
    assert.equal(await button('disable').innerText(), language === 'en' ? 'Disable semantic search' : '关闭语义检索');
    const tip = section().locator('[data-info-tip]');
    const explanation = language === 'en' ? 'The model runs locally' : '模型仅在本机运行';
    assert.ok(!(await section().innerText()).includes(explanation), 'explanation is behind the shared info tip');
    await section().scrollIntoViewIfNeeded();
    await tip.click(); await page.waitForSelector('#info-pop');
    await poll(() => page.locator('#info-pop').innerText(), text => text.includes(explanation), 'localized actual tooltip');
    assert.match(await page.locator('#info-pop').innerText(), /300\s?ms/);
    assert.equal(await tip.getAttribute('aria-expanded'), 'true');
    await page.waitForFunction(() => {const pop = document.querySelector('#info-pop'); return pop && Number(getComputedStyle(pop).opacity) > 0.99;});
    const file = path.join(output, `semantic-${language === 'en' ? 'en' : 'zh'}-${theme}.png`);
    // The settings content is an inner scroll pane. Full-page capture can
    // trigger its scroll-close handler and omit the controls below the fold.
    await page.screenshot({path: file}); screenshots.push(file);
    assert.equal(await page.locator('#info-pop').isVisible(), true, 'the screenshot includes the actual open info tip');
    await page.keyboard.press('Escape'); await page.waitForSelector('#info-pop', {state: 'detached'});
  }

  phase = 'disable persists and reload';
  await button('disable').click();
  await poll(() => request('research/embedding'), value => !value.enabled && value.state === 'disabled', 'disabled real service');
  assert.equal(persistedEnabled(), 0); await button('enable').waitFor(); assert.equal(await button('rebuild').isEnabled(), false);
  await page.reload(); await ready(); await settings(); await button('enable').waitFor();
  const finalStatus = await request('research/embedding'); assert.equal(finalStatus.enabled, false); assert.equal(finalStatus.state, 'disabled'); assert.equal(persistedEnabled(), 0);
  assert.equal((await request(`research/item?id=${fixture.id}`)).item.body, fixture.body, 'canonical entry is not modified by index settings');
  assert.deepEqual(actions, ['enable', 'disable']); assert.equal(finalStatus.download, null);
  assert.equal(await stat(finalStatus.modelDir).then(() => true, error => {if(error.code === 'ENOENT')return false; throw error;}), false, 'no model files were downloaded');
  assert.equal(runtimeCalls, 0); assert.deepEqual(errors, []); assert.deepEqual(assetFailures, []); assert.deepEqual(externalRequests, []);
  if(native) {
    phase = 'owned native process tree shutdown';
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(error => {if(!/closed/i.test(error.message))throw error;});
    await poll(async () => child.exitCode, value => value !== null, 'owned native main exits'); assert.equal(child.exitCode, 0);
    await poll(async () => {const all = await processSnapshot(); return ownedNative.filter(owned => all.some(process => process.ProcessId === owned.ProcessId));}, value => value.length === 0, 'all captured owned native descendants exit');
  }
  assert.deepEqual(externalRequests, [], 'native shutdown may use its local IPC bridge but not the internet');
  const result = {passed: true, native, productionRouter: true, realSemanticService: true, hardware: initial.hardware, defaultOff: true, enabledPersistedInSqlite: true, enabledSurvivesReload: true, missingModelVisible: true, realKeywordFallbackHits: true, disabledPersistedInSqlite: true, disabledSurvivesReload: true, bilingualInfoTip: true, canonicalEntryUnchanged: true, modelDownloadTriggered: false, modelCalls: runtimeCalls, paidRequests: 0, externalBrowserRequests: externalRequests, actions, screenshots, ...(native ? {nativeMainPid: child.pid, nativeMainExitCode: child.exitCode, nativeDiagnosticPort: diagnosticPort, nativeIpcRequests, ownedNativeProcesses: ownedNative, ownedNativeProcessesExited: true} : {})};
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch(error) {
  await page?.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {});
  console.error(JSON.stringify({phase, errors, assetFailures, message: error.message, screenshot: path.join(output, 'failure.png')})); throw error;
} finally {
  if(native && child?.exitCode === null) {await page?.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {}); await pause(1000); if(child.exitCode === null)child.kill();}
  await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  await rm(root, {recursive: true, force: true, maxRetries: 6, retryDelay: 500});
}
