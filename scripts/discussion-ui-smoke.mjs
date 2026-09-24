// Offline browser smoke for expert discussion in the Main composer.
// Browser: SCIENCESCOPE_BROWSER, else installed Edge (Windows default).
import http from 'node:http';
import path from 'node:path';
import {readFile, mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {buildDesktop} from './build-desktop.mjs';
import {defaultRoot} from './prepare-desktop.mjs';

const entry = await buildDesktop();
const output = path.join(defaultRoot, '.sciencescope-local', 'temp', 'discussion-ui-smoke');
await mkdir(output, {recursive: true});
process.env.TEMP = output; process.env.TMP = output;
const roster = [
  {id: 'methodologist', label: '方法学家', role: '研究设计', persona: 'persona of methodologist', model: null, enabled: true},
  {id: 'statistician', label: '统计审稿人', role: '统计与数据', persona: 'persona of statistician', model: null, enabled: true},
  {id: 'red-team', label: '魔鬼代言人', role: '反方审阅', persona: 'persona of red-team', model: null, enabled: false},
];
const calls = [];
const json = (res, body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = {}; if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; }
  if (url.pathname === '/api/experts') {
    if (req.method === 'POST') { calls.push({route: 'experts', body}); roster.splice(0, roster.length, ...body.experts.map((expert, position) => ({...expert, position}))); }
    return json(res, {experts: roster, available: true});
  }
  if (url.pathname === '/api/providers') return json(res, {providers: [{id: 'offline', name: '离线', models: ['model-a', 'model-b']}]});
  if (url.pathname.startsWith('/api/research-input/draft')) return json(res, req.method === 'POST' ? {saved: true} : {attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: []});
  if (url.pathname === '/api/workspace') return json(res, {projects: [], pins: [], projectExpanded: {}, lastChatId: null});
  if (url.pathname === '/api/chats') return json(res, {chats: []});
  if (url.pathname.startsWith('/api/chats/')) return json(res, {chat: {}, messages: [], total: 0, before: null, after: null});
  if (url.pathname === '/api/status') return json(res, {available: true});
  if (url.pathname.startsWith('/api/chat/outbox')) return json(res, {paused: false, items: []});
  if (url.pathname === '/api/chat') { calls.push({route: 'chat', body}); res.writeHead(200, {'Content-Type': 'application/x-ndjson'}); res.write(JSON.stringify({type: 'accepted'}) + '\n'); res.end(JSON.stringify({type: 'completed', text: 'MAIN_REPLY'}) + '\n'); return; }
  if (url.pathname === '/api/discussion') {
    calls.push({route: 'discussion', body});
    const panel = roster.filter(expert => body.expertIds.includes(expert.id));
    res.writeHead(200, {'Content-Type': 'application/x-ndjson'});
    const experts = panel.map(expert => ({id: expert.id, label: expert.label, role: expert.role, model: {providerId: 'offline', modelId: `model-${expert.id}`}, messageId: `msg-${body.kind}-${expert.id}-${calls.length}`}));
    res.write(JSON.stringify({type: 'accepted', runId: 'r', kind: body.kind, userMessageId: body.userMessageId, experts}) + '\n');
    // Finish in reverse order: display must still follow the roster.
    for (const expert of experts) res.write(JSON.stringify({type: 'expert-tool', runId: 'r', expertId: expert.id, messageId: expert.messageId, name: 'bash'}) + '\n');
    for (const expert of experts) res.write(JSON.stringify({type: 'expert-delta', runId: 'r', expertId: expert.id, messageId: expert.messageId, delta: `PARTIAL_${expert.id}`}) + '\n');
    await new Promise(r => setTimeout(r, 400));
    for (const expert of [...experts].reverse()) { await new Promise(r => setTimeout(r, 120)); res.write(JSON.stringify({type: 'expert-end', runId: 'r', expertId: expert.id, messageId: expert.messageId, text: `**${expert.label}** ${body.kind} ANSWER`, stopReason: 'completed'}) + '\n'); }
    res.end(JSON.stringify({type: 'completed', runId: 'r', failed: 0}) + '\n'); return;
  }
  try {
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(path.dirname(entry), relative);
    if (!file.startsWith(path.dirname(entry) + path.sep)) throw new Error('Invalid asset');
    res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(output, 'profile'), {
    executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: {width: 1440, height: 960}, env: {...process.env, TEMP: output, TMP: output},
  });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.ScienceScopeDiscussion && window.ScienceScopeWorkMode && window.SSV2);
  await page.evaluate(() => window.ScienceScopeWorkspace.ready);
  await page.evaluate(() => { window.ScienceScopeModels = {available: () => true, selected: () => ({providerId: 'offline', modelId: 'main-model'})}; go('work'); });
  const chooseMode = async label => {
    await page.locator('[data-v="work-mode"],[data-action="work-mode"]').first().click();
    await page.locator('[data-work-mode]', {hasText: label}).click();
    await page.waitForFunction(text => document.querySelector('[data-v="work-mode"],[data-action="work-mode"]')?.textContent.includes(text), label);
  };
  // A new chat keeps the approved welcome layout (no mode button) until its
  // first message, so start with an ordinary Main turn.
  await page.locator('[data-draft="main"]').fill('普通主专家消息');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.some(m => m.text === 'MAIN_REPLY'));
  assert.equal(calls[0].route, 'chat'); calls.length = 0;
  // Ordered: every enabled expert, roster order, real authors.
  await chooseMode('有序讨论');
  await page.waitForSelector('[data-discussion-strip]');
  assert.match(await page.locator('[data-discussion-strip]').innerText(), /1 方法学家[\s\S]*2 统计审稿人/);
  await page.locator('[data-draft="main"]').fill('这个因果结论成立吗？');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => document.querySelector('.message[data-streaming] .message-text')?.textContent.includes('PARTIAL_'));
  await page.waitForFunction(() => S.messages.filter(m => m.expert && !m.streaming).length === 2 && !V.pending.has(V.chat));
  assert.equal(await page.locator('.message:not(.user) .message-text', {hasText: 'PARTIAL_'}).count(), 0, 'final text replaces the partial stream');
  assert.deepEqual(calls[0].body.expertIds, ['methodologist', 'statistician']);
  assert.equal(calls[0].body.kind, 'independent');
  const heads = (await page.locator('.message:not(.user) .messagehead').allInnerTexts()).slice(1);
  assert.match(heads[0], /方法学家[\s\S]*model-methodologist/); assert.match(heads[1], /统计审稿人[\s\S]*model-statistician/);
  assert.equal(await page.locator('.message:not(.user) .message-text strong').first().innerText(), '方法学家');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), '');
  // Cross-critique uses the strip button, no composer text.
  await page.locator('[data-discussion-critique]').click();
  await page.waitForFunction(() => S.messages.filter(m => m.expert && !m.streaming).length === 4 && !V.pending.has(V.chat));
  assert.equal(calls[1].body.kind, 'critique'); assert.equal(calls[1].body.text, '');
  assert.match(await page.locator('.message.user').last().innerText(), /请专家互相质询/);
  // Free: only @-named experts; none named is refused without a request.
  await chooseMode('自由讨论');
  await page.locator('[data-draft="main"]').fill('没有点名的问题');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForTimeout(200);
  assert.equal(calls.length, 2);
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), '没有点名的问题');
  // Typing @ offers enabled experts; Enter picks one and never sends.
  await page.locator('[data-draft="main"]').fill('');
  await page.locator('[data-draft="main"]').pressSequentially('@统');
  await page.waitForSelector('.mention-menu [data-mention]');
  assert.equal(await page.locator('.mention-menu [data-mention]').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(calls.length, 2, 'choosing a mention does not send');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), '@统计审稿人 ');
  assert.equal(await page.locator('.mention-menu').count(), 0);
  await page.locator('[data-draft="main"]').pressSequentially('样本量够吗？');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => S.messages.filter(m => m.expert && !m.streaming).length === 5 && !V.pending.has(V.chat));
  assert.deepEqual(calls[2].body.expertIds, ['statistician']);
  // Back to work mode: the ordinary Main path, strip removed.
  await chooseMode('工作');
  assert.equal(await page.locator('[data-discussion-strip]').count(), 0);
  await page.locator('[data-draft="main"]').fill('回到工作模式');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.filter(m => m.text === 'MAIN_REPLY').length === 2);
  assert.equal(calls[3].route, 'chat');
  await page.screenshot({path: path.join(output, 'discussion.png')});
  // Settings → 专家角色: edit, add, reorder, save; the discussion strip follows.
  await page.evaluate(() => go('experts'));
  await page.waitForSelector('[data-expert-roster] [data-expert-index]');
  assert.equal(await page.locator('[data-expert-index]').count(), 3);
  await page.locator('[data-expert-index="1"] [name="label"]').fill('统计学家');
  await page.locator('[data-expert-add]').click();
  await page.waitForSelector('[data-expert-index="3"]');
  assert.equal(await page.locator('[data-expert-index="1"] [name="label"]').inputValue(), '统计学家', 'unsaved edits survive add');
  await page.locator('[data-expert-index="3"] [name="label"]').fill('领域专家');
  await page.locator('[data-expert-index="3"] [name="model"]').selectOption({label: '离线 / model-b'});
  await page.locator('[data-expert-index="3"] [data-expert-move="-1"]').click();
  await page.locator('[data-expert-roster] [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-expert-feedback]')?.textContent.includes('已保存'));
  const savedCall = calls.find(call => call.route === 'experts');
  assert.deepEqual(savedCall.body.experts.map(expert => expert.label), ['方法学家', '统计学家', '领域专家', '魔鬼代言人']);
  assert.deepEqual(savedCall.body.experts[2].model, {providerId: 'offline', modelId: 'model-b'});
  assert.equal(savedCall.body.experts[1].id, 'statistician', 'rename keeps the stable id');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({liveExpertText: true, rosterEditor: true, orderedAllEnabled: true, rosterOrderDisplay: true, realAuthors: true, critiqueRound: true, freeMentionsOnly: true, mentionMenu: true, workModeUnchanged: true, localRequests: calls.length, paidRequests: 0}));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
