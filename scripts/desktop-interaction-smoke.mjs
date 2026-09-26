// Offline browser acceptance for the generated desktop shell. No provider or credentials.
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createDesktopServer } from './preview-desktop.mjs';
import { installApiToken } from './smoke-auth.mjs';
import { createChatStore, ProfileStore } from './chat-store.mjs';

const tempBase = path.resolve('.sciencescope-local', 'temp');
await mkdir(tempBase, { recursive: true });
const tempRoot = await mkdtemp(path.join(tempBase, 'desktop-interaction-'));
process.env.TEMP = tempRoot; process.env.TMP = tempRoot;
const artifacts = path.join(tempBase, 'desktop-interaction-smoke');
await mkdir(artifacts, { recursive: true });
const store = await createChatStore({ stateDir: path.join(tempRoot, '.sciencescope-local', 'state') });
const profileStore = await new ProfileStore({ stateDir: path.join(tempRoot, '.sciencescope-local', 'state') }).init();
await store.updateWorkspace({ projects: [{ id: 'p1', name: '交互验收项目', desc: '离线 fixture' }], pins: [], projectExpanded: { p1: true }, lastChatId: null });
// Close the seed handles before the production API opens the same state files.
store.close?.(); profileStore.close?.();
const server = await createDesktopServer({
  dataRoot: tempRoot,
  outputDir: path.join(tempRoot, 'assets'),
  runtimeHost: {
    capabilities: { tokenStreaming: true },
    listProviders: async () => [],
    startSession: async ({ sessionId }) => sessionId || 'offline-session',
    configurePolicy: async () => {}, configureReasoning: async () => {},
    observeSession: () => () => {}, releaseSession: async () => {},
    getGoal: async () => null, getContextUsage: async () => null,
    send: async ({ onEvent }) => {
      onEvent({ type: 'text-delta', delta: '离线验收回复。' });
      onEvent({ type: 'completed', text: '离线验收回复。' });
    },
    close: async () => {},
  },
});

let context;
let page;
try {
  context = await chromium.launchPersistentContext(path.join(tempRoot, 'edge-profile'), {
    executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: { width: 1440, height: 960 }, env: { ...process.env, TEMP: tempRoot, TMP: tempRoot },
  });
  page = await context.newPage();
  await installApiToken(page, server);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.url);
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
    // Interface refresh (2026-09-24): selection is the accent at 22%, not the old #dededb gray.
    const probe = document.createElement('i'); probe.style.background = 'color-mix(in srgb, var(--accent) 22%, transparent)'; document.body.append(probe);
    const expected = getComputedStyle(probe).backgroundColor; probe.remove();
    return { shell: css('.topbar'), message: css('.message-text'), table: css('table'), selection, expected };
  });
  assert.equal(selectability.shell, 'none'); assert.equal(selectability.message, 'text'); assert.equal(selectability.table, 'text');
  assert.equal(selectability.selection, selectability.expected, 'selection uses the refreshed accent tint');

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
  const policy = await page.locator('#v-menu .menu-line').evaluateAll(items => items.map(item => ({ text: item.innerText, color: getComputedStyle(item).color, tip: item.querySelector('.info-tip')?.dataset.infoTip || '' })));
  assert.match(policy[1].text, /完全接管/); assert.match(policy[2].text, /自动化/);
  assert.match(policy[1].color, /rgb\(155, 86, 83\)|rgb\(155, 86, 83\)/); assert.ok(policy[1].tip && policy[2].tip);
  const before = await page.evaluate(() => {window.originalComposer=document.querySelector('[data-draft="main"]');window.originalTranscript=document.querySelector('.messages');return {scrollY};});
  await page.locator('#v-menu .menu-line').nth(2).click();
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(y => scrollY, before.scrollY), before.scrollY, 'mode change preserves scroll');
  assert.equal(await page.evaluate(() => window.originalComposer===document.querySelector('[data-draft="main"]')&&window.originalTranscript===document.querySelector('.messages')), true, 'policy choice keeps exact composer/transcript nodes');
  await page.locator('[data-v="work-mode"]').click();
  await page.locator('[data-work-mode="ordered"]').click(); // free discussion was removed (2026-09-24)
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
  console.log(JSON.stringify({ browserContextmenuPrevented: true, f12Prevented: true, shellSelection: 'none', textSelection: 'text', selectionAccentTint: true, customContextMenu: true, executionMenuAboveComposer: true, policyTooltips: true, modePreservedDomAndScroll: true, nativeConfirmCancel: true, modalXRight: true, realProviderRequests: 0 }));
} catch (error) {
  await mkdir(path.join(tempBase, 'local-validation'), { recursive: true });
  await page?.screenshot({ path: path.join(tempBase, 'local-validation', 'desktop-interaction-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close(); await server.close(); await rm(tempRoot, { recursive: true, force: true });
}
