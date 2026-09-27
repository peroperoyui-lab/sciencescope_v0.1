import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';

async function fixture({ seedResources } = {}) {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-api-'));
  if (seedResources) await seedResources(root);
  const state = { toolHandler: null, briefs: [], sends: [] };
  const host = {
    capabilities: { tokenStreaming: true, reasoningEffort: false },
    listProviders: async () => [], getRuntimeConfig: async () => ({}), getContextUsage: async () => null, observeSession: () => () => {},
    startSession: async ({ sessionId }) => sessionId || 'session-research1',
    configureReasoning: async () => {}, configurePolicy: async () => {}, releaseSession: async () => {}, close: async () => {},
    setToolHandler: (fn) => { state.toolHandler = fn; },
    configureBrief: async ({ sessionId, text }) => { state.briefs.push({ sessionId, text }); },
    send: async ({ sessionId, text, onEvent }) => {
      state.sends.push(text);
      // The model calls a research tool mid-turn through the host channel.
      state.duringTurn = await state.toolHandler({ sessionId, name: 'research_search', args: { query: '随机' } });
      onEvent({ type: 'completed', text: 'OK' }); return { finalResponse: 'OK' };
    },
  };
  const api = await createDesktopApi({ dataRoot: root, runtimeHost: host });
  const server = createServer((req, res) => api.handle(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, route, body) => new Promise((resolve, reject) => {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const req = httpRequest({ hostname: '127.0.0.1', port, path: route, method, headers: { host: `127.0.0.1:${port}`, ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }) } }, (res) => {
      let text = ''; res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { const lines = text.trim() ? text.trim().split('\n') : []; resolve({ status: res.statusCode, body: lines.length === 1 ? JSON.parse(lines[0]) : lines.map((l) => JSON.parse(l)) }); });
    }); req.on('error', reject); req.end(raw);
  });
  return { state, call, close: async () => { await api.close(); await new Promise((resolve) => server.close(resolve)); await rm(root, { recursive: true, force: true }); } };
}

test('research routes, brief injection and session-bound tool calls through the desktop API', async () => {
  const f = await fixture();
  try {
    const md = Buffer.from('# 预实验\n\n## 方法\n\n未随机分组，采血时间未统一。\n').toString('base64');
    const imported = await f.call('POST', '/api/library/import', { name: 'study.md', base64: md, projectId: null });
    assert.equal(imported.status, 200);
    const sync = await f.call('POST', '/api/research/sync', { projectId: null, wait: true });
    assert.equal(sync.body.total, 1);
    assert.ok(sync.body.queued === 0 || sync.body.queued === 1, 'sync may find import ingestion already queued or completed');
    const sources = (await f.call('GET', '/api/research/sources?projectId=')).body.sources;
    assert.equal(sources[0].contentStatus, 'parsed'); assert.equal(sources[0].title, '预实验');
    for (const [id, title, year] of [['source-b', 'Beta', 2020], ['source-a', 'Alpha', 2022]]) {
      assert.equal((await f.call('POST', '/api/research/sources', { source: { id, projectId: null, title, year, tags: ['trial'] } })).status, 200);
    }
    const page = (await f.call('GET', '/api/research/sources?projectId=&tag=trial&sort=title&direction=asc&limit=1&offset=0')).body;
    assert.equal(page.total, 2); assert.equal(page.sources[0].title, 'Alpha'); assert.equal(page.hasMore, true);
    const search = (await f.call('GET', '/api/research/search?q=' + encodeURIComponent('采血') + '&projectId=')).body.hits;
    assert.equal(search[0].cite, '[S1]');
    assert.equal((await f.call('GET', '/api/research/search?q=')).status, 400);

    const goal = (await f.call('POST', '/api/research/items', { item: { type: 'memory', subtype: 'goal', scope: 'personal', title: '研究目标', body: '评估 IF 对胰岛素敏感性的影响' } })).body.item;
    const evidenceSource = (await f.call('GET', '/api/research/sources?projectId=')).body.sources[0];
    await f.call('POST', '/api/research/links', { link: { from: { type: 'source', id: evidenceSource.id }, to: { type: 'item', id: goal.id }, relation: 'supports', quote: '未随机分组' } });
    await f.call('POST', '/api/research/links', { link: { from: { type: 'source', id: evidenceSource.id }, to: { type: 'item', id: goal.id }, relation: 'mentions' } });
    assert.equal((await f.call('GET', '/api/research/items?projectId=&type=memory')).body.items[0].evidenceCount, 1);
    assert.equal((await f.call('GET', `/api/research/item?id=${goal.id}`)).body.item.evidenceCount, 1);
    const brief = (await f.call('GET', '/api/research/brief?projectId=')).body;
    assert.match(brief.text, /研究目标：评估 IF/);
    assert.equal((await f.call('POST', '/api/research/items', { item: { type: 'nope', title: 'x' } })).status, 400);

    // A Main turn: the brief is set on the session, the tool call is bound to
    // this chat, and the usage receipt lists what the model saw.
    const turn = await f.call('POST', '/api/chat', { chatId: 'chat-r', projectId: null, model: { providerId: 'fixture', modelId: 'm' }, text: '随机了吗？', userMessageId: 'u1', assistantMessageId: 'a1' });
    assert.equal(turn.status, 200);
    assert.match(f.state.briefs[0].text, /研究目标/);
    assert.equal(f.state.duringTurn.hits[0].cite, '[S1]');
    const usage = (await f.call('GET', '/api/research/usage?chatId=chat-r&messageId=a1')).body.refs;
    assert.deepEqual(usage.map((u) => u.how).sort(), ['brief', 'search']);
    // Unchanged brief is not re-sent.
    await f.call('POST', '/api/chat', { chatId: 'chat-r', projectId: null, model: { providerId: 'fixture', modelId: 'm' }, text: '再问', userMessageId: 'u2', assistantMessageId: 'a2' });
    assert.equal(f.state.briefs.length, 1);

    const sessionId = f.state.briefs[0].sessionId;
    const proposal = await f.state.toolHandler({ sessionId, name: 'research_propose', args: { op: 'create', item: { type: 'memory', subtype: 'decision', title: '主要终点', body: 'Matsuda 指数' }, rationale: '专家讨论后决定' }, expertId: 'statistician', callId: 'call-9' });
    assert.equal(proposal.status, 'awaiting_user_review');
    const inbox = (await f.call('GET', '/api/research/proposals')).body.proposals;
    assert.deepEqual(inbox[0].origin, { chatId: 'chat-r', messageId: null, role: 'expert', expertId: 'statistician', toolCallId: 'call-9' });
    const decided = (await f.call('POST', '/api/research/proposals/decide', { id: inbox[0].id, accept: true, edits: { item: { title: '主要终点（用户修订）', body: 'Matsuda 指数' } } })).body;
    assert.ok(decided.resultId);
    await f.call('POST', '/api/chat', { chatId: 'chat-r', projectId: null, model: { providerId: 'fixture', modelId: 'm' }, text: '三问', userMessageId: 'u3', assistantMessageId: 'a3' });
    assert.match(f.state.briefs.at(-1).text, /主要终点（用户修订）：Matsuda 指数/, 'edited accepted decision enters the next brief');

    await assert.rejects(f.state.toolHandler({ sessionId: 'session-unknown', name: 'research_nope', args: {} }), error => error.code === 'TOOL_NOT_ALLOWED');
    await assert.rejects(f.state.toolHandler({ sessionId: 'session-unknown', name: 'research_search', args: {query:'研究目标'} }), error => error.code === 'TOOL_NOT_ALLOWED', 'an unbound session cannot use a known research tool either');
    const item = (await f.call('GET', `/api/research/item?id=${goal.id}`)).body;
    assert.equal(item.item.title, '研究目标');

    const stale = await f.call('POST', '/api/research/items/supersede', { id: goal.id, expectedRevision: 0, item: { title: '陈旧修改', body: '不可覆盖' } });
    assert.equal(stale.status, 409);
    assert.equal((await f.call('GET', `/api/research/item?id=${goal.id}`)).body.item.status, 'active');
  } finally { await f.close(); }
});

