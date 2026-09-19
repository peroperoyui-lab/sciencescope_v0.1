/** Offline proof that a caller-supplied DSH session id resumes persisted history. */
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

const root = resolve('.sciencescope-local', 'temp', `dsh-reopen-${Date.now()}`);
const workspace = join(root, 'workspace');
const sessionId = 'session-reopenfixture';
const requests = [];
const server = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let body = ''; request.setEncoding('utf8'); request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const input = JSON.parse(body); requests.push(input);
    const history = input.messages?.map((message) => message.content).join('\n') ?? '';
    const text = history.includes('FIRST_TURN') ? 'REOPENED_HISTORY' : 'FIRST_TURN_ACK';
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    response.end('data: [DONE]\n\n');
  });
});

await mkdir(workspace, { recursive: true });
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;
const runtimeConfig = { providers: { fixture: { displayName: 'Offline Fixture', api: 'openai-completions', apiKeyEnv: 'SCIENCESCOPE_REOPEN_KEY', baseURL: `http://127.0.0.1:${port}/v1`, models: [{ id: 'fixture-model', name: 'Fixture', contextWindow: 32768, maxTokens: 1024 }], headers: {} } } };
const model = { providerId: 'fixture', modelId: 'fixture-model' };
const events = [];

try {
  const firstHost = await createDshHost({ home: root, cwd: workspace, env: { SCIENCESCOPE_REOPEN_KEY: 'offline' }, sessionHeaders: ['x-sciencescope-reopen'] });
  try {
    const id = await firstHost.startSession({ model, workspace, runtimeConfig, sessionId });
    await firstHost.send({ sessionId: id, text: 'FIRST_TURN', onEvent: (event) => events.push(event) });
  } finally { await firstHost.close(); }

  const secondHost = await createDshHost({ home: root, cwd: workspace, env: { SCIENCESCOPE_REOPEN_KEY: 'offline' }, sessionHeaders: ['x-sciencescope-reopen'] });
  try {
    const id = await secondHost.startSession({ model, workspace, runtimeConfig, sessionId });
    const result = await secondHost.send({ sessionId: id, text: 'SECOND_TURN', onEvent: (event) => events.push(event) });
    if (result.finalResponse !== 'REOPENED_HISTORY') throw new Error(`reopen response mismatch: ${result.finalResponse}`);
  } finally { await secondHost.close(); }
  if (requests.length !== 2 || !requests[1].messages.some((message) => String(message.content).includes('FIRST_TURN'))) throw new Error('second lifecycle did not receive persisted DSH history');
  console.log(JSON.stringify({ sessionId, lifecycleCount: 2, fixtureRequests: requests.length, persistedHistory: true, passed: true }));
} finally {
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(root, { recursive: true, force: true });
}
