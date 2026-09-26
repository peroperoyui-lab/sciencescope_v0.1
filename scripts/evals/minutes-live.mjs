// Opt-in paid check with real DSH and real cheap models (2026-09-26): the
// secretary writes the conversation minutes after Main turns; an expert then
// answers from the project history (minutes + recall tools). Prints the
// minutes, the expert answers and the tools each expert called.
// Key: Git-ignored .sciencescope-local/secret/opencode.key.
import {createServer, request as httpRequest} from 'node:http';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';
import {createDesktopApi} from '../desktop-api.mjs';

const key = (await readFile('.sciencescope-local/secret/opencode.key', 'utf8')).trim();
const base = path.resolve('.sciencescope-local/temp/eval'); await mkdir(base, {recursive: true});
const root = await mkdtemp(path.join(base, 'minutes-live-'));
const models = ['deepseek-v4.1-flash', 'glm-5.3-flash', 'qwen3.8-flash'];
const runtimeConfig = {providers: {live: {api: 'openai-completions', baseURL: 'https://opencode.ai/zen/go/v1', apiKeyEnv: 'K', models: models.map(id => ({id, contextWindow: 131072, maxTokens: 16384}))}}};
const dsh = await createDshHost({home: path.join(root, '.sciencescope-local', 'dsh'), cwd: root, sessionHeaders: ['x-opencode-session'], env: {K: key}});
const host = Object.assign(Object.create(null), dsh, {getRuntimeConfig: async () => runtimeConfig, listProviders: async () => []});
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
const chatId = 'live-minutes';
try {
  const {events: [roster]} = await call('GET', '/api/experts');
  await call('POST', '/api/experts', {experts: roster.experts.map(e => ({...e, model: {providerId: 'live', modelId: e.id === 'methodologist' ? 'glm-5.3-flash' : 'qwen3.8-flash'}}))});
  const turns = [
    '我们定下两条：主要终点用 Matsuda 胰岛素敏感性指数；排除 BMI 大于 30 的受试者。请简短确认。',
    '另外，对照组改为随机分配的等待名单对照，不再用非社团学生。请简短确认。',
    '样本量先按每组 40 人计划，之后再做功效分析。请简短确认。',
  ];
  for (const [index, text] of turns.entries()) {
    const reply = await call('POST', '/api/chat', {chatId, projectId: null, model, text, userMessageId: `u${index + 1}`, assistantMessageId: `a${index + 1}`});
    console.log(`main ${index + 1}:`, reply.status, (reply.events.find(e => e.type === 'completed')?.text || '').slice(0, 160).replace(/\s+/g, ' '));
  }
  let minutes = null;
  for (let i = 0; i < 90; i++) { const {events: [value]} = await call('GET', `/api/chats/minutes?chatId=${chatId}`); minutes = value; if (value.minutes?.throughOrdinal >= 6 && !value.updating) break; await new Promise(r => setTimeout(r, 2000)); }
  console.log(`\n=== minutes (revision ${minutes.minutes?.revision}, covers #1–#${minutes.minutes?.throughOrdinal}) ===\n${minutes.minutes?.text}\n`);

  const ask = async (text, expertId) => {
    const {events} = await call('POST', '/api/discussion', {chatId, projectId: null, model, kind: 'ordered', text, expertIds: [expertId]});
    const tools = events.filter(e => e.type === 'tool-call').map(e => `${e.name}${e.argumentsPreview ? ' ' + String(e.argumentsPreview).slice(0, 80) : ''}`);
    const answer = events.filter(e => e.type === 'expert-end').map(e => e.text).join('\n');
    return {tools, answer};
  };
  const one = await ask('在当前方案下，哪些受试者会被排除？主要终点和对照组分别是什么？', 'methodologist');
  console.log('=== methodologist (history question) ===\ntools:', one.tools.join(' | ') || '(none)', '\n', one.answer.slice(0, 900));
  const two = await ask('请用工具逐字引用第 1 条消息的原文，然后指出它和现在方案的关系。', 'statistician');
  console.log('\n=== statistician (explicit recall) ===\ntools:', two.tools.join(' | ') || '(none)', '\n', two.answer.slice(0, 900));
  const ok = /BMI|30/.test(one.answer) && /Matsuda/i.test(one.answer) && /等待名单|随机/.test(one.answer) && two.tools.some(t => t.startsWith('chat_recall')) && two.answer.includes('Matsuda');
  console.log('\nRESULT', ok ? 'PASS' : 'CHECK MANUALLY');
} finally { await api.close(); server.close(); await dsh.close?.(); }
