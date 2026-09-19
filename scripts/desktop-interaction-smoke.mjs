// Offline browser acceptance for the generated desktop shell. No provider or credentials.
import http from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { buildDesktop } from './build-desktop.mjs';
import { defaultRoot } from './prepare-desktop.mjs';
import { createChatStore, ProfileStore } from './chat-store.mjs';

const tempBase = path.join(defaultRoot, '.sciencescope-local', 'temp');
await mkdir(tempBase, { recursive: true });
const tempRoot = await mkdtemp(path.join(tempBase, 'desktop-interaction-'));
process.env.TEMP = tempRoot; process.env.TMP = tempRoot;
const artifacts = path.join(defaultRoot, '.sciencescope-local', 'desktop-interaction-smoke');
await mkdir(artifacts, { recursive: true });
const store = await createChatStore({ stateDir: path.join(tempRoot, 'state') });
const profileStore = await new ProfileStore({ stateDir: path.join(tempRoot, 'state') }).init();
await store.updateWorkspace({ projects: [{ id: 'p1', name: '交互验收项目', desc: '离线 fixture' }], pins: [], projectExpanded: { p1: true }, lastChatId: null });
const entry = await buildDesktop();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    let input = {};
    if (req.method === 'POST') { const chunks = []; for await (const chunk of req) chunks.push(chunk); input = JSON.parse(Buffer.concat(chunks)); }
    if (url.pathname === '/api/status') return send({ available: true, saveProvider: false, tokenStreaming: true });
    if (url.pathname === '/api/providers') return send({ providers: [] });
    if (url.pathname === '/api/profile') return send(req.method === 'POST' ? await profileStore.updateProfile(input) : profileStore.getProfile());
    if (url.pathname === '/api/workspace') return send(req.method === 'POST' ? await store.updateWorkspace(input) : await store.getWorkspace());
    if (url.pathname === '/api/chats') return send({ chats: store.listChats() });
    const messages = url.pathname.match(/^\/api\/chats\/(.+)\/messages$/);
    if (messages) return send(await store.pageMessages(messages[1], Object.fromEntries(url.searchParams)));
    if (url.pathname === '/api/chats/update') return send(await store.updateMetadata(input.chatId, input));
    if (url.pathname === '/api/chats/mode') return send({mode:input.mode,message:await store.appendMessage({chatId:input.chatId,id:input.messageId,role:'system',text:'工作方式已切换为自由讨论（当前仍由主专家执行，尚未接入多专家调度）。'})});
    if (url.pathname === '/api/chats/move') return send(await store.move(input.chatId, input.projectId));
    if (url.pathname === '/api/chat') {
      if (!input.temporary) { await store.ensureChat(input); await store.appendMessage({ chatId: input.chatId, id: input.userMessageId, role: 'user', text: input.text }); }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ type: 'accepted' }) + '\n');
      res.write(JSON.stringify({ type: 'text-delta', delta: '离线验收回复。' }) + '\n');
      if (!input.temporary) await store.appendMessage({ chatId: input.chatId, id: input.assistantMessageId, role: 'assistant', text: '离线验收回复。' });
      res.end(JSON.stringify({ type: 'completed', text: '离线验收回复。' }) + '\n'); return;
    }
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(path.dirname(entry), relative);
    if (!file.startsWith(path.dirname(entry) + path.sep)) throw new Error('Invalid asset');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(file));
  } catch (error) { res.writeHead(500); res.end(JSON.stringify({ message: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let context;
try {
  context = await chromium.launchPersistentContext(path.join(tempRoot, 'edge-profile'), {
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1440, height: 960 }, env: { ...process.env, TEMP: tempRoot, TMP: tempRoot },
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ScienceScopeWorkspace && window.ScienceScopeExecution);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await page.evaluate(() => { window.ScienceScopeModels = { available: () => true, selected: () => ({ providerId: 'offline', modelId: 'offline' }) }; newThread('p1'); });
  await page.evaluate(() => window.SS.submitMain('交互验收消息'));
  await page.waitForSelector('.message-text');

  const browserGuards = await page.evaluate(() => {
    const target = document.querySelector('.topbar') || document.body;
    const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); target.dispatchEvent(context);
    const f12 = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F12' }); target.dispatchEvent(f12);
    return { contextPrevented: context.defaultPrevented, f12Prevented: f12.defaultPrevented };
  });
  assert.deepEqual(browserGuards, { contextPrevented: true, f12Prevented: true });

  const selectability = await page.evaluate(() => {
    const table = document.createElement('table'); table.innerHTML = '<tbody><tr><td>fixture</td></tr></tbody>'; document.body.append(table);
    const css = selector => getComputedStyle(document.querySelector(selector)).userSelect;
    const selection = getComputedStyle(document.documentElement, '::selection').backgroundColor;
    return { shell: css('.topbar'), message: css('.message-text'), table: css('table'), selection };
  });
  assert.equal(selectability.shell, 'none'); assert.equal(selectability.message, 'text'); assert.equal(selectability.table, 'text');
  assert.match(selectability.selection, /rgb\(222, 222, 219\)|rgba\(222, 222, 219/);

  await page.locator('[data-route="quick"]').click({ button: 'right' });
  assert.ok(await page.locator('#v-menu').isVisible(), 'application context menu survives browser guard');
  assert.ok((await page.locator('#v-menu .menu-line').count()) >= 1, 'custom menu has first item');
  await page.keyboard.press('Escape');

  const trigger = page.locator('[data-v="mode-menu"]').first();
  await trigger.click();
  const menuBox = await page.locator('#v-menu').boundingBox(); const triggerBox = await trigger.boundingBox();
  assert.ok(menuBox && triggerBox && menuBox.y < triggerBox.y, 'execution policy menu opens above composer');
  assert.equal(await page.locator('#v-menu').evaluate(el => el.closest('dialog,.modal') === null), true);
  assert.equal(await page.locator('#v-menu .menu-line').count(), 3);
  const policy = await page.locator('#v-menu .menu-line').evaluateAll(items => items.map(item => ({ text: item.innerText, color: getComputedStyle(item).color, tip: item.querySelector('.choice-tooltip')?.innerText || '' })));
  assert.match(policy[1].text, /完全接管/); assert.match(policy[2].text, /自动化/);
  assert.match(policy[1].color, /rgb\(155, 86, 83\)|rgb\(155, 86, 83\)/); assert.ok(policy[1].tip && policy[2].tip);
  const before = await page.evaluate(() => {window.originalComposer=document.querySelector('[data-draft="main"]');window.originalTranscript=document.querySelector('.messages');return {scrollY};});
  await page.locator('#v-menu .menu-line').nth(2).click();
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(y => scrollY, before.scrollY), before.scrollY, 'mode change preserves scroll');
  assert.equal(await page.evaluate(() => window.originalComposer===document.querySelector('[data-draft="main"]')&&window.originalTranscript===document.querySelector('.messages')), true, 'policy choice keeps exact composer/transcript nodes');
  await page.locator('[data-v="work-mode"]').click();
  await page.locator('[data-work-mode="free"]').click();
  await page.waitForFunction(()=>S.messages.at(-1)?.text.includes('工作方式已切换'));
  assert.equal(await page.evaluate(()=>window.originalComposer===document.querySelector('[data-draft="main"]')&&window.originalTranscript===document.querySelector('.messages')),true);
  assert.equal(await page.evaluate(()=>{const box=document.querySelector('.messages');return box.scrollHeight-box.clientHeight-box.scrollTop<3;}),true);

  await page.locator('[data-v="mode-menu"]').first().click();
  await page.locator('#v-menu .menu-line').nth(1).click();
  await page.waitForSelector('dialog');
  const modal = page.locator('dialog').first();
  assert.equal(await modal.locator('button[value="cancel"]').count(), 1, 'native confirmation has a cancel control');
  await modal.locator('button[value="cancel"]').click();
  const xPlacement = await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'modal'; host.innerHTML = '<section class="modal" style="width:320px;height:120px"><h2>fixture</h2><button data-action="close-modal">×</button></section>'; document.body.append(host);
    const box = host.querySelector('.modal').getBoundingClientRect(); const x = host.querySelector('[data-action="close-modal"]').getBoundingClientRect(); host.remove();
    return x.right > box.right - 40 && x.top <= box.top + 16;
  });
  assert.equal(xPlacement, true, 'modal X is right aligned');
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(artifacts, 'desktop-interaction.png') });
  console.log(JSON.stringify({ browserContextmenuPrevented: true, f12Prevented: true, shellSelection: 'none', textSelection: 'text', selectionGray: '#dededb', customContextMenu: true, executionMenuAboveComposer: true, policyTooltips: true, modePreservedDomAndScroll: true, nativeConfirmCancel: true, modalXRight: true, realProviderRequests: 0 }));
} finally {
  await context?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  store.close?.(); profileStore.close?.(); await rm(tempRoot, { recursive: true, force: true });
}
