import { createServer, request } from 'node:http';
import assert from 'node:assert/strict';
import { apply } from '../adapters/runtime-dsh/session-control.mjs';

const events = [];
let control;
const sink = createServer((req, res) => {
  let body = ''; req.setEncoding('utf8'); req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => { const message = JSON.parse(body); if (message.type === 'control-ready') control = message.controlEndpoint; if (message.type === 'control-event') events.push(message.event); res.writeHead(204); res.end(); });
});
await new Promise((resolve) => sink.listen(0, '127.0.0.1', resolve));
const address = sink.address();
const state = { goal: undefined };
const listeners = new Map();
let cleanup;
const ctx = {
  agents: { async resume() { throw new Error('not found'); }, async create() { return { agent: { session: { id: 'session-smoke' }, followup() {}, async whenIdle() {} }, async dispose() {} }; } },
  goals: {
    create(_agent, request) { state.goal = { id: 'goal-smoke', revision: 1, objective: request.objective, phase: 'active', maxGoalRounds: request.maxGoalRounds ?? 256, roundsStarted: 0, activation: 'armed' }; return state.goal; },
    get() { return state.goal; },
    pause(_agent, ref) { assert.equal(ref.id, state.goal.id); state.goal = { ...state.goal, revision: state.goal.revision + 1, phase: 'paused', activation: 'disarmed' }; return state.goal; },
    resume(_agent, ref) { assert.equal(ref.revision, state.goal.revision); state.goal = { ...state.goal, revision: state.goal.revision + 1, phase: 'active', activation: 'armed' }; return state.goal; },
  },
  approval: { setPolicy(_agent, policy) { state.approvalPolicy = policy; } },
  on(name, listener) { listeners.set(name, listener); },
  effect(factory) { cleanup = factory(); },
};
process.env.SCIENCESCOPE_STREAM_ENDPOINT = `http://127.0.0.1:${address.port}/events`;
process.env.SCIENCESCOPE_STREAM_TOKEN = 'smoke-token';
process.env.SCIENCESCOPE_STREAM_SESSION = 'session-smoke';
process.env.SCIENCESCOPE_PROVIDER = 'fixture'; process.env.SCIENCESCOPE_MODEL = 'fixture';
apply(ctx);
while (!control) await new Promise((resolve) => setTimeout(resolve, 5));
async function call(path, payload) {
  const body = JSON.stringify({ token: 'smoke-token', sessionId: 'session-smoke', ...payload });
  return new Promise((resolve, reject) => { const target = new URL(control); const req = request({ hostname: target.hostname, port: target.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { let text = ''; res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve(text ? JSON.parse(text).result : undefined)); }); req.on('error', reject); req.end(body); });
}
const created = await call('/goal', { action: 'create', objective: 'fixture goal', maxGoalRounds: 3 });
assert.equal((await call('/goal', { action: 'get' })).objective, 'fixture goal');
const paused = await call('/goal', { action: 'pause', ref: { id: created.id, revision: created.revision } });
assert.equal(paused.phase, 'paused');
const resumed = await call('/goal', { action: 'resume', ref: { id: paused.id, revision: paused.revision } });
assert.equal(resumed.phase, 'active');
await call('/policy', { approvalPolicy: 'ask', sandboxMode: 'read-only' });
assert.equal(state.approvalPolicy, 'ask');
console.log(JSON.stringify({ ok: true, goal: resumed, events: events.length }));
await cleanup?.();
await new Promise((resolve) => sink.close(resolve));
