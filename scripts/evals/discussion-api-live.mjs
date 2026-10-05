// Opt-in paid end-to-end check of the application discussion API with real
// DSH and real models (2026-09-24 semantics): Main reads a file → ordered
// panel with a reviewer → adopt the review → @-invited expert → Main catch-up.
// Prints the stored transcript and tool preambles. Key: Git-ignored .sciencescope-local/secret/opencode.key.
import {createServer, request as httpRequest} from 'node:http';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';
import {createDesktopApi} from '../desktop-api.mjs';

const key = (await readFile('.sciencescope-local/secret/opencode.key', 'utf8')).trim();
const base = path.resolve('.sciencescope-local/temp/eval'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'discussion-api-'));
const models = ['deepseek-v4.1-flash', 'glm-5.3-flash', 'qwen3.8-flash', 'mimo-v2.6-flash'];
const runtimeConfig = {providers: {live: {api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'K', models: models.map(id => ({id, contextWindow: 131072, maxTokens: 16384}))}}};
const dsh = await createDshHost({home: path.join(root, '.sciencescope-local', 'dsh'), cwd: root, sessionHeaders: ['x-opencode-session'], env: {K: key}});
const host = Object.assign(Object.create(null), dsh, {getRuntimeConfig: async () => runtimeConfig, listProviders: async () => []});
console.log('DSH host ready');
const api = await createDesktopApi({dataRoot: root, runtimeHost: host, onError: error => console.log('API error:', error.message)});
const server = createServer((req, res) => api.handle(req, res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const call = (method, route, body) => new Promise((resolve, reject) => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = httpRequest({hostname: '127.0.0.1', port, path: route, method, headers: {host: `127.0.0.1:${port}`, ...(body === undefined ? {} : {'content-type': 'application/json', 'content-length': Buffer.byteLength(raw)})}}, res => {
    let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({status: res.statusCode, events: text.trim() ? text.trim().split('\n').map(line => JSON.parse(line)) : []}));
  }); req.on('error', reject); req.end(raw);
});
const model = {providerId: 'live', modelId: 'deepseek-v4.1-flash'};
try {
  const {events: [roster]} = await call('GET', '/api/experts');
  const pick = {methodologist: 'glm-5.3-flash', statistician: 'qwen3.8-flash', 'red-team': 'mimo-v2.6-flash'};
  const saved = await call('POST', '/api/experts', {experts: roster.experts.map(e => ({...e, model: {providerId: 'live', modelId: pick[e.id]}}))});
  if (saved.status !== 200) throw new Error('roster save failed');
  const study = path.join(root, '.sciencescope-local', 'projects', 'independent'); await mkdir(study, {recursive: true});
  await writeFile(path.join(study, 'study.md'), '# 预实验记录\n\n跑步社招募 38 名志愿者做 6 周间歇性禁食；另找 40 名非社团学生做对照（未随机）。\n24 项血液指标中空腹胰岛素 p=0.041、CRP p=0.048 改善，未做多重比较校正。采血时间未统一。\n');
  const time = () => Math.round((Date.now() - t) / 1000) + 's';
  let t = Date.now();
  const tick = setInterval(() => console.log('…', time()), 30000); tick.unref();
  const chat = (text, n) => call('POST', '/api/chat', {chatId: 'live-discussion', projectId: null, model, text, userMessageId: `u${n}`, assistantMessageId: `a${n}`, executionMode: 'full'});
  const main1 = await chat('先用工具读取当前目录下的 study.md，然后用三句话概括研究设计。', 1);
  const calls = main1.events.filter(e => e.type === 'tool-call');
  console.log('main 1', main1.status, time(), 'tools:', calls.map(c => c.name + (c.preamble ? ` [preamble: ${c.preamble.slice(0, 80)}]` : '')).join('; '));
  t = Date.now();
  const question = '能否据此得出"间歇性禁食改善年轻人代谢健康"的因果结论？请给出最关键的问题。';
  const first = await call('POST', '/api/discussion', {chatId: 'live-discussion', projectId: null, model, kind: 'ordered', text: question, expertIds: ['methodologist', 'red-team'], reviewerId: 'statistician'});
  console.log('ordered', first.status, time(), first.events.filter(e => !/delta|reset/.test(e.type)).map(e => e.type + (e.expertId ? ':' + e.expertId : '')).join(' '));
  const {events: [afterPanel]} = await call('GET', '/api/chats/live-discussion/messages');
  const review = afterPanel.messages.find(m => m.expert?.review);
  const adopt = await call('POST', '/api/discussion/adopt', {chatId: 'live-discussion', messageId: review.id, adopted: true});
  console.log('adopt', adopt.status, adopt.events[0]?.entry?.adopted);
  t = Date.now();
  const invited = await call('POST', '/api/discussion', {chatId: 'live-discussion', projectId: null, model, kind: 'invited', text: '@魔鬼代言人 你刚才说的替代解释，审核专家认可吗？一句话回答并说明你是谁。', expertIds: ['red-team']});
  console.log('invited', invited.status, time());
  t = Date.now();
  await chat('根据刚才各位专家和审核专家的意见，列出两条下一步修改。说明分别采纳了哪位专家的意见。', 2);
  console.log('main 2', time());
  const {events: [page]} = await call('GET', '/api/chats/live-discussion/messages');
  for (const m of page.messages) console.log(`\n[${m.role}${m.expert ? ' ' + m.expert.label + (m.expert.review ? ' (审核, adopted=' + m.expert.adopted + ', mainSeen=' + m.expert.mainSeen + ')' : '') + ' / ' + m.expert.model.modelId + ' / ' + m.expert.stopReason : ''}]${(m.toolActivity || []).map(c => `\n  ⚙ ${c.name}${c.preamble ? ' — ' + c.preamble.slice(0, 120) : ''}`).join('')}\n${m.text.slice(0, 900)}`);
} finally { await api.close(); await new Promise(resolve => server.close(resolve)); await rm(root, {recursive: true, force: true}); }
