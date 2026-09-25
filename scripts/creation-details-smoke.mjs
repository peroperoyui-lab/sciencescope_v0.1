// Browser smoke through the production router: creating an independent chat
// or a project asks for the working folder (and Python environment), and the
// chosen folder becomes the chat's runtime workspace. Offline; fake runtime.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'creation-smoke-'));
const existing = path.join(root, 'user-research', '已有文件夹'); await mkdir(existing, {recursive: true});
const starts = [];
const host = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [{id: 'offline', name: '离线', models: ['m'], configured: true, saved: true}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId, workspace}) => { starts.push(workspace); return sessionId || `session-s${starts.length}`; },
  configurePolicy: async () => {}, configureReasoning: async () => {}, releaseSession: async () => {}, getGoal: async () => null,
  send: async ({onEvent}) => { onEvent({type: 'completed', text: 'OK'}); return {finalResponse: 'OK'}; },
};
const server = await createDesktopServer({dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'assets'), runtimeHost: host});
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, viewport: {width: 1280, height: 860}, env: {...process.env, TEMP: root, TMP: root}});
  const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await installApiToken(page, server);
  await page.goto(server.url);
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeCreation);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await page.evaluate(() => { window.ScienceScopeModels = {available: () => true, selected: () => ({providerId: 'offline', modelId: 'm'})}; });
  const send = async text => {
    await page.locator('[data-draft="main"]').fill(text);
    await page.locator('[data-composer="main"] [data-v="send"]').click();
    await page.waitForFunction(t => !V.pending.has(V.chat) && S.messages.some(m => m.text === 'OK') && S.messages.some(m => m.text === t), text);
  };

  // 1. Independent chat: the dialog appears; cancel creates nothing.
  await page.evaluate(() => window.ScienceScopeCreation.newChat(null));
  await page.waitForSelector('#modal .creation-dialog');
  assert.equal(await page.locator('.creation-choice').count(), 3);
  assert.match(await page.locator('.creation-python').innerText(), /即将提供/, 'without the Python API the field says so');
  assert.equal(await page.locator('#chat-python').isDisabled(), true);
  const before = await page.evaluate(() => V.chat);
  await page.locator('[data-creation-cancel]').click();
  assert.equal(await page.locator('#modal').count(), 0);
  assert.equal(await page.evaluate(() => V.chat), before);

  // 2. Existing folder: a bad path is refused in place; a good one is used.
  await page.evaluate(() => window.ScienceScopeCreation.newChat(null));
  await page.waitForSelector('#modal .creation-dialog');
  await page.locator('input[name="chat-folder"][value="existing"]').check();
  await page.locator('#chat-folder-path').fill(path.join(root, 'nope'));
  await page.locator('[data-creation-start]').click();
  await page.waitForFunction(() => document.querySelector('[data-chat-folder-note]')?.textContent.includes('不存在'));
  await page.locator('#chat-folder-path').fill(existing);
  await page.locator('[data-creation-start]').click();
  await page.waitForFunction(() => !document.querySelector('#modal'));
  assert.equal(await page.locator('[data-draft="main"]').count(), 1, 'the welcome draft follows the dialog');
  await send('用已有文件夹');
  assert.equal(starts.at(-1), existing);

  // 3. Default choice: a new folder for this chat.
  await page.evaluate(() => window.ScienceScopeCreation.newChat(null));
  await page.waitForSelector('#modal .creation-dialog');
  await page.locator('[data-creation-start]').click();
  await page.waitForFunction(() => !document.querySelector('#modal'));
  const chatId = await page.evaluate(() => V.chat);
  await send('默认新文件夹');
  assert.equal(starts.at(-1), path.join(root, 'app', '.sciencescope-local', 'projects', 'independent', chatId));

  // 4. Project page: the 工作目录 field is validated and bound.
  await page.evaluate(() => go('project-new'));
  await page.waitForSelector('#new-project-path[data-enhanced]');
  await page.waitForSelector('#new-project-python');
  await page.screenshot({path: path.join(base, 'creation-project.png')});
  assert.equal(await page.locator('#new-project-path').inputValue(), '', 'the prototype placeholder path is not submitted');
  assert.equal(await page.locator('#new-project-python').count(), 1);
  await page.locator('#new-project-name').fill('禁食研究');
  await page.locator('#new-project-path').fill('/etc');
  await page.locator('[data-action="create-project"]').click();
  await page.waitForFunction(() => document.querySelector('[data-project-folder-note]')?.hasAttribute('data-error'));
  assert.equal(await page.evaluate(() => S.projects.some(p => p.name === '禁食研究')), false, 'a refused folder creates no project');
  await page.locator('#new-project-path').fill(existing);
  await page.locator('[data-action="create-project"]').click();
  await page.waitForFunction(() => S.projects.some(p => p.name === '禁食研究'));
  const projectId = await page.evaluate(() => S.projects.find(p => p.name === '禁食研究').id);
  let folder;
  for (let i = 0; i < 40 && folder !== existing; i++) { folder = JSON.parse(await (await apiFetch(server, `/api/workbench?projectId=${projectId}`)).text()).folder; if (folder !== existing) await page.waitForTimeout(100); }
  assert.equal(folder, existing, 'the project is bound to the chosen folder');

  // 5. A chat inside the project does not ask.
  await page.evaluate(id => window.ScienceScopeCreation.newChat(id), projectId);
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#modal').count(), 0);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.ScienceScopeCreation.newChat(null); });
  await page.waitForSelector('#modal .creation-dialog');
  await page.locator('input[name="chat-folder"][value="existing"]').check();
  await page.mouse.move(5, 5);
  await page.screenshot({path: path.join(base, 'creation-dialog.png')});
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(400); // let theme transitions settle
  await page.screenshot({path: path.join(base, 'creation-dialog-dark.png')});
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({dialog: true, cancel: true, existingFolder: true, defaultNewFolder: true, projectFolderBound: true, projectChatNoDialog: true, pythonPending: true, screenshot: path.join(base, 'creation-dialog.png')}));
} finally { await browser?.close(); await server.close(); await rm(root, {recursive: true, force: true}); }
