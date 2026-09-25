// Screenshot gallery of the real desktop UI with seeded, deterministic data.
// Offline (simulated model); used to review visual changes before/after.
// Usage: SCIENCESCOPE_BROWSER=<chromium> node scripts/ui-gallery.mjs <out-dir>
import path from 'node:path';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const out = path.resolve(process.argv[2] || '.sciencescope-local/temp/ui-gallery');
await mkdir(out, {recursive: true});
const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'gallery-'));
const model = {providerId: 'sciencescope-demo', modelId: 'deepseek-v4.1-flash'};
const reply = `我先把问题拆成两部分：**证据强度**与**方法适用条件**。

1. 对照组来自不同人群（跑步社 vs 非社团学生），训练量与饮食是明显的混杂因素。
2. 24 项指标未做多重比较校正，两个 p≈0.04 的结果与随机波动一致。

| 检查项 | 结论 |
| --- | --- |
| 随机分组 | 否 |
| 预注册主要终点 | 未说明 |

\`\`\`python
from statsmodels.stats.multitest import multipletests
multipletests([0.041, 0.048] + [0.3]*22, method="fdr_bh")
\`\`\`

建议先把结论降级为"相关"，再决定是否补做随机对照。`;
const experts = {
  methodologist: '**结论先行：不能得出因果结论。**\n\n- 自选择：志愿者来自跑步社，对照组是非社团学生，两组在基线运动量上就不同。\n- 缺少组间对比：只报告了组内前后变化。\n\n修正建议：同一招募框内随机分组，并以 ANCOVA 比较组间差异。',
  statistician: '**审核结论**\n\n- 方法学家：自选择与缺少组间比较的判断成立，依据是招募描述；ANCOVA 建议合理。\n- 魔鬼代言人：急性炎症解释有文献支持，但"采血时点不同"在材料中没有直接证据，属推测。\n\n**总结**：两位专家一致认为不能下因果结论；另需补充多重比较校正（24 项检验下 Bonferroni 阈值约 0.0021，两个结果都不显著）。',
  'red-team': '最强的替代解释：**训练引起的急性炎症**。跑步社成员采血时点若在训练后 24–48 小时内，CRP 会被短期推高，"改善"可能只是采血时间不同。\n\n能区分它的证据：统一采血时点并记录前 48 小时训练量。',
};
const host = {
  capabilities: {tokenStreaming: true, reasoningEffort: true},
  listProviders: async () => [{id: 'sciencescope-demo', name: 'OpenCode Go', baseUrl: 'https://opencode.ai/zen/go/v1', protocol: 'openai-chat-completions', models: ['deepseek-v4.1-flash', 'glm-5.3-flash', 'qwen3.8-flash'], configured: true, saved: true}],
  getModelInfo: async () => ({reasoning: {efforts: [{id: 'low', name: '低'}, {id: 'medium', name: '中'}, {id: 'high', name: '高'}]}}),
  getRuntimeConfig: async () => ({}), close: async () => {}, observeSession: () => () => {},
  startSession: async ({sessionId}) => sessionId || `session-demo${Math.random().toString(16).slice(2)}`,
  configurePolicy: async () => {}, configureReasoning: async () => {}, releaseSession: async () => {}, getGoal: async () => null,
  getContextUsage: async () => ({usedTokens: 46080, contextWindow: 128000, estimated: false}),
  send: async ({onEvent}) => {
    onEvent({type: 'text-delta', delta: '我先读取研究稿第三部分，确认原文怎么表述因果结论。'});
    onEvent({type: 'text-replace', text: ''});
    onEvent({type: 'tool-call', callId: 'c1', name: 'read', argumentsPreview: '{"path":"paper_versions/研究稿_v3.md"}', preamble: '我先读取研究稿第三部分，确认原文怎么表述因果结论。'});
    onEvent({type: 'tool-result', callId: 'c1', isError: false, resultPreview: '已读取 214 行'});
    onEvent({type: 'text-delta', delta: reply}); onEvent({type: 'completed', text: reply});
    return {finalResponse: reply};
  },
  runExperts: async ({runId, experts: panel, onEvent}) => panel.map(expert => {
    if (expert.id === 'methodologist') onEvent({type: 'expert-tool', runId, expertId: expert.id, callId: 'm1', name: 'read', argumentsPreview: '{"file_path":"paper_versions/研究稿_v3.md"}', preamble: '先核对研究稿里招募与分组的原文。'});
    const text = experts[expert.id] || '（示例回答）';
    onEvent({type: 'expert-end', runId, expertId: expert.id, text, stopReason: 'completed', ms: 30000});
    return {expertId: expert.id, stopReason: 'completed', text, ms: 30000};
  }),
  cancelExperts: async () => {},
};
const server = await createDesktopServer({dataRoot: root, outputDir: path.join(root, 'assets'), runtimeHost: host});
const post = async (route, body) => { const r = await apiFetch(server, route, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}); const t = await r.text(); if (!r.ok) throw new Error(route + ' ' + r.status + ' ' + t.slice(0, 200)); return t; };
const b64 = text => Buffer.from(text).toString('base64');
// Seed: profile, projects, chats, discussion, workbench, library.
await post('/api/profile', {displayName: '陈研究员', bio: '代谢组学方向'});
await post('/api/workspace', {projects: [{id: 'p-fasting', name: '间歇性禁食与代谢健康', desc: '评估间歇性禁食对年轻人代谢指标的影响'}, {id: 'p-sleep', name: '睡眠剥夺与认知', desc: ''}], pins: [{type: 'project', id: 'p-fasting'}], projectExpanded: {'p-fasting': true, 'p-sleep': false}, lastChatId: null});
await post('/api/chat', {chatId: 'chat-main', projectId: 'p-fasting', text: '先看看第三部分的因果结论是否站得住。', model, title: '第三部分因果结论复核'});
await post('/api/chat', {chatId: 'chat-2', projectId: 'p-fasting', text: '整理一下样本量计算。', model, title: '样本量与功效'});
await post('/api/chat', {chatId: 'chat-3', projectId: 'p-sleep', text: '列出主要文献。', model, title: '文献梳理'});
await post('/api/chat', {chatId: 'chat-4', projectId: null, text: '帮我润色摘要。', model, title: '摘要润色'});
await post('/api/discussion', {chatId: 'chat-main', projectId: 'p-fasting', model, kind: 'ordered', text: '请各自判断：能否得出"间歇性禁食改善代谢健康"的因果结论？', expertIds: ['methodologist', 'red-team'], reviewerId: 'statistician'});
for (const [name, text] of [['研究稿_v2.md', '# 研究稿\n\n第二版正文。'], ['研究稿_v3.md', '# 研究稿\n\n第三版正文，修订了方法部分。']]) await post('/api/workbench/import', {projectId: 'p-fasting', name, base64: b64(text), group: '研究稿'});
const wb = JSON.parse(await (await apiFetch(server, '/api/workbench?projectId=p-fasting')).text());
await post('/api/workbench/save', {projectId: 'p-fasting', revision: wb.revision, logs: [
  {id: 'log-1', title: '完成预实验数据清洗', note: '剔除 3 例缺失采血时点的样本。', date: '2026-09-18', files: []},
  {id: 'log-2', title: '专家组复核因果结论', note: '一致认为需降级为相关结论。', date: '2026-09-23', files: []}],
  map: {nodes: [
    {id: 'root', parent: null, type: 'main', text: '间歇性禁食与代谢健康', x: 80, y: 80, attachments: []},
    {id: 'q', parent: 'root', text: '研究问题：IF 是否改善胰岛素敏感性', x: 380, y: 40, attachments: []},
    {id: 'm', parent: 'root', text: '方法：随机对照 · 12 周', x: 380, y: 130, attachments: []},
    {id: 'r', parent: 'root', text: '风险：训练量混杂、采血时点', x: 380, y: 220, attachments: []}], edges: []}});
