// T05 acceptance through the production asset router and desktop API.
// --native runs the same checks in an isolated real Windows WebView2 client.
// No provider credentials or external model requests are used.
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {mkdir, mkdtemp, copyFile, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';
import {createPdfFixture} from '../tests/helpers/document-fixtures.mjs';

const native = process.argv.includes('--native');
const output = path.resolve('.sciencescope-local/temp/t05-validation', native ? 'native' : 'research-base-ui');
await mkdir(output, {recursive: true});
const root = await mkdtemp(path.join(output, 'run-'));
const projectId = 't05-project', chatId = 't05-main';
const model = {providerId: 't05-local', modelId: 'offline'};
const markdown = '# T05 imported research\n\n## Methods\n\nT05_NEEDLE_42: repeated measurements require a paired analysis.\n';
const state = {toolHandler: null, sends: [], briefs: [], proposals: [], sessionId: null, answer: ''};
const errors = [], assetFailures = [], screenshots = [], citationRequests = [];
let server, browser, page, child, phase = 'setup';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const runtimeHost = {
  capabilities: {tokenStreaming: true, reasoningEffort: false},
  listProviders: async () => [{id: model.providerId, name: 'T05 local fixture', configured: true, saved: true, models: [model.modelId]}],
  getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  observeSession: () => () => {}, configurePolicy: async () => {}, configureReasoning: async () => {},
  releaseSession: async () => {}, close: async () => {}, getGoal: async () => null,
  startSession: async ({sessionId, noTools}) => sessionId || (noTools ? 'session-t05-minutes' : 'session-t05-main'),
  setToolHandler: handler => {state.toolHandler = handler;},
  configureBrief: async value => {state.briefs.push(value);},
  send: async ({sessionId, text, onEvent}) => {
    if(sessionId === 'session-t05-minutes') {onEvent({type: 'completed', text: 'Local fixture minutes'}); return {finalResponse: 'Local fixture minutes'};}
    state.sessionId = sessionId; state.sends.push(text);
    const hits = await state.toolHandler({sessionId, name: 'research_search', args: {query: 'T05_NEEDLE_42'}, callId: 't05-search'});
    assert.ok(hits.hits.some(hit => hit.cite === '[S1]'));
    state.answer = `The paired analysis follows [S1] and ${state.itemCite || '[S1]'}; page syntax [S2 p.2]. Unknown citation [S999].\n\nCode stays literal: \`[S1]\`.\n\n\`\`\`text\n[S1]\n\`\`\``;
    onEvent({type: 'text-delta', delta: state.answer}); onEvent({type: 'completed', text: state.answer});
    return {finalResponse: state.answer};
  },
  runExperts: async ({sessionId, runId, experts, onEvent}) => {
    state.expertRuns = (state.expertRuns || 0) + 1;
    const expert = experts[0]; state.expertId = expert.id;
    assert.equal(sessionId, state.sessionId, 'the discussion uses the bound Main session');
    onEvent({type: 'expert-start', runId, expertId: expert.id});
    await state.toolHandler({sessionId, expertId: expert.id, name: 'research_search', args: {query: 'T05_NEEDLE_42'}, callId: 't05-expert-search'});
    await state.toolHandler({sessionId, expertId: expert.id, name: 'research_read', args: {cite: state.itemCite}, callId: 't05-expert-read'});
    onEvent({type: 'expert-tool', runId, expertId: expert.id, callId: 't05-propose-0', name: 'research_propose', argumentsPreview: '{"op":"create"}'});
    const submitted = await propose('T05 proposed decision', 'Expert original body.', {expertId: expert.id});
    onEvent({type: 'expert-tool-result', runId, expertId: expert.id, callId: 't05-propose-0', name: 'research_propose', resultPreview: JSON.stringify(submitted), isError: false});
    onEvent({type: 'expert-tool', runId, expertId: expert.id, callId: 't05-propose-interrupted', name: 'research_propose', argumentsPreview: '{"op":"create"}'});
    const result = {expertId: expert.id, text: state.answer, stopReason: 'completed', ms: 1};
    onEvent({type: 'expert-end', runId, ...result}); return [result];
  },
  cancelExperts: async () => {},
};
async function request(route, body) {
  const response = await apiFetch(server, 'api/' + route, body === undefined ? {} : {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
  const data = await response.json(); assert.equal(response.status, 200, `${route}: ${JSON.stringify(data)}`); return data;
}
async function poll(read, check, label, timeout = 15000) {
  const deadline = Date.now() + timeout; let value;
  do {value = await read(); if(check(value))return value; await pause(100);} while(Date.now() < deadline);
  throw Error(`${label}: ${JSON.stringify(value)}`);
}
async function ready() {
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeResearchBase && window.ScienceScopePreferences?.ready);
  await page.evaluate(() => Promise.all([window.ScienceScopeWorkspace.ready, window.ScienceScopePreferences.ready]));
}
async function tab(name) {
  await page.evaluate(async ({name, projectId}) => {S.projectId = projectId; await window.ScienceScopeResearchBase.openTab(name);}, {name, projectId});
  await page.waitForSelector(`[data-rb-tab="${name}"].active`);
}
const action = (name, id) => page.locator(`[data-rb-action="${name}"]${id ? `[data-id="${id}"]` : ''}`).first();
async function closeModal() {await page.evaluate(() => document.querySelector('#modal')?.remove());}
async function itemForm(title, body, subtype) {
  const form = page.locator('#rb-item-form'); await form.waitFor();
  if(subtype)await form.locator('[name="subtype"]').selectOption(subtype);
  await form.locator('[name="title"]').fill(title); await form.locator('[name="body"]').fill(body);
  await form.locator('button[type="submit"]').click();
  await form.waitFor({state: 'detached'});
}
async function propose(title, body, {expertId = 'methodologist', op = 'create', targetId = null} = {}) {
  const proposal = await state.toolHandler({sessionId: state.sessionId, name: 'research_propose', expertId, callId: `t05-propose-${state.proposals.length}`, args: {op, ...(targetId ? {targetId} : {}), item: {type: 'memory', subtype: 'decision', title, body}, rationale: 'Bound local expert proposal; user confirmation is required.', evidence: [{cite: '[S1]', relation: 'supports', quote: 'paired analysis'}]}});
  state.proposals.push(proposal); return proposal;
}
async function screenshot(name, key) {const file = path.join(output, `${name}-${key}.png`); await page.screenshot({path: file, fullPage: true}); screenshots.push(file);}
async function freePort() {const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;}
async function launch() {
  if(!native) {
    browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {headless: true, executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', viewport: {width: 1440, height: 960}, env: {...process.env, TEMP: root, TMP: root}});
    page = await browser.newPage(); await installApiToken(page, server);
  } else {
    assert.equal(process.platform, 'win32', '--native requires Windows');
    const executable = path.join(root, 'sciencescope-desktop.exe');
    await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'), executable);
    const port = await freePort();
    state.nativeDiagnosticPort = port;
    child = spawn(executable, [], {cwd: root, windowsHide: true, stdio: 'ignore', env: {...process.env, SCIENCESCOPE_NODE: process.execPath, SCIENCESCOPE_HOST_SCRIPT: path.resolve('scripts/native-fixture-host.mjs'), SCIENCESCOPE_TEST_HOST_URL: server.url, SCIENCESCOPE_TEST_API_TOKEN: server.apiToken, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, TEMP: root, TMP: root}});
    for(let i = 0; i < 60; i++) {try {browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break;} catch {await pause(500);}}
    assert.ok(browser, 'owned native diagnostic connection required');
    page = await poll(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith(server.url) && !candidate.url().includes('surface=')), Boolean, 'native main page');
    assert.ok(await page.evaluate(() => !!window.__TAURI__?.core?.invoke), 'actual Tauri bridge required');
  }
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {const url = new URL(request.url()); if(url.pathname === '/api/research/cite')citationRequests.push({label: url.searchParams.get('label'), projectId: url.searchParams.get('projectId'), hasProject: url.searchParams.has('projectId')});});
  page.on('response', response => {if(response.url().includes('/desktop/') && response.status() >= 400)assetFailures.push({url: response.url(), status: response.status()});});
  if(!native)await page.goto(server.url);
  await ready();
}
try {
  server = await createDesktopServer({dataRoot: path.join(root, 'app'), outputDir: path.join(root, 'assets'), runtimeHost});
  await request('workspace', {projects: [{id: projectId, name: 'T05 Research Project', desc: '', archived: false}], pins: [], projectExpanded: {[projectId]: true}});
  await launch();
  phase = 'import and automatic parsing'; await tab('sources');
  const chooser = page.waitForEvent('filechooser'); await action('import').click();
  await (await chooser).setFiles({name: 't05-research.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown)});
  const sources = await poll(() => request(`research/sources?projectId=${projectId}`), data => data.sources.some(source => source.contentStatus === 'parsed'), 'UI import must parse automatically');
  const source = sources.sources.find(record => record.contentStatus === 'parsed'); assert.equal(source.label, 'S1'); assert.equal(source.projectId, projectId);
  await tab('sources'); await action('preview', source.id).click();
  await page.waitForSelector('.file-preview-panel [data-preview-doc]');
  assert.match(await page.locator('.file-preview-panel').innerText(), /T05_NEEDLE_42/);
  await page.locator('.file-preview-panel [data-v="close-panel"]').click();

  phase = 'source metadata and filters'; await tab('sources'); await action('edit-source', source.id).click();
  const sourceForm = page.locator('#rb-source-form');
  await sourceForm.locator('[name="kind"]').selectOption('paper');
  await sourceForm.locator('[name="authors"]').fill('Ada Lovelace; Alan Turing');
  await sourceForm.locator('[name="year"]').fill('2026'); await sourceForm.locator('[name="venue"]').fill('T05 Journal');
  await sourceForm.locator('[name="tags"]').fill('t05-owned, paired'); await sourceForm.locator('[name="readStatus"]').selectOption('read');
  await sourceForm.locator('button[type="submit"]').click(); await sourceForm.waitFor({state: 'detached'});
  const metadata = (await request(`research/source?id=${source.id}`)).source;
  assert.equal(metadata.kind, 'paper'); assert.equal(metadata.year, 2026); assert.equal(metadata.venue, 'T05 Journal'); assert.equal(metadata.authors[0].literal, 'Ada Lovelace'); assert.equal(metadata.readStatus, 'read');
  await page.locator('[data-rb-filter="kind"]').selectOption('file');
  await poll(() => page.locator(`[data-rb-source="${source.id}"]`).count(), value => value === 0, 'source kind filter excludes papers from file view');
  await page.locator('[data-rb-filter="kind"]').selectOption('paper'); await page.waitForSelector(`[data-rb-source="${source.id}"]`);
  await page.locator('[data-rb-filter="kind"]').selectOption('');
  await page.locator('[data-rb-filter="readStatus"]').selectOption('unread');
  await poll(() => page.locator(`[data-rb-source="${source.id}"]`).count(), value => value === 0, 'read-status filter excludes read document');
  await page.locator('[data-rb-filter="readStatus"]').selectOption('read');
  await page.waitForSelector(`[data-rb-source="${source.id}"]`);
  await page.locator('[data-rb-filter="readStatus"]').selectOption('');
  await page.locator('[data-rb-filter="tag"]').fill('absent-t05-tag'); await page.locator('[data-rb-filter="tag"]').dispatchEvent('change');
  await poll(() => page.locator('[data-rb-source]').count(), value => value === 0, 'tag filter excludes unrelated documents');
  await page.locator('[data-rb-filter="tag"]').fill(''); await page.locator('[data-rb-filter="tag"]').dispatchEvent('change');
  await page.waitForSelector(`[data-rb-source="${source.id}"]`);
  await action('reparse', source.id).click();
  await poll(() => request(`research/source?id=${source.id}`), value => value.source.contentStatus === 'parsed', 'reparse completes');

  phase = 'source sorting and 50-row pagination';
  const pagingSources = [];
  for(let index = 1; index <= 51; index++)pagingSources.push((await request('research/sources', {source: {projectId, kind: 'paper', title: `T05 paging ${String(index).padStart(2, '0')}`, tags: ['t05-paging'], year: 2020 + index % 7}})).source);
  await tab('sources'); await page.locator('[data-rb-filter="tag"]').fill('t05-paging'); await page.locator('[data-rb-filter="tag"]').dispatchEvent('change');
  await poll(() => page.locator('[data-rb-source]').count(), value => value === 50, 'first source page has exactly 50 rows');
  await page.locator('[data-rb-filter="sort"]').selectOption('title'); await page.locator('[data-rb-filter="direction"]').selectOption('asc');
  await poll(() => page.locator('[data-rb-source]').first().innerText(), value => value.includes('T05 paging 01'), 'source sorting is applied before pagination');
  await action('next').click(); await poll(() => page.locator('[data-rb-source]').count(), value => value === 1, 'second page contains remaining source');
  assert.match(await page.locator('[data-rb-source]').innerText(), /T05 paging 51/); assert.equal(await action('next').isEnabled(), false);
  await action('prev').click(); await poll(() => page.locator('[data-rb-source]').count(), value => value === 50, 'previous page restores 50 rows');
  await request('research/sources/remove', {id: pagingSources.at(-1).id}); await tab('sources');
  assert.equal(await page.locator('[data-rb-source]').count(), 50); assert.equal(await action('next').isEnabled(), false, 'an exact 50-source total has no empty next page');
  for(const owned of pagingSources)await request('research/sources/remove', {id: owned.id});
  await page.locator('[data-rb-filter="tag"]').fill(''); await page.locator('[data-rb-filter="tag"]').dispatchEvent('change'); await tab('sources');

  phase = 'search';
  const hits = (await request(`research/search?projectId=${projectId}&q=T05_NEEDLE_42`)).hits;
  assert.ok(hits.some(hit => hit.cite === '[S1]' && hit.snippet.includes('T05_NEEDLE_42')));
  await page.locator('#rb-query').fill('T05_NEEDLE_42'); await page.locator('#rb-search').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => document.querySelector('[data-rb-search-results]')?.textContent.includes('T05_NEEDLE_42'));
  assert.ok(await page.locator('[data-rb-search-results] mark').count(), 'search snippets are highlighted');

  phase = 'decision and exact brief'; await tab('memory'); await action('new').click();
  await itemForm('T05 initial decision', 'Primary outcome uses paired measurements.', 'decision');
  let items = (await request(`research/items?projectId=${projectId}&type=memory`)).items;
  const decision = items.find(item => item.title === 'T05 initial decision'); assert.ok(decision);
  state.itemCite = `[@${decision.id.replace(/^itm_/, '').slice(0, 8)}]`;
  await tab('brief'); const brief = await request(`research/brief?projectId=${projectId}`);
  assert.match(brief.text, /T05 initial decision/);
  assert.equal(await page.locator('[data-rb-brief-text]').textContent(), brief.text, 'brief displays exactly the model input');

  phase = 'model turn and bound expert proposal';
  const pdfImport = await request('library/import', {name: 't05-pages.pdf', projectId, base64: (await createPdfFixture()).toString('base64')});
  await request('research/sources/ingest', {resourceId: pdfImport.id, wait: true});
  const response = await apiFetch(server, 'api/chat', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chatId, projectId, model, text: 'T05_NEEDLE_42 analysis', userMessageId: 't05-user', assistantMessageId: 't05-answer'})});
  await response.text(); assert.equal(response.status, 200);
  assert.ok(state.briefs.some(value => value.text.includes(brief.text)), 'exact brief reaches the runtime');
  const discussionResponse = await apiFetch(server, 'api/discussion', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({chatId, projectId, model, kind: 'ordered', text: 'Propose a paired-analysis decision based on T05_NEEDLE_42.', expertIds: ['methodologist'], userMessageId: 't05-discussion-user'})});
  const discussionText = await discussionResponse.text(); assert.equal(discussionResponse.status, 200, discussionText);
  const discussionEvents = discussionText.trim().split('\n').map(line => JSON.parse(line));
  state.expertMessageId = discussionEvents.find(event => event.type === 'accepted').experts[0].messageId;
  assert.equal(discussionEvents.at(-1).type, 'completed');
  const expertUsage = (await request(`research/usage?chatId=${chatId}&messageId=${state.expertMessageId}`)).refs;
  assert.ok(expertUsage.some(ref => ref.how === 'search')); assert.ok(expertUsage.some(ref => ref.how === 'read'), 'actual expert tool calls have usage receipts on their own answer');
  // Discover the HTTP-seeded chat through the normal workspace bootstrap.
  await page.reload(); await ready();
  const proposed = state.proposals[0]; assert.ok(proposed);
  await tab('inbox'); await action('origin', proposed.proposalId).click();
  await page.waitForSelector(`#message-${state.expertMessageId}`); assert.equal(await page.evaluate(() => V.chat), chatId);
  await tab('inbox'); await action('edit-proposal', proposed.proposalId).click();
  const proposalForm = page.locator(`[data-rb-proposal-form="${proposed.proposalId}"]`);
  await proposalForm.locator('[name="title"]').fill('T05 accepted after edit');
  await proposalForm.locator('[name="body"]').fill('User-edited decision with provenance.');
  await action('save-proposal', proposed.proposalId).click();
  const accepted = await poll(() => request(`research/proposals?projectId=${projectId}&status=accepted`), data => data.proposals.some(proposal => proposal.id === proposed.proposalId), 'edited proposal accepted');
  const acceptedProposal = accepted.proposals.find(proposal => proposal.id === proposed.proposalId);
  assert.equal(acceptedProposal.origin.chatId, chatId); assert.equal(acceptedProposal.origin.messageId, state.expertMessageId); assert.notEqual(acceptedProposal.origin.messageId, 't05-answer'); assert.equal(acceptedProposal.origin.toolCallId, 't05-propose-0'); assert.equal(acceptedProposal.origin.role, 'expert'); assert.equal(acceptedProposal.origin.expertId, state.expertId);
  const acceptedItem = (await request(`research/item?id=${acceptedProposal.resultId}`)).item;
  assert.equal(acceptedItem.body, 'User-edited decision with provenance.'); assert.equal(acceptedItem.title, 'T05 accepted after edit');

  phase = 'bulk proposal decisions';
  const rejectedOne = await propose('T05 reject one', 'Not accepted.'); const rejectedTwo = await propose('T05 reject two', 'Not accepted either.');
  await tab('inbox');
  await page.locator(`[data-rb-select="${rejectedOne.proposalId}"]`).check(); await page.locator(`[data-rb-select="${rejectedTwo.proposalId}"]`).check();
  await action('bulk-reject').click();
  await poll(() => request(`research/proposals?projectId=${projectId}&status=rejected`), value => value.proposals.some(p => p.id === rejectedOne.proposalId) && value.proposals.some(p => p.id === rejectedTwo.proposalId), 'bulk rejection persists');
  const bulkAccepted = await propose('T05 bulk accepted', 'Confirmed through the batch action.');
  await tab('inbox'); await page.locator(`[data-rb-select="${bulkAccepted.proposalId}"]`).check(); await action('bulk-accept').click();
  await poll(() => request(`research/proposals?projectId=${projectId}&status=accepted`), value => value.proposals.some(p => p.id === bulkAccepted.proposalId), 'bulk acceptance persists');

  phase = 'supersede and revision history'; await tab('memory'); await action('edit', decision.id).click();
  await itemForm('T05 initial decision', 'Clarified initial paired decision.');
  await action('edit', decision.id).click();
  const staleForm = page.locator('#rb-item-form'); await staleForm.locator('[name="body"]').fill('STALE overwrite must be rejected.');
  const current = (await request(`research/item?id=${decision.id}`)).item;
  await request('research/items/update', {id: decision.id, patch: {body: 'Concurrent user revision.', expectedRevision: current.revision}});
  await staleForm.locator('button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#rb-item-form [data-rb-form-error]')?.textContent.includes('刷新'));
  assert.equal((await request(`research/item?id=${decision.id}`)).item.body, 'Concurrent user revision.');
  assert.equal(await staleForm.locator('[name="body"]').inputValue(), 'STALE overwrite must be rejected.'); await closeModal();
  await action('supersede', decision.id).click(); await itemForm('T05 replacement decision', 'Updated primary outcome uses the longitudinal model.');
  const historical = await request(`research/item?id=${decision.id}`);
  assert.equal(historical.item.status, 'superseded'); assert.ok(historical.item.supersededBy); assert.ok(historical.revisions.some(revision => revision.snapshot.body === 'Primary outcome uses paired measurements.'));
  await page.evaluate(id => window.ScienceScopeResearchBase.openItem(id), decision.id); await action('history', decision.id).click();
  await page.waitForSelector('[data-rb-history]'); assert.match(await page.locator('[data-rb-history]').innerText(), /Primary outcome uses paired measurements/); await closeModal();
  const updatedBrief = (await request(`research/brief?projectId=${projectId}`)).text;
  assert.match(updatedBrief, /T05 replacement decision/); assert.doesNotMatch(updatedBrief, /T05 initial decision/);

  phase = 'category content';
  const knowledge = (await request('research/items', {item: {projectId, type: 'knowledge', subtype: 'definition', pinned: true, title: 'T05 paired comparison', body: 'A comparison within the same participants.'}})).item;
  const formula = (await request('research/items', {item: {projectId, type: 'model', subtype: 'formula', title: 'T05 energy model', body: 'Energy mass equivalence.', payload: {latex: 'E=mc^2', variables: [{symbol: 'm', meaning: 'mass', unit: 'kg'}], assumptions: ['Constant speed of light'], steps: ['Multiply mass by squared speed']}}})).item;
  const claim = (await request('research/items', {item: {projectId, type: 'claim', subtype: 'claim', title: 'T05 evidence claim', body: 'Repeated measurements require care.', payload: {claimStatus: 'supported'}}})).item;
  await request('research/links', {link: {from: {type: 'source', id: source.id}, to: {type: 'item', id: claim.id}, relation: 'supports', quote: 'paired analysis'}});
  await tab('model'); assert.ok(await page.locator('.katex').count(), 'model LaTeX is rendered with KaTeX'); assert.match(await page.locator('.content').innerText(), /mass[\s\S]*kg/);
  await tab('knowledge'); assert.match(await page.locator('.content').innerText(), /T05 paired comparison/);
  await tab('claim'); assert.match(await page.locator('.content').innerText(), /T05 evidence claim/);
  phase = 'pin, subtype and archive filters'; await tab('knowledge'); await action('pin', knowledge.id).click();
  await poll(() => request(`research/item?id=${knowledge.id}`), value => !value.item.pinned, 'pin toggle persists');
  await page.locator('[data-rb-filter="pinned"]').selectOption('true'); await poll(() => page.locator(`[data-rb-item="${knowledge.id}"]`).count(), value => value === 0, 'pinned filter excludes unpinned record');
  await page.locator('[data-rb-filter="pinned"]').selectOption(''); await tab('knowledge');
  await page.locator('[data-rb-filter="subtype"]').selectOption('method'); await poll(() => page.locator(`[data-rb-item="${knowledge.id}"]`).count(), value => value === 0, 'subtype filter excludes definitions');
  await page.locator('[data-rb-filter="subtype"]').selectOption('definition'); await page.waitForSelector(`[data-rb-item="${knowledge.id}"]`);
  await action('pin', knowledge.id).click(); await poll(() => request(`research/item?id=${knowledge.id}`), value => value.item.pinned, 'repinning persists');
  const archiveCandidate = (await request('research/items', {item: {projectId, type: 'knowledge', subtype: 'definition', title: 'T05 archive candidate', body: 'History stays durable after archive.'}})).item;
  await tab('knowledge'); await action('archive', archiveCandidate.id).click(); await page.locator('dialog.workspace-confirm [value="confirm"]').click();
  await poll(() => request(`research/item?id=${archiveCandidate.id}`), value => value.item.status === 'archived', 'archive is durable');
  await page.locator('[data-rb-filter="status"]').selectOption('archived'); await page.waitForSelector(`[data-rb-item="${archiveCandidate.id}"]`);
  await page.locator('[data-rb-filter="status"]').selectOption('active'); await tab('knowledge');
  await propose('T05 pending screenshot proposal', 'This proposal is still pending.');

  phase = 'citation chips, usage and pending proposal notice';
  await page.evaluate(async id => {await window.SSV2.loadThread(id); go('work'); window.ScienceScopeCitations?.refresh();}, chatId);
  await page.waitForSelector('#message-t05-answer [data-research-citation]');
  const answer = page.locator('#message-t05-answer');
  await answer.locator('[data-research-citation][data-label="[S999]"]').hover();
  await poll(() => answer.locator('[data-research-citation][data-label="[S999]"]').count(), value => value === 0, 'unknown citation falls back to literal text');
  await page.evaluate(async () => {window.ScienceScopeCitations.refresh(); await new Promise(resolve => requestAnimationFrame(resolve));});
  assert.equal(await answer.locator('[data-research-citation][data-label="[S999]"]').count(), 0, 'refresh never recreates an unresolved citation');
  assert.match(await answer.locator('.message-text').innerText(), /Unknown citation \[S999\]/);
  assert.equal(await answer.locator('code [data-research-citation]').count(), 0, 'code citations remain literal');
  assert.equal(await answer.locator('[data-research-citation][data-label="[S1]"]').count(), 1);
  assert.equal((await request(`chats/${chatId}/messages`)).messages.find(message => message.id === 't05-answer').text, state.answer, 'citation rendering never changes stored model text');
  const sourceChip = answer.locator('[data-research-citation][data-label="[S1]"]');
  await sourceChip.hover();
  await page.waitForFunction(() => document.querySelector('#message-t05-answer [data-label="[S1]"]')?.title.includes('T05 imported research'));
  await sourceChip.click();
  await page.waitForSelector('.file-preview-panel [data-preview-doc]');
  assert.match(await page.locator('.file-preview-panel').innerText(), /T05_NEEDLE_42/);
  await page.locator('.file-preview-panel [data-v="close-panel"]').click();
  await answer.locator('[data-research-citation][data-label="[S2 p.2]"]').click();
  await page.waitForFunction(() => document.querySelector('.file-preview-panel [data-reader-page]')?.value === '2' && document.querySelector('.file-preview-panel .page[data-page-number="2"] .textLayer')?.textContent.includes('second page confirms'));
  assert.match(await page.locator('.file-preview-panel .page[data-page-number="2"]').innerText(), /second page confirms/);
  await page.locator('.file-preview-panel [data-v="close-panel"]').click();
  await answer.locator(`[data-research-citation][data-label="${state.itemCite}"]`).click();
  await page.waitForSelector('[data-rb-action="history"]'); await closeModal();
  await answer.locator('[data-research-usage] summary').click();
  assert.match(await answer.locator('[data-research-usage]').innerText(), /T05 initial decision/);
  assert.match(await answer.locator('[data-research-usage]').innerText(), /T05 imported research/);
  const usage = (await request(`research/usage?chatId=${chatId}&messageId=t05-answer`)).refs;
  assert.ok(usage.some(ref => ref.how === 'search')); assert.ok(usage.some(ref => ref.how === 'brief'));
  const notice = page.locator(`#message-${state.expertMessageId} [data-research-proposal-notice]`); await notice.waitFor();
  assert.equal(await notice.getAttribute('data-count'), '1', 'interrupted research_propose activity is excluded from submitted count');
  await notice.click();
  await page.waitForSelector('[data-rb-tab="inbox"].active');

  phase = 'explicit project materials and actual composer round';
  assert.equal((await request('status')).features.materialsPanel, true);
  const privateItem = (await request('research/items', {item: {projectId, type: 'memory', subtype: 'preference', visibility: 'private', title: 'T05 private picker sentinel', body: 'Never select as model context.'}})).item;
  await page.evaluate(async id => {await window.SSV2.loadThread(id); go('work'); openPanel('context');}, chatId);
  await page.waitForSelector(`[data-rb-pick-resource="${source.resourceId}"]`);
  assert.equal(await page.locator(`[data-rb-pick-item="${privateItem.id}"]`).count(), 0, 'private items are excluded from material selection');
  await page.locator(`[data-rb-pick-resource="${source.resourceId}"]`).check(); await page.locator(`[data-rb-pick-item="${knowledge.id}"]`).check();
  await poll(() => request(`research-input/draft?scope=main&ownerId=${chatId}`), value => value.contextRefs.length === 2, 'explicit material selection is saved');
  assert.equal(state.sends.length, 1, 'selecting material does not send or mutate the model session');
  await page.reload(); await ready(); await page.evaluate(async id => {await window.SSV2.loadThread(id); go('work'); openPanel('context');}, chatId);
  await page.evaluate(model => window.ScienceScopeModels.select(model), model);
  await page.waitForFunction(({resourceId, itemId}) => document.querySelector(`[data-rb-pick-resource="${resourceId}"]`)?.checked && document.querySelector(`[data-rb-pick-item="${itemId}"]`)?.checked, {resourceId: source.resourceId, itemId: knowledge.id});
  await page.locator('[data-rb-materials-body]').locator('..').locator('[data-v="close-panel"]').click();
  await page.locator('[data-draft="main"]').fill('T05_NEEDLE_42 with explicitly selected materials');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await poll(async () => state.sends.length, value => value === 2, 'composer reaches local runtime');
  await page.waitForFunction(() => !V.pending.has(V.chat));
  assert.ok(state.sends[1].includes(`id="${source.resourceId}"`)); assert.ok(state.sends[1].includes(`id="${knowledge.id}"`));
  assert.match(state.sends[1], /A comparison within the same participants/);
  await poll(() => request(`research-input/draft?scope=main&ownerId=${chatId}`), value => value.contextRefs.length === 0, 'accepted composer send clears captured source and item refs');

  phase = 'independent chat citation scope';
  const personalImport = await request('library/import', {name: 't05-personal.md', projectId: null, base64: Buffer.from('# T05 personal source\n\nT05_PERSONAL_ONLY: this is the independent source.\n').toString('base64')});
  const personalSource = (await request('research/sources/ingest', {resourceId: personalImport.id, wait: true})).source;
  assert.equal(personalSource.label, 'S1'); assert.equal(personalSource.projectId, null);
  await page.evaluate(() => {
    window.SSV2.newThread(null); go('work');
    // Render a small answer fixture in the real independent draft. This
    // exercises scope without advancing another runtime/model session.
    const message = document.createElement('article'); message.id = 'message-t05-independent-answer'; message.className = 'message assistant'; message.dataset.messageId = 't05-independent-answer'; message.dataset.t05ScopeFixture = '';
    Object.assign(message.style, {position: 'fixed', top: '180px', left: '320px', width: '600px', zIndex: '1000'});
    const text = document.createElement('div'); text.className = 'message-text'; text.textContent = 'Independent citation [S1]'; message.append(text); document.body.append(message);
    window.ScienceScopeCitations.refresh(message);
  });
  assert.equal(await page.evaluate(() => window.ScienceScopeWorkspace.resolveThread(V.chat).projectId), null);
  assert.equal(await page.evaluate(() => S.projectId), projectId, 'reproduce the stale prior project retained by independent navigation');
  const beforeScopeRequests = citationRequests.length;
  const personalChip = page.locator('#message-t05-independent-answer [data-research-citation]'); await personalChip.hover();
  await page.waitForFunction(() => document.querySelector('#message-t05-independent-answer [data-research-citation]')?.title.includes('T05 personal source'));
  await personalChip.click(); await page.waitForSelector('.file-preview-panel [data-preview-doc]');
  assert.equal(await page.evaluate(() => window.ScienceScopePreview.current()), personalImport.id);
  assert.match(await page.locator('.file-preview-panel').innerText(), /T05_PERSONAL_ONLY/);
  const personalResolution = citationRequests.slice(beforeScopeRequests).find(request => request.label === '[S1]'); assert.ok(personalResolution);
  assert.equal(personalResolution.hasProject, false); assert.equal(personalResolution.projectId, null);
  await page.locator('.file-preview-panel [data-v="close-panel"]').click(); await page.evaluate(() => document.querySelector('[data-t05-scope-fixture]')?.remove());
  await request('research/sources/remove', {id: personalSource.id}); assert.equal(state.sends.length, 2, 'scope regression adds no runtime requests');

  phase = 'screenshots';
  for(const language of ['zh-CN', 'en'])for(const theme of ['light', 'dark']) {
    await request('preferences', {language, theme}); await page.reload(); await ready();
    await page.waitForFunction(({language, theme}) => document.documentElement.lang === language && document.documentElement.dataset.theme === theme, {language, theme});
    const key = `${language === 'en' ? 'en' : 'zh'}-${theme}`;
    for(const category of ['sources', 'knowledge', 'model', 'claim', 'memory', 'inbox', 'brief']) {await tab(category); await screenshot(category, key);}
    await page.evaluate(async id => {await window.SSV2.loadThread(id); go('work');}, chatId);
    await page.waitForSelector('#message-t05-answer');
    await screenshot('citation', key);
  }
  assert.deepEqual(errors, []); assert.deepEqual(assetFailures, []);
  if(native) {
    await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(error => {if(!/closed/i.test(error.message))throw error;});
    await poll(async () => child.exitCode, value => value !== null, 'owned native client exits'); assert.equal(child.exitCode, 0);
  }
  const result = {passed: true, productionRouter: true, native, ...(native ? {nativeMainPid: child.pid, nativeMainExited: child.exitCode === 0, nativeDiagnosticPort: state.nativeDiagnosticPort} : {}), importedAndAutoParsed: true, sourceMetadata: true, filtersSortingPagination50: true, searched: true, exactBrief: true, runtimeBrief: true, actualDiscussionExpert: true, expertOwnAnswerOriginAndUsage: true, expertProposalEditedAccepted: true, bulkProposalDecisions: true, optimisticRevisionConflict: true, supersededHistory: true, pinArchiveFilters: true, modelKatex: true, citationPreview: true, pageCitationLocated: true, citationRawTextPreserved: true, unknownCitationStableFallback: true, independentCitationScope: true, usage: true, proposalNotice: true, interruptedProposeExcluded: true, materialSelectionPersisted: true, explicitContextReachedRuntime: true, capturedContextClearedOnAck: true, composerRound: true, screenshots, localModelTurns: state.sends.length, localExpertRuns: state.expertRuns, paidRequests: 0};
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch(error) {
  await page?.screenshot({path: path.join(output, 'failure.png'), fullPage: true}).catch(() => {});
  console.error(JSON.stringify({phase, errors, assetFailures, message: error.message, screenshot: path.join(output, 'failure.png')})); throw error;
} finally {
  if(native && child?.exitCode === null) {await page?.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {}); await pause(1000); if(child.exitCode === null)child.kill();}
  await browser?.close().catch(() => {}); await server?.close().catch(() => {});
  await rm(root, {recursive: true, force: true, maxRetries: 6, retryDelay: 500});
}
