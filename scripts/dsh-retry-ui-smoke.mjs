// Offline browser acceptance worker; --serve optionally keeps its fixture open
// for manual inspection. Real SDK/profile/API/assets and normal composer;
// localhost provider returns two 502s before success. No paid requests.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';
import { createDesktopServer } from './preview-desktop.mjs';
import { installApiToken, apiFetch } from './smoke-auth.mjs';

const serve = process.argv.includes('--serve');
const output = path.resolve('.sciencescope-local/temp/t10-transport-validation/retry-ui');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'run-'));
const requests = [], events = [];
const fixture = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  requests.push(JSON.parse(raw));
  if (requests.length <= 2) {
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end('{"error":{"type":"server_error","message":"temporary local fixture failure"}}');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end('data: {"choices":[{"delta":{"content":"RETRY_RECOVERED: one successful answer after two temporary failures."}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const model = { providerId: 'retry-fixture', modelId: 'offline' };
const config = { providers: { [model.providerId]: { api: 'openai-completions',
  apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY', baseURL: `http://127.0.0.1:${fixture.address().port}/v1`,
  models: [{ id: model.modelId, name: 'Retry fixture', contextWindow: 32768, maxTokens: 256 }],
} } };
const host = await createDshHost({ home: path.join(root, 'app/.sciencescope-local/dsh'), cwd: root,
  sessionHeaders: ['x-fixture-session'], env: { SCIENCESCOPE_OFFLINE_KEY: 'local-only' } });
host.getRuntimeConfig = async () => config;
host.listProviders = async () => [{ id: model.providerId, name: 'Local retry fixture', configured: true, saved: true, models: [model.modelId] }];
host.getModelInfo = async () => ({ id: model.modelId, name: 'Retry fixture' });
const send = host.send.bind(host);
host.send = input => send({ ...input, onEvent: event => { events.push(event); input.onEvent?.(event); } });
const server = await createDesktopServer({ dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'build'), runtimeHost: host });
// Equivalent to the native shell's origin-scoped token bootstrap, installed
// only into this ignored fixture build. Keep production source untouched.
const index = path.join(root, 'build/index.html');
if (serve) await writeFile(index, (await readFile(index, 'utf8')).replace('<head>', `<head><script>Object.defineProperty(window,'__SCIENCESCOPE_API_TOKEN__',{value:${JSON.stringify(server.apiToken)},writable:false,enumerable:false,configurable:false});</script>`));
await writeFile(path.join(root, 'fixture.json'), JSON.stringify({ url: server.url, root, evidence: path.join(root, 'receipt.json') }, null, 2));
if (serve) console.log(JSON.stringify({ url: server.url, root }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await server.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  const completed = events.filter(event => event.type === 'completed');
  const receipt = { physicalRequests: requests.length, completedAnswers: completed.length,
    terminalErrors: events.filter(event => ['failed', 'error', 'cancelled'].includes(event.type)),
    retryPayloadsEqual: requests.length >= 3 && JSON.stringify(requests[0]) === JSON.stringify(requests[1]) && JSON.stringify(requests[1]) === JSON.stringify(requests[2]),
    paidRequests: 0, text: completed[0]?.text ?? null };
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2));
  assert.equal(receipt.physicalRequests, 3); assert.equal(receipt.completedAnswers, 1);
  assert.deepEqual(receipt.terminalErrors, []); assert.equal(receipt.retryPayloadsEqual, true);
  console.log(JSON.stringify(receipt));
}
process.on('SIGINT', () => { void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
process.on('SIGTERM', () => { void close().then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
if (!serve) {
  // Standalone browser worker follows the repository's opt-in smoke pattern;
  // it is independent from any user browser/profile or in-app browser tab.
  const { chromium } = await import('playwright-core');
  let context;
  const browserErrors = [], badAssets = [], snapshots = [];
  try {
    context = await chromium.launchPersistentContext(path.join(root, 'browser-profile'), {
      headless: true, executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      viewport: { width: 1440, height: 960 }, env: { ...process.env, TEMP: root, TMP: root },
    });
    const page = await context.newPage(); await installApiToken(page, server);
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).pathname.startsWith('/desktop/')) badAssets.push(response.url());
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeModels);
    await page.evaluate(() => window.ScienceScopeWorkspace.ready);
    await page.evaluate(() => window.ScienceScopeModels.select({ providerId: 'retry-fixture', modelId: 'offline' }));
    await page.getByRole('textbox', { name: '主输入框' }).fill('Reply briefly with the fixture answer.');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await page.getByText('RETRY_RECOVERED: one successful answer after two temporary failures.', { exact: true }).waitFor({ state: 'visible', timeout: 60000 });
    await page.getByRole('button', { name: '发送', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText('RETRY_RECOVERED: one successful answer after two temporary failures.', { exact: true }).count(), 1);
    assert.deepEqual(await page.evaluate(() => S.messages.filter(message => message.role === 'system').map(message => message.text)), []);
    assert.equal(await page.locator('.chat-activity-badge[data-state="failed"]').count(), 0);
    assert.deepEqual(browserErrors, []); assert.deepEqual(badAssets, []);
    const chats = await apiFetch(server, 'api/chats').then(response => response.json());
    assert.equal(chats.chats.length, 1);
    const saved = await apiFetch(server, `api/chats/${chats.chats[0].id}/messages`).then(response => response.json());
    assert.equal(saved.messages.filter(message => message.role === 'assistant').length, 1);
    for (const [language, theme] of [['zh', 'light'], ['en', 'dark']]) {
      await page.evaluate(({ language, theme }) => {
        window.ScienceScopeI18n?.setLanguage?.(language); document.documentElement.dataset.theme = theme;
      }, { language, theme });
      const screenshot = path.join(root, `retry-recovered-${language}-${theme}.png`);
      await page.screenshot({ path: screenshot }); snapshots.push(screenshot);
    }
    await writeFile(path.join(root, 'ui-receipt.json'), JSON.stringify({ passed: true, browserErrors, badAssets,
      terminalTypes: events.filter(event => ['completed', 'failed', 'error', 'cancelled'].includes(event.type)).map(event => event.type), snapshots }, null, 2));
  } finally { await context?.close(); await close(); }
}
