// Opt-in paid end-to-end check of the application discussion API with real
// DSH and real models: roster save → independent round → critique → stored
// transcript with real authors. Key: Git-ignored .sciencescope-local/secret/opencode.key.
import {createServer, request as httpRequest} from 'node:http';
import {mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
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
  const question = '我们在一所大学的跑步社招募了38名志愿者做6周间歇性禁食，另找40名非社团学生做对照。24项血液指标里空腹胰岛素 p=0.041、CRP p=0.048 有改善。能否得出"间歇性禁食改善年轻人代谢健康"的因果结论？请各自给出最关键的问题。';
  console.log('roster saved');
  let t = Date.now();
  const tick = setInterval(() => console.log('…', Math.round((Date.now() - t) / 1000) + 's'), 30000); tick.unref();
  const first = await call('POST', '/api/discussion', {chatId: 'live-discussion', projectId: null, model, text: question, expertIds: roster.experts.map(e => e.id)});
  console.log('round 1', first.status, Math.round((Date.now() - t) / 1000) + 's', first.events.map(e => e.type + (e.expertId ? ':' + e.expertId : '')).join(' '));
  t = Date.now();
  const second = await call('POST', '/api/discussion', {chatId: 'live-discussion', projectId: null, model, kind: 'critique', text: '', expertIds: roster.experts.map(e => e.id)});
  console.log('round 2', second.status, Math.round((Date.now() - t) / 1000) + 's', second.events.map(e => e.type + (e.expertId ? ':' + e.expertId : '')).join(' '));
  const {events: [page]} = await call('GET', '/api/chats/live-discussion/messages');
  for (const m of page.messages) console.log(`\n[${m.role}${m.expert ? ' ' + m.expert.label + ' / ' + m.expert.model.modelId + ' / ' + m.expert.stopReason : ''}]\n${m.text.slice(0, 700)}`);
} finally { await api.close(); await new Promise(resolve => server.close(resolve)); await rm(root, {recursive: true, force: true}); }