test('Research Base registers legacy library resources, ingests new imports, and preserves existing source metadata', async () => {
  const f = await fixture({ seedResources: async (root) => {
    const stateDir = path.join(root, '.sciencescope-local', 'state');
    const libraryRoot = path.join(root, '.sciencescope-local', 'library');
    await mkdir(stateDir, { recursive: true });
    const database = openApplicationDatabaseSync({ stateDir });
    for (const [id, name, text] of [
      ['legacy-resource', 'legacy.md', '# Legacy source\n\nLegacy source text.'],
      ['metadata-resource', 'metadata.md', '# Parsed title\n\nMetadata should stay as set by the user.'],
    ]) {
      const relative = path.join('originals', id, name);
      const absolute = path.join(libraryRoot, relative);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, text, 'utf8');
      database.addResource({ id, title: name, kind: 'md', path: relative, metadata: { storage: 'library' } });
    }
    const research = createResearchBase({ database, resolveResourcePath: async (resource) => path.join(libraryRoot, resource.path) });
    research.store.addSource({ id: 'curated-source', title: 'User supplied metadata title', year: 2021, resourceId: 'metadata-resource' });
    database.close();
  } });
  try {
    const oldSources = (await f.call('GET', '/api/research/sources?projectId=')).body.sources;
    const legacy = oldSources.find((source) => source.resourceId === 'legacy-resource');
    assert.ok(legacy, 'a preexisting library resource without an rb_source is registered at API startup');
    assert.equal(legacy.contentStatus, 'none', 'registering a legacy source alone does not trigger historical re-parsing');
    const curated = oldSources.find((source) => source.resourceId === 'metadata-resource');
    assert.equal(curated.title, 'User supplied metadata title');
    assert.equal(curated.year, 2021, 'startup source registration preserves curated bibliographic metadata');

    const markdown = Buffer.from('# Newly imported paper\n\nUnique automatic import text.').toString('base64');
    const imported = await f.call('POST', '/api/library/import', { name: 'new-paper.md', base64: markdown, projectId: null });
    assert.equal(imported.status, 200);
    const deadline = Date.now() + 10000;
    let added;
    while (Date.now() < deadline) {
      added = (await f.call('GET', '/api/research/sources?projectId=')).body.sources.find((source) => source.resourceId === imported.body.id);
      if (added?.contentStatus === 'parsed' || added?.contentStatus === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(added, 'library import creates a Research Base source record');
    assert.equal(added.contentStatus, 'parsed');
    assert.equal(added.title, 'Newly imported paper', 'the existing parser ingests newly imported Markdown');
    assert.ok((await f.call('GET', '/api/research/search?q=Unique%20automatic%20import&projectId=')).body.hits.length);
    const curatedAfter = (await f.call('GET', `/api/research/source?id=${curated.id}`)).body.source;
    assert.equal(curatedAfter.title, 'User supplied metadata title');
    assert.equal(curatedAfter.year, 2021, 'import ingestion does not overwrite an existing source record');
  } finally { await f.close(); }
});