await post('/api/workbench/plans', {plans: [{id: 'plan-1', title: '重写方法部分', project: '间歇性禁食与代谢健康', time: '周五前', done: false}, {id: 'plan-2', title: '联系统计顾问', project: '全局计划', time: '已完成', done: true}, {id: 'plan-3', title: '准备组会汇报', project: '全局计划', time: '下周二', done: false}]});
await post('/api/library/import', {name: '综述_IF_2025.md', base64: b64('# 间歇性禁食综述'), projectId: 'p-fasting'});

let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, env: {...process.env, TEMP: root, TMP: root},
  });
  const errors = [];
  const open = async (query = '') => {
    const page = await browser.newPage(); page.on('pageerror', e => errors.push(e.message));
    await installApiToken(page, server);
    await page.goto(server.url + query);
    await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready);
    await page.evaluate(() => window.ScienceScopeWorkspace.ready);
    await page.waitForTimeout(500);
    return page;
  };
  const shot = async (page, name) => { await page.waitForTimeout(450); await page.screenshot({path: path.join(out, name + '.png')}); console.log('shot', name); };
  const page = await open();
  if (process.env.AUDIT_COPY) {
    // Copy audit: every route's visible prose outside the sidebar, for review.
    const {writeFile} = await import('node:fs/promises');
    await page.evaluate(() => selectProject('p-fasting'));
    const routes = new Set(process.env.AUDIT_COPY.split(',').filter(r => r !== '1'));
    for (const r of await page.evaluate(() => [...document.querySelectorAll('[data-route]')].map(e => e.dataset.route))) routes.add(r);
    const report = {};
    for (const route of routes) {
      await page.evaluate(r => { try { go(r); } catch (e) { console.warn(e); } }, route); await page.waitForTimeout(500);
      for (const r of await page.evaluate(() => [...document.querySelectorAll('[data-route]')].map(e => e.dataset.route))) if (!routes.has(r)) { routes.add(r); }
      report[route] = await page.evaluate(() => {
        const out = new Set();
        for (const el of document.querySelectorAll('p, small, .hint, .muted, .note, li, h1, h2, h3, label, td, .notice, .banner, span.sub, .desc, .empty, div.callout')) {
          if (el.closest('.sidebar, .side, nav, #v-menu, .info-pop') || !el.offsetParent) continue;
          const text = el.innerText.trim().replace(/\s+/g, ' ');
          if (text && text.length > 1 && text.length < 400) out.add(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''}: ${text}`);
        }
        for (const el of document.querySelectorAll('[data-action],[data-v],[data-route]')) {
          if (el.closest('#v-menu') || !el.offsetParent) continue;
          out.add(`@${el.dataset.action ? 'action=' + el.dataset.action : el.dataset.v ? 'v=' + el.dataset.v : 'route=' + el.dataset.route} ${el.innerText.trim().slice(0, 30)}`);
        }
        return [...out];
      });
    }
    await page.evaluate(() => window.SSV2.loadThread('chat-2')); await page.waitForTimeout(500);
    for (const selector of ['[data-v="top-menu"]', '[data-v="export-menu"]', '[data-v="workspace-menu"]', '[data-v="window-info"]', '[data-v="sites-menu"]', '[data-v="attach-menu"]', '.message:not(.user) [data-v]']) {
      const count = await page.locator(selector).count();
      for (let i = 0; i < count; i++) {
        const el = page.locator(selector).nth(i); if (!await el.isVisible()) continue;
        const label = `${selector}#${i} ${(await el.innerText()).trim().slice(0, 20)} ${await el.getAttribute('data-v') || ''}`;
        await el.click().catch(() => {}); await page.waitForTimeout(250);
        report['menu ' + label] = await page.evaluate(() => [...document.querySelectorAll('#v-menu button, #modal button, #modal p, #modal .hint, .contextmenu button')].map(b => `${b.dataset.v ? 'v=' + b.dataset.v : b.dataset.action ? 'action=' + b.dataset.action : b.dataset.route ? 'route=' + b.dataset.route : b.tagName}: ${b.innerText.trim().replace(/\s+/g, ' ').slice(0, 120)}`));
        await page.keyboard.press('Escape'); await page.evaluate(() => { try { closeMenu(); } catch {} document.getElementById('modal')?.remove(); }); await page.waitForTimeout(100);
      }
    }
    // Trigger each menu item once and record the visible outcome.
    await page.evaluate(() => { window.__toasts = []; const orig = window.toast; window.toast = (...a) => { window.__toasts.push(String(a[0])); return orig?.(...a); }; });
    const outcome = async () => page.evaluate(() => ({route, toasts: window.__toasts.splice(0), modal: document.querySelector('#modal h2, dialog[open] h2')?.innerText || null, modalText: (document.querySelector('#modal, dialog[open]')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200), surface: document.querySelector('.rightpanel h2')?.innerText || null}));
    const triggers = [['[data-v="top-menu"]', 4], ['[data-v="workspace-menu"]', 1], ['[data-v="attach-menu"]', 1], ['.message:not(.user) [data-v="message-menu"]', 1]];
    for (const [selector, n] of triggers) for (let i = 0; i < n; i++) {
      await page.evaluate(() => window.SSV2.loadThread('chat-2')); await page.waitForTimeout(400);
      const count = await (async () => { await page.locator(selector).nth(i).click(); await page.waitForTimeout(200); return page.locator('#v-menu .menu-line').count(); })();
      await page.keyboard.press('Escape'); await page.evaluate(() => closeMenu());
      for (let j = 0; j < count; j++) {
        await page.evaluate(() => { document.getElementById('modal')?.remove(); for (const d of document.querySelectorAll('dialog[open]')) d.close(); }); await page.evaluate(() => window.SSV2.loadThread('chat-2')); await page.waitForTimeout(300);
        await page.locator(selector).nth(i).click(); await page.waitForTimeout(200);
        const item = page.locator('#v-menu .menu-line').nth(j); const text = (await item.innerText()).trim().replace(/\s+/g, ' ');
        const pages = browser.pages().length;
        await item.click().catch(() => {}); await page.waitForTimeout(600);
        report[`do ${selector}#${i} ${text}`] = {...await outcome(), newWindow: browser.pages().length > pages};
        for (const extra of browser.pages().slice(pages)) await extra.close();
      }
    }
    await writeFile(path.join(out, 'copy-audit.json'), JSON.stringify(report, null, 1));
    console.log('audit', Object.keys(report).length, 'routes');
    await browser.close(); await server.close(); await rm(root, {recursive: true, force: true}); process.exit(0);
  }
  await page.evaluate(() => { window.ScienceScopeModels?.select?.({providerId: 'sciencescope-demo', modelId: 'deepseek-v4.1-flash'}); });
  await page.evaluate(() => newThread(null)); await shot(page, '01-home');
  await page.evaluate(() => window.SSV2.loadThread('chat-2')); await page.waitForSelector('.message'); await shot(page, '02-chat');
  if (process.env.DUMP_DOM) { const {writeFile} = await import('node:fs/promises'); await writeFile(path.join(out, 'dom-chat.html'), await page.evaluate(() => document.body.innerHTML)); }
  await page.evaluate(() => window.SSV2.loadThread('chat-main')); await page.waitForSelector('.message');
  await page.evaluate(() => { localStorage.setItem('sciencescope-panel:chat-main', JSON.stringify({excluded: [], reviewer: 'statistician'})); });
  await page.locator('[data-v="work-mode"],[data-action="work-mode"]').first().click().catch(() => {}); await page.locator('[data-work-mode="ordered"]').click().catch(() => {}); await page.waitForTimeout(400);
  await page.evaluate(() => { const box = document.querySelector('.messages'); box.scrollTop = box.scrollHeight; }); await shot(page, '03-discussion');
  await page.evaluate(() => { const box = document.querySelector('.messages'); box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight * 2); }); await shot(page, '03b-discussion-top');
  await page.locator('[data-v="work-mode"],[data-action="work-mode"]').first().click().catch(() => {}); await page.locator('[data-work-mode="work"]').click().catch(() => {}); await page.waitForTimeout(300);
  await page.locator('[data-draft="main"]').pressSequentially('@'); await shot(page, '03c-mention'); await page.keyboard.press('Escape'); await page.locator('[data-draft="main"]').fill('');
  await page.locator('.mainhead [data-v="secretary"]').click().catch(() => {}); await shot(page, '04-secretary');
  await page.locator('.mainhead [data-v="secretary"]').click().catch(() => {});
  await page.evaluate(() => { selectProject('p-fasting'); go('workbench'); }); await page.waitForTimeout(900); await shot(page, '05-workbench');
  await page.evaluate(() => go('map')); await page.waitForTimeout(700); await shot(page, '06-map');
  await page.evaluate(() => go('database')); await page.waitForTimeout(700); await shot(page, '07-library');
  for (const route of ['general', 'models', 'experts', 'secretary-settings']) { await page.evaluate(r => go(r), route); await page.waitForTimeout(700); await shot(page, '08-settings-' + route); }
  await page.evaluate(() => window.SSV2.loadThread('chat-2')); await page.waitForTimeout(500);
  await page.keyboard.press('Control+K'); await page.waitForTimeout(300); await page.keyboard.type('样本'); await shot(page, '09-command-palette'); await page.keyboard.press('Escape');
  await page.locator('[data-object="project"]').first().click({button: 'right'}).catch(() => {}); await shot(page, '10-context-menu'); await page.keyboard.press('Escape');
  await page.locator('[data-v="mode-menu"]').first().click().catch(() => {}); await shot(page, '11-composer-menu'); await page.keyboard.press('Escape');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await shot(page, '12-chat-dark');
  const assistant = await open('?surface=assistant'); await assistant.setViewportSize({width: 440, height: 720}); await shot(assistant, '13-assistant-window');
  const orb = await open('?surface=assistant-orb'); await orb.setViewportSize({width: 120, height: 120}); await shot(orb, '14-orb');
  console.log(JSON.stringify({screens: 17, pageErrors: errors}));
} finally { await browser?.close(); await server.close(); await rm(root, {recursive: true, force: true}); }
