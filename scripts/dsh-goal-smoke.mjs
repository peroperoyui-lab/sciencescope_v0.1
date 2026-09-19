/** Real DSH 0.1.6-alpha.1 goal/round-driver localhost fixture. */
import { createServer } from 'node:http';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

const root = resolve('.sciencescope-local', 'temp', `dsh-goal-smoke-${Date.now()}`);
const workspace = join(root, 'workspace');
let requestCount = 0;
const fixture = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return; }
  let body = ''; req.setEncoding('utf8'); req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    requestCount += 1;
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' });
    const text = `ROUND_${requestCount}`;
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'); res.end('data: [DONE]\n\n');
  });
});
await mkdir(workspace, { recursive: true });
await new Promise((resolveListen) => fixture.listen(0, '127.0.0.1', resolveListen));
const port = fixture.address().port;
const runtimeConfig = { providers: { fixture: { displayName: 'Goal Fixture', api: 'openai-completions', apiKeyEnv: 'SCIENCESCOPE_GOAL_KEY', baseURL: `http://127.0.0.1:${port}/v1`, models: [{ id: 'fixture-model', name: 'Fixture', contextWindow: 32768, maxTokens: 1024 }], headers: {} } } };
const host = await createDshHost({ home: root, cwd: workspace, env: { SCIENCESCOPE_GOAL_KEY: 'fixture' }, sessionHeaders: ['x-sciencescope-goal-smoke'] });
try {
  const sessionId = await host.startSession({ model: { providerId: 'fixture', modelId: 'fixture-model' }, workspace, runtimeConfig });
  const observed = [];
  const stopObserving = host.observeSession(sessionId, (event) => observed.push(event));
  const initial = await host.sessionGoal({ sessionId, objective: 'Iterate until the fixture has produced two rounds.', maxGoalRounds: 2 });
  const paused = await host.pause({ sessionId, ref: { id: initial.id, revision: initial.revision } });
  const resumed = await host.resume({ sessionId, ref: { id: paused.id, revision: paused.revision } });
  if (resumed.phase !== 'active' || resumed.activation !== 'armed') throw new Error('goal did not resume through native GoalService');
  const deadline = Date.now() + 15000;
  while (requestCount < 2 && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  const finalGoal = await host.getGoal(sessionId);
  if (requestCount < 2) throw new Error(`goal round driver made ${requestCount} fixture requests`);
  if (finalGoal.roundsStarted < 2) throw new Error(`goal projection only admitted ${finalGoal.roundsStarted} rounds`);
  if (!['blocked', 'complete'].includes(finalGoal.phase)) throw new Error(`unexpected round-limit phase: ${finalGoal.phase}`);
  if (!observed.some((event) => event.type === 'committed-event' || event.event?.type === 'session-event')) throw new Error('no committed session event reached observeSession');
  stopObserving();
  console.log(JSON.stringify({ passed: true, requests: requestCount, phase: finalGoal.phase, roundsStarted: finalGoal.roundsStarted, observed: observed.length }));
} finally {
  await host.close(); fixture.close(); await rm(root, { recursive: true, force: true });
}
