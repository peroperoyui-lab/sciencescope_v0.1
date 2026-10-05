// Opt-in paid check of the Research Base with real DSH and real models:
// ingest → Main answers from the base with citations and the brief → Main
// proposes a memory → an @-invited expert searches too. Prints tool calls,
// answers and the inbox. Key: Git-ignored .sciencescope-local/secret/opencode.key.
import {createServer, request as httpRequest} from 'node:http';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';
import {createDesktopApi} from '../desktop-api.mjs';

const key = (await readFile('.sciencescope-local/secret/opencode.key', 'utf8')).trim();
const base = path.resolve('.sciencescope-local/temp/eval'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'research-base-'));
const models = ['deepseek-v4.1-flash', 'glm-5.3-flash', 'qwen3.8-flash'];
const runtimeConfig = {providers: {live: {api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'K', models: models.map(id => ({id, contextWindow: 131072, maxTokens: 8192}))}}};
const dsh = await createDshHost({home: path.join(root, '.sciencescope-local', 'dsh'), cwd: root, sessionHeaders: ['x-opencode-session'], env: {K: key}});
const host = Object.assign(Object.create(null), dsh, {getRuntimeConfig: async () => runtimeConfig, listProviders: async () => []});
const api = await createDesktopApi({dataRoot: root, runtimeHost: host, onError: error => console.log('API error:', error.message)});
const server = createServer((req, res) => api.handle(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const call = (method, route, body) => new Promise((resolve, reject) => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = httpRequest({hostname: '127.0.0.1', port, path: route, method, headers: {host: `127.0.0.1:${port}`, ...(body === undefined ? {} : {'content-type': 'application/json', 'content-length': Buffer.byteLength(raw)})}}, res => {
    let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => { const lines = text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : []; resolve({status: res.statusCode, events: lines}); });
  }); req.on('error', reject); req.end(raw);
});
const b64 = text => Buffer.from(text).toString('base64');
const model = {providerId: 'live', modelId: 'deepseek-v4.1-flash'};
const show = (label, events) => {
  for (const e of events.filter(e => e.type === 'tool-call')) console.log(`  ⚙ ${e.name} ${String(e.argumentsPreview ?? '').slice(0, 160)}${e.preamble ? ` — ${e.preamble.slice(0, 80)}` : ''}`);
  const done = events.find(e => e.type === 'completed' || e.type === 'expert-end');
  console.log(`[${label}]\n${String(done?.text ?? events.find(e => e.type === 'failed')?.message ?? '').slice(0, 1200)}\n`);
};
try {
  await call('POST', '/api/library/import', {name: 'study.md', projectId: null, base64: b64('# 预实验记录\n\n## 招募与分组\n\n跑步社招募 38 名志愿者做 6 周间歇性禁食；另找 40 名非社团学生做对照，未随机分组。\n\n## 测量\n\n24 项血液指标，采血时间未统一。空腹胰岛素 p=0.041，CRP p=0.048，未做多重比较校正。\n')});
  await call('POST', '/api/library/import', {name: 'model.tex', projectId: null, base64: b64('\\documentclass{article}\\title{Matsuda Index}\n\\begin{document}\n\\section{Definition}\nThe Matsuda insulin sensitivity index is\n\\begin{equation}\nISI = \\frac{10000}{\\sqrt{G_0 I_0 \\bar{G} \\bar{I}}}\n\\end{equation}\nwhere $G_0, I_0$ are fasting glucose and insulin and $\\bar G, \\bar I$ are OGTT means.\n\\end{document}\n')});
  console.log('sync', (await call('POST', '/api/research/sync', {projectId: null, wait: true})).events[0]);
  await call('POST', '/api/research/items', {item: {type: 'memory', subtype: 'decision', scope: 'personal', title: '主要终点', body: '以 Matsuda 指数为主要终点（2026-09-20 决定）', importance: 5}});
  const chat = (text, n) => call('POST', '/api/chat', {chatId: 'live-rb', projectId: null, model, text, userMessageId: `u${n}`, assistantMessageId: `a${n}`, executionMode: 'full'});
  let t = Date.now();
  show('Main 1', (await chat('根据资料库回答：这项研究是否随机分组？我们的主要终点是什么，它的公式是什么？请给出引用。', 1)).events);
  console.log('time', Math.round((Date.now() - t) / 1000) + 's');
  console.log('usage', JSON.stringify((await call('GET', '/api/research/usage?chatId=live-rb&messageId=a1')).events[0].refs.map(r => r.how)));
  t = Date.now();
  show('Main 2', (await chat('请把"今后所有采血统一在早上 8 点空腹进行"记为本项目的长期约定。', 2)).events);
  console.log('inbox', JSON.stringify((await call('GET', '/api/research/proposals')).events[0].proposals.map(p => ({op: p.op, item: p.payload.item, rationale: p.rationale, origin: p.origin.role}))));
  t = Date.now();
  const invited = await call('POST', '/api/discussion', {chatId: 'live-rb', projectId: null, model, kind: 'invited', text: '@统计审稿人 查一下资料库里的原始记录，多重比较校正后这两个 p 值还显著吗？请引用。', expertIds: ['statistician']});
  for (const e of invited.events.filter(e => e.type === 'tool-call')) console.log(`  ⚙ expert ${e.name} ${String(e.argumentsPreview ?? '').slice(0, 120)}`);
  console.log(`[expert]\n${String(invited.events.find(e => e.type === 'expert-end')?.text ?? '').slice(0, 1000)}\n`, 'time', Math.round((Date.now() - t) / 1000) + 's');
} finally { await api.close(); await new Promise(resolve => server.close(resolve)); await rm(root, {recursive: true, force: true}); }
