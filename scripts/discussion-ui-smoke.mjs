// Offline browser smoke for expert discussion in the Main composer.
// T19 covers independent reviewer settings, skill binding, menu grouping and
// review adoption. API/model streams are fixtures, not real DSH/provider runs.
// Browser: SCIENCESCOPE_BROWSER, else installed Edge (Windows default).
import http from 'node:http';
import path from 'node:path';
import {readFile, mkdir, mkdtemp, rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {buildDesktop} from './build-desktop.mjs';
import {defaultRoot} from './prepare-desktop.mjs';
import {DEFAULT_PREFERENCES} from './desktop-preferences.mjs';

const entry = await buildDesktop();
const output = path.join(defaultRoot, '.sciencescope-local', 'temp', 't19-validation', 'discussion-ui');
await mkdir(output, {recursive: true});
const root=await mkdtemp(path.join(output,'run-'));
process.env.TEMP = root; process.env.TMP = root;
const preferences={...DEFAULT_PREFERENCES};
const skills=[
  {name:'review-format',description:'Use an explicit review checklist.',enabled:true,valid:true},
  {name:'evidence-check',description:'Check the supplied evidence.',enabled:true,valid:true},
  {name:'unbound-skill',description:'Enabled but not selected for this reviewer.',enabled:true,valid:true},
  {name:'disabled-review-skill',description:'A disabled skill must not be offered.',enabled:false,valid:true},
];
const roster = [
  {id: 'methodologist', label: '方法学家', role: '研究设计', persona: 'persona of methodologist', model: null, reasoningEffort:null,kind:'expert',skills:[],enabled: true},
  {id: 'statistician', label: '统计审稿人', role: '统计与数据', persona: 'persona of statistician', model: null, reasoningEffort:null,kind:'expert',skills:[],enabled: true},
  {id: 'red-team', label: '魔鬼代言人', role: '反方审阅', persona: 'persona of red-team', model: null, reasoningEffort:null,kind:'expert',skills:[],enabled: false},
  {id:'independent-default',label:'独立审核人',role:'独立审核',persona:'Check consistency of facts, evidence, methods and conclusions.',model:null,reasoningEffort:null,kind:'reviewer',skills:[],enabled:false},
];
const calls = [],screenshots=[];
const appearances=[['zh-CN','light','zh-light'],['zh-CN','dark','zh-dark'],['en','light','en-light'],['en','dark','en-dark']];
const json = (res, body) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let body = {}; if (req.method === 'POST') { let raw = ''; for await (const chunk of req) raw += chunk; body = raw ? JSON.parse(raw) : {}; }
  if (url.pathname === '/api/experts') {
    if (req.method === 'POST') { calls.push({route: 'experts', body}); roster.splice(0, roster.length, ...body.experts.map((expert, position) => ({...expert, position}))); }
    return json(res, {experts: roster, available: true});
  }
  if (url.pathname === '/api/providers') return json(res, {providers: [{id: 'offline', name: '离线', models: ['model-a', 'model-b']}]});
  if(url.pathname==='/api/skills')return json(res,{skills});
  if(url.pathname==='/api/model-info')return json(res,{reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}]}});
  if(url.pathname==='/api/preferences'){if(req.method==='POST')Object.assign(preferences,body);return json(res,preferences);}
  if(url.pathname==='/api/projects/focus')return json(res,{projectId:body.projectId??null});
  if(url.pathname==='/api/settings/info')return json(res,{dataRoot:root,stateDir:root,projectsDir:root,dshHome:root});
  if (url.pathname.startsWith('/api/research-input/draft')) return json(res, req.method === 'POST' ? {saved: true} : {attachmentIds: [], messageQuotes: [], annotations: [], contextRefs: []});
  if (url.pathname === '/api/workspace') return json(res, {projects: [], pins: [], projectExpanded: {}, lastChatId: null});
  if (url.pathname === '/api/chats') return json(res, {chats: []});
  if (url.pathname.startsWith('/api/chats/')) return json(res, {chat: {}, messages: [], total: 0, before: null, after: null});
  if (url.pathname === '/api/status') return json(res, {available: true});
  if (url.pathname.startsWith('/api/chat/outbox')) return json(res, {paused: false, items: []});
  if (url.pathname === '/api/chat') { calls.push({route: 'chat', body}); res.writeHead(200, {'Content-Type': 'application/x-ndjson'}); res.write(JSON.stringify({type: 'accepted'}) + '\n'); res.end(JSON.stringify({type: 'completed', text: 'MAIN_REPLY'}) + '\n'); return; }
  if (url.pathname === '/api/discussion/adopt') { calls.push({route: 'adopt', body}); return json(res, {entry: {adopted: body.adopted, mainSeen: false, review: true}}); }
  if (url.pathname === '/api/discussion') {
    calls.push({route: 'discussion', body});
    const ids = [...body.expertIds.filter(id => id !== body.reviewerId), ...(body.kind === 'ordered' && body.reviewerId ? [body.reviewerId] : [])];
    const panel = ids.map(id => roster.find(expert => expert.id === id));
    res.writeHead(200, {'Content-Type': 'application/x-ndjson'});
    const experts = panel.map(expert => ({id: expert.id, label: expert.label, role: expert.role, model: expert.model || {providerId: 'offline', modelId: `model-${expert.id}`}, messageId: `msg-${body.kind}-${expert.id}-${calls.length}`, review: expert.id === body.reviewerId && body.kind === 'ordered'}));
    const answering = experts.filter(expert => !expert.review); const reviewer = experts.find(expert => expert.review);
    res.write(JSON.stringify({type: 'accepted', runId: 'r', kind: body.kind, userMessageId: body.userMessageId, experts}) + '\n');
    for (const expert of answering) res.write(JSON.stringify({type: 'expert-start', runId: 'r', expertId: expert.id, messageId: expert.messageId}) + '\n');
    for (const expert of answering) res.write(JSON.stringify({type: 'expert-delta', runId: 'r', expertId: expert.id, messageId: expert.messageId, delta: `PREAMBLE_${expert.id}`}) + '\n');
    await new Promise(r => setTimeout(r, 200));
    for (const expert of answering) res.write(JSON.stringify({type: 'tool-call', runId: 'r', expertId: expert.id, messageId: expert.messageId, callId: `c-${expert.id}`, name: 'read', argumentsPreview: '{"file_path":"draft.md"}', preamble: `PREAMBLE_${expert.id}`}) + '\n');
    for (const expert of answering) res.write(JSON.stringify({type: 'expert-delta', runId: 'r', expertId: expert.id, messageId: expert.messageId, delta: `PARTIAL_${expert.id}`}) + '\n');
    await new Promise(r => setTimeout(r, 400));
    // Finish in reverse order: display must still follow the roster.
    for (const expert of [...answering].reverse()) { await new Promise(r => setTimeout(r, 120)); res.write(JSON.stringify({type: 'tool-result', runId: 'r', expertId: expert.id, messageId: expert.messageId, callId: `c-${expert.id}`, isError: false}) + '\n'); res.write(JSON.stringify({type: 'expert-end', runId: 'r', expertId: expert.id, messageId: expert.messageId, text: `**${expert.label}** ${body.kind} ANSWER`, stopReason: 'completed'}) + '\n'); }
    if (reviewer) {
      await new Promise(r => setTimeout(r, 300));
      res.write(JSON.stringify({type: 'review-start', runId: 'r', expertId: reviewer.id, messageId: reviewer.messageId}) + '\n');
      const reviewerConfig=roster.find(expert=>expert.id===reviewer.id);
      res.write(JSON.stringify({type: 'expert-end', runId: 'r', expertId: reviewer.id, messageId: reviewer.messageId, text: reviewerConfig.kind==='reviewer'?'INDEPENDENT_REVIEW_SUMMARY':'REVIEW_SUMMARY', stopReason: 'completed', review: true}) + '\n');
    }
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
  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless: true, viewport: {width: 1440, height: 960}, env: {...process.env, TEMP: root, TMP: root},
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
  const settle=async(target=page)=>{await target.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });};
  const appearance=async(language,theme)=>{
    await page.evaluate(async({language,theme})=>{
      const {hostRequest}=await import('/desktop/host-client.mjs');
      await hostRequest('preferences',{language,theme});
      const channel=new BroadcastChannel('sciencescope-desktop-preferences');channel.postMessage('changed');channel.close();
    },{language,theme});
    await page.waitForFunction(({language,theme})=>document.documentElement.lang===(language==='en'?'en':'zh-CN')&&document.documentElement.dataset.theme===theme,{language,theme});
  };
  const capture=async(kind,key)=>{await settle();const file=path.join(output,`${kind}-${key}.png`);await page.screenshot({path:file,fullPage:true});screenshots.push(file);};
  const clickOnce=async locator=>{
    await settle();let previous=null,box=null;
    for(let i=0;i<20;i++){box=await locator.boundingBox();if(box&&previous&&box.x===previous.x&&box.y===previous.y&&box.width===previous.width&&box.height===previous.height)break;previous=box;await page.waitForTimeout(50);}
    assert.ok(box,'the review adoption control is visible');await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  };
  // A new chat keeps the approved welcome layout (no mode button) until its
  // first message, so start with an ordinary Main turn.
  await page.locator('[data-draft="main"]').fill('普通主专家消息');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.some(m => m.text === 'MAIN_REPLY'));
  assert.equal(calls[0].route, 'chat'); calls.length = 0;
  // 自由讨论 no longer exists.
  await page.locator('[data-v="work-mode"],[data-action="work-mode"]').first().click();
  assert.equal(await page.locator('[data-work-mode]').count(), 2);
  assert.equal(await page.locator('[data-work-mode]', {hasText: '自由讨论'}).count(), 0);
  await page.keyboard.press('Escape'); await page.evaluate(() => closeMenu());
  // Ordered: the strip shows order; a reviewer leaves the answering panel.
  await chooseMode('有序讨论');
  await page.waitForSelector('[data-discussion-strip]');
  assert.match(await page.locator('[data-discussion-strip]').innerText(), /1\s*方法学家[\s\S]*2\s*统计审稿人[\s\S]*审核：\s*无/);
  await page.locator('[data-panel-reviewer-menu]').click();
  // The picker sits at the top of the chat: it opens downward and every item
  // (with its info tip) stays inside the menu box (clipped before 2026-09-27).
  const contained = await page.evaluate(() => { const box = document.getElementById('v-menu').getBoundingClientRect(); return [...document.querySelectorAll('#v-menu .menu-line, #v-menu .info-tip')].every(el => { const r = el.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.right <= box.right + 1; }) && box.top >= 0; });
  assert.equal(contained, true, 'reviewer menu items stay inside the menu');
  await page.locator('[data-panel-reviewer="statistician"]').click();
  await page.waitForFunction(() => document.querySelector('[data-discussion-strip]')?.textContent.includes('审核：统计审稿人'));
  assert.equal(await page.locator('[data-panel-toggle]').count(), 1, 'the reviewer is not an answering chip');
  await page.locator('[data-draft="main"]').fill('这个因果结论成立吗？');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => document.querySelector('.message[data-streaming] .message-text')?.textContent.includes('PARTIAL_'));
  // Live state: the reviewer waits while the panel answers.
  assert.equal(await page.locator('.review-message .expert-state').innerText(), '等待其他专家');
  // The preamble streamed before the tool call moved into the tool card.
  assert.doesNotMatch(await page.locator('.message[data-streaming] .message-text').first().innerText(), /PREAMBLE_/);
  assert.match(await page.locator('.turn-activity-caption').first().innerText(), /PREAMBLE_methodologist/);
  await page.waitForFunction(() => S.messages.filter(m => m.expert && !m.streaming).length === 2 && !V.pending.has(V.chat));
  assert.equal(await page.locator('.message:not(.user) .message-text', {hasText: 'PARTIAL_'}).count(), 0, 'final text replaces the partial stream');
  assert.deepEqual(calls[0].body.expertIds, ['methodologist']);
  assert.equal(calls[0].body.reviewerId, 'statistician');
  assert.equal(calls[0].body.kind, 'ordered');
  const heads = (await page.locator('.message:not(.user) .messagehead').allInnerTexts()).slice(1);
  assert.match(heads[0], /方法学家[\s\S]*model-methodologist/); assert.match(heads[1], /统计审稿人[\s\S]*审核/);
  assert.equal(await page.locator('.message:not(.user) .message-text strong').first().innerText(), '方法学家');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), '');
  // The review joins later context only when the user adopts it.
  const adopt = page.locator('[data-review-adopt]');
  assert.equal(await adopt.getAttribute('aria-pressed'), 'false');
  // One real click once the transcript has settled. Locator.click() retries when
  // its hit-target check races the final layout, and the page's capture
  // listener sees both attempts, toggling the review twice.
  let box = null;
  for (let i = 0; i < 20; i++) { const next = await adopt.boundingBox(); if (box && next && box.x === next.x && box.y === next.y) break; box = next; await page.waitForTimeout(50); }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-review-adopt]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(calls.at(-1), {route: 'adopt', body: {chatId: calls[0].body.chatId, messageId: 'msg-ordered-statistician-1', adopted: true}});
  // Work mode: typing @ offers enabled experts; Enter picks one and never sends.
  await chooseMode('工作');
  assert.equal(await page.locator('[data-discussion-strip]').count(), 0);
  const before = calls.length;
  await page.locator('[data-draft="main"]').fill('');
  await page.locator('[data-draft="main"]').pressSequentially('@统');
  await page.waitForSelector('.mention-menu [data-mention]');
  assert.equal(await page.locator('.mention-menu [data-mention]').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(calls.length, before, 'choosing a mention does not send');
  assert.equal(await page.locator('[data-draft="main"]').inputValue(), '@统计审稿人 ');
  assert.equal(await page.locator('.mention-menu').count(), 0);
  await page.locator('[data-draft="main"]').pressSequentially('样本量够吗？');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => S.messages.filter(m => m.expert && !m.streaming).length === 3 && !V.pending.has(V.chat));
  const invite = calls.find(call => call.route === 'discussion' && call.body.kind === 'invited');
  assert.deepEqual(invite.body.expertIds, ['statistician']);
  // Without a mention the ordinary Main path runs.
  await page.locator('[data-draft="main"]').fill('回到工作模式');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(() => !V.pending.has(V.chat) && S.messages.filter(m => m.text === 'MAIN_REPLY').length === 2);
  assert.equal(calls.at(-1).route, 'chat');
  await page.screenshot({path: path.join(output, 'discussion.png')});
  // Settings → 专家角色: edit, add, reorder, save; the discussion strip follows.
  await page.evaluate(() => go('experts'));
  await page.waitForSelector('[data-expert-roster] [data-expert-group="expert"] [data-expert-index]');
  const expertsGroup=page.locator('[data-expert-group="expert"]'),reviewersGroup=page.locator('[data-expert-group="reviewer"]');
  assert.equal(await expertsGroup.locator('[data-expert-index]').count(), 3);
  assert.equal(await reviewersGroup.locator('[data-expert-index]').count(),1);
  assert.equal(await reviewersGroup.locator('[name="enabled"]').isChecked(),false,'the default independent reviewer is disabled');
  assert.match(await expertsGroup.locator('h3').innerText(),/参加专家/);assert.match(await reviewersGroup.locator('h3').innerText(),/独立审核/);
  // Skills installed/enabled while the user visits another settings page must
  // appear on return without discarding the expert edits awaiting Save.
  const pendingLabel='方法学家待保存名称',pendingPersona='An unsaved methods prompt must survive an enabled-skill catalog refresh.';
  await expertsGroup.locator('[data-expert-index]').first().locator('[name="label"]').fill(pendingLabel);
  await expertsGroup.locator('[data-expert-index]').first().locator('[name="persona"]').fill(pendingPersona);
  skills.push({name:'newly-enabled-skill',description:'Enabled after the expert settings page was first opened.',enabled:true,valid:true});
  await page.evaluate(()=>go('general'));await page.evaluate(()=>go('experts'));
  await page.waitForSelector('[data-expert-group="expert"] [data-expert-index] [name="skills"][value="newly-enabled-skill"]');
  assert.equal(await expertsGroup.locator('[data-expert-index]').first().locator('[name="label"]').inputValue(),pendingLabel,'catalog refresh preserves the unsaved name');
  assert.equal(await expertsGroup.locator('[data-expert-index]').first().locator('[name="persona"]').inputValue(),pendingPersona,'catalog refresh preserves the unsaved prompt');
  await expertsGroup.locator('[data-expert-index]').first().locator('[name="label"]').fill('方法学家');
  await expertsGroup.locator('[data-expert-index]').first().locator('[name="persona"]').fill('persona of methodologist');
  await expertsGroup.locator('[data-expert-index]').nth(1).locator('[name="label"]').fill('统计学家');
  await expertsGroup.locator('[data-expert-add="expert"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-expert-group="expert"] [data-expert-index]').length===4);
  assert.equal(await expertsGroup.locator('[data-expert-index]').nth(1).locator('[name="label"]').inputValue(), '统计学家', 'unsaved edits survive add');
  const addedExpert=expertsGroup.locator('[data-expert-index]').nth(3);
  await addedExpert.locator('[name="label"]').fill('领域专家');
  await addedExpert.locator('[name="model"]').selectOption({label: '离线 / model-b'});
  await addedExpert.locator('[data-expert-move="-1"]').click();
  await expertsGroup.locator('[data-expert-index]').first().locator('[name="skills"][value="evidence-check"]').check();
  await page.locator('[data-expert-roster] [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-expert-feedback]')?.textContent.includes('已保存'));
  const savedCall = calls.find(call => call.route === 'experts');
  const savedParticipants=savedCall.body.experts.filter(expert=>expert.kind==='expert');
  assert.deepEqual(savedParticipants.map(expert => expert.label), ['方法学家', '统计学家', '领域专家', '魔鬼代言人']);
  assert.deepEqual(savedParticipants[2].model, {providerId: 'offline', modelId: 'model-b'});
  assert.equal(savedParticipants[1].id, 'statistician', 'rename keeps the stable id');
  assert.deepEqual(savedParticipants[0].skills,['evidence-check'],'participating experts can also bind enabled skills');

  // Independent reviewers have their own model, effort, prompt and selected
  // skills, and sort only within their separate group.
  await reviewersGroup.locator('[data-expert-add="reviewer"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-expert-group="reviewer"] [data-expert-index]').length===2);
  const addedReviewer=reviewersGroup.locator('[data-expert-index]').last(),reviewerLabel='独立核对员';
  const reviewerPersona='Check facts, evidence, methods and conclusions. Keep unsupported claims separate from verified findings.';
  await addedReviewer.locator('[name="label"]').fill(reviewerLabel);
  await addedReviewer.locator('[name="persona"]').fill(reviewerPersona);
  await addedReviewer.locator('[name="model"]').selectOption(JSON.stringify({providerId:'offline',modelId:'model-b'}));
  await page.waitForFunction(()=>document.querySelector('[data-expert-group="reviewer"] [data-expert-index]:last-child [name="reasoningEffort"] option[value="high"]'));
  await addedReviewer.locator('[name="reasoningEffort"]').selectOption('high');
  assert.equal(await addedReviewer.locator('[name="skills"]').count(),4,'the complete current enabled skill catalog is offered');
  assert.equal(await addedReviewer.locator('[name="skills"][value="newly-enabled-skill"]').isChecked(),false);
  assert.equal(await addedReviewer.locator('[name="skills"][value="disabled-review-skill"]').count(),0);
  await addedReviewer.locator('[name="skills"][value="review-format"]').check();
  await addedReviewer.locator('[name="skills"][value="evidence-check"]').check();
  assert.equal(await addedReviewer.locator('[name="skills"][value="unbound-skill"]').isChecked(),false);
  await addedReviewer.locator('[name="enabled"]').check();
  await addedReviewer.locator('[data-expert-move="-1"]').click();
  await page.locator('[data-expert-roster] [type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-expert-feedback]')?.textContent.includes('已保存'));
  const reviewerSavedCall=calls.filter(call=>call.route==='experts').at(-1),savedReviewers=reviewerSavedCall.body.experts.filter(expert=>expert.kind==='reviewer');
  assert.deepEqual(savedReviewers.map(expert=>expert.label),[reviewerLabel,'独立审核人']);
  const independentReviewer=savedReviewers[0];
  assert.equal(independentReviewer.enabled,true);assert.equal(independentReviewer.persona,reviewerPersona);
  assert.deepEqual(independentReviewer.model,{providerId:'offline',modelId:'model-b'});assert.equal(independentReviewer.reasoningEffort,'high');
  assert.deepEqual([...independentReviewer.skills].sort(),['evidence-check','review-format']);

  // A fresh browser page obtains the saved record from the API, including its
  // stable identity and selected skills; it does not reuse this form's cache.
  const restored=await browser.newPage();restored.on('pageerror',error=>errors.push(error.message));
  await restored.goto(`http://127.0.0.1:${server.address().port}/#experts`);
  await restored.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopePreferences?.ready);
  await restored.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.ScienceScopePreferences.ready;});
  await restored.waitForSelector('[data-expert-group="reviewer"] [name="label"]');
  const restoredReviewer=restored.locator('[data-expert-group="reviewer"] [data-expert-index]').first();
  assert.equal(await restoredReviewer.locator('[name="label"]').inputValue(),reviewerLabel);
  assert.match(await restoredReviewer.locator('legend').innerText(),new RegExp(independentReviewer.id));
  assert.equal(await restoredReviewer.locator('[name="persona"]').inputValue(),reviewerPersona);
  assert.equal(await restoredReviewer.locator('[name="model"]').inputValue(),JSON.stringify(independentReviewer.model));
  assert.equal(await restoredReviewer.locator('[name="reasoningEffort"]').inputValue(),'high');
  assert.deepEqual((await restoredReviewer.locator('[name="skills"]:checked').evaluateAll(inputs=>inputs.map(input=>input.value))).sort(),['evidence-check','review-format']);
  await restored.close();

  for(const [language,theme,key] of appearances){
    await appearance(language,theme);
    await reviewersGroup.evaluate(element=>element.scrollIntoView({block:'start'}));
    await page.waitForFunction(language=>document.querySelector('[data-expert-group="reviewer"] h3')?.innerText.includes(language==='en'?'Independent':'独立审核'),language);
    assert.equal(await reviewersGroup.locator('[data-expert-index]').first().locator('[name="persona"]').inputValue(),reviewerPersona,'the user prompt is never translated');
    assert.ok((await reviewersGroup.locator('[data-expert-index]').first().locator('legend').innerText()).includes(reviewerLabel),'the saved reviewer name stays unchanged in both languages');
    assert.ok((await reviewersGroup.locator('[data-expert-index]').last().locator('legend').innerText()).includes('独立审核人'),'the saved default reviewer name is also data, not interface text');
    assert.ok((await expertsGroup.locator('[data-expert-index]').first().locator('legend').innerText()).includes('方法学家'),'the saved participant name is not translated');
    await capture('settings',key);
  }
  await appearance('zh-CN','light');await page.evaluate(()=>go('work'));await chooseMode('工作');
  await page.locator('[data-draft="main"]').fill('');await page.locator('[data-draft="main"]').pressSequentially('@');
  await page.waitForSelector('.mention-menu [data-mention]');
  assert.equal(await page.locator('.mention-menu [data-mention]').count(),3);
  assert.equal(await page.locator(`.mention-menu [data-mention="${independentReviewer.id}"]`).count(),0,'independent reviewers are never @ candidates');
  await page.keyboard.press('Escape');await page.locator('[data-draft="main"]').fill('');

  await chooseMode('有序讨论');await page.locator('[data-panel-reviewer-menu]').click();
  const reviewerGroup=page.locator('#v-menu [data-reviewer-group="reviewer"]');
  await reviewerGroup.waitFor();assert.match(await reviewerGroup.innerText(),/独立审核/);
  const menuOrder=await page.locator('#v-menu [data-panel-reviewer]').evaluateAll(nodes=>nodes.map(node=>node.dataset.panelReviewer));
  assert.deepEqual(menuOrder,['','methodologist','statistician',savedParticipants[2].id,independentReviewer.id]);
  assert.equal(await page.locator('#v-menu [data-panel-reviewer="independent-default"]').count(),0,'disabled reviewers are not offered');
  assert.ok(await page.evaluate(id=>{
    const heading=document.querySelector('[data-reviewer-group="reviewer"]'),item=document.querySelector(`[data-panel-reviewer="${id}"]`);
    return !!(heading.compareDocumentPosition(item)&Node.DOCUMENT_POSITION_FOLLOWING);
  },independentReviewer.id),'the independent reviewer follows its group heading');
  for(const [language,theme,key] of appearances){
    await appearance(language,theme);await page.waitForFunction(language=>document.querySelector('[data-reviewer-group="reviewer"]')?.innerText.includes(language==='en'?'Independent':'独立审核'),language);
    for(const expert of [...savedParticipants.filter(expert=>expert.enabled),independentReviewer])assert.ok((await page.locator(`#v-menu [data-panel-reviewer="${expert.id}"]`).innerText()).includes(expert.label),'saved menu names are not translated');
    await capture('reviewer-menu',key);
  }
  await appearance('zh-CN','light');await page.locator(`[data-panel-reviewer="${independentReviewer.id}"]`).click();
  assert.equal(await page.locator('[data-panel-toggle]').count(),3,'independent review leaves all three answering experts available');
  assert.equal(await page.locator(`[data-panel-toggle="${independentReviewer.id}"]`).count(),0);
  const beforeIndependent=await page.evaluate(()=>S.messages.filter(message=>message.expert&&!message.streaming).length);
  await page.locator('[data-draft="main"]').fill('请独立核查本轮各专家结论与证据是否一致。');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(()=>document.querySelector('.message[data-streaming] .message-text')?.textContent.includes('PARTIAL_'));
  assert.equal(await page.locator('.review-message[data-streaming] .expert-state').innerText(),'等待其他专家');
  await page.waitForFunction(before=>S.messages.filter(message=>message.expert&&!message.streaming).length===before+4&&!V.pending.has(V.chat),beforeIndependent);
  const independentRun=calls.filter(call=>call.route==='discussion').at(-1);
  assert.deepEqual(independentRun.body.expertIds,['methodologist','statistician',savedParticipants[2].id]);
  assert.equal(independentRun.body.reviewerId,independentReviewer.id);assert.equal(independentRun.body.kind,'ordered');
  const latestExpertIds=await page.evaluate(()=>S.messages.filter(message=>message.expert&&!message.streaming).slice(-4).map(message=>message.expert.expertId));
  assert.deepEqual(latestExpertIds,[...independentRun.body.expertIds,independentReviewer.id],'the independent reviewer appears after every panel answer');
  const independentReview=await page.evaluate(id=>S.messages.findLast(message=>message.expert?.expertId===id&&message.expert.review),independentReviewer.id);
  const reviewMessage=page.locator(`#message-${independentReview.id}`),independentAdopt=reviewMessage.locator('[data-review-adopt]');
  assert.match(await reviewMessage.locator('.messagehead').innerText(),/model-b/,'the independent reviewer displays its own saved model');
  assert.match(await reviewMessage.locator('.message-text').innerText(),/INDEPENDENT_REVIEW_SUMMARY/);
  assert.equal(await independentAdopt.getAttribute('aria-pressed'),'false');
  await independentAdopt.scrollIntoViewIfNeeded();await clickOnce(independentAdopt);
  await page.waitForFunction(id=>document.querySelector(`[data-review-adopt="${id}"]`)?.getAttribute('aria-pressed')==='true',independentReview.id);
  assert.deepEqual(calls.at(-1),{route:'adopt',body:{chatId:independentRun.body.chatId,messageId:independentReview.id,adopted:true}});
  for(const [language,theme,key] of appearances){
    await appearance(language,theme);await reviewMessage.evaluate(element=>element.scrollIntoView({block:'end'}));
    await page.waitForFunction(({id,language})=>document.querySelector(`[data-review-bar="${id}"]`)?.innerText.toLocaleLowerCase().includes(language==='en'?'review':'审核'),{id:independentReview.id,language});
    assert.ok((await page.locator('[data-panel-toggle="methodologist"]').innerText()).includes('方法学家'),'the participant chip preserves its saved name');
    assert.ok((await page.locator('[data-panel-reviewer-menu]').innerText()).includes(reviewerLabel),'the reviewer button preserves its saved name');
    assert.ok((await reviewMessage.locator('.messagehead').innerText()).includes(reviewerLabel),'the review author preserves its saved name');
    assert.equal(await independentAdopt.getAttribute('aria-pressed'),'true');await capture('review-adopted',key);
  }
  assert.deepEqual(errors, []);
  assert.equal(screenshots.length,12);
  console.log(JSON.stringify({liveExpertText: true, rosterEditor: true, orderedPanel: true, reviewerAfterPanel: true, reviewAdoption: true, toolPreambleInCard: true, rosterOrderDisplay: true, realAuthors: true, workModeMentionInvite: true, mentionMenu: true, noFreeMode: true, workModeUnchanged: true,independentReviewerSettings:true,skillBinding:true,skillCatalogRefreshPreservesUnsavedEdits:true,settingsFreshPage:true,reviewerGrouping:true,reviewerExcludedFromParticipantsAndMentions:true,independentReviewAndAdoption:true,languageThemeScreenshots:screenshots,fixtureApi:true,realDsh:false, localRequests: calls.length, paidRequests: 0}));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));await rm(root,{recursive:true,force:true}); }
