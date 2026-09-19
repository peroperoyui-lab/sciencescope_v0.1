/**
 * Opt-in, offline DSH stream smoke test.
 *
 * Starts a localhost OpenAI-compatible fixture, launches the real DSH SDK
 * adapter, and checks that the first stream chunk reaches onEvent before the
 * delayed second chunk. It also checks per-session isolation and the research
 * instruction patch against an ancestor sentinel. No credentials or network
 * access are used.
 */
import { createServer } from 'node:http';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createDshHost } from '../adapters/runtime-dsh/host.mjs';

const root = resolve('.sciencescope-local', 'temp', `dsh-stream-smoke-${Date.now()}`);
const workspace = join(root, 'projects', 'research');
const first = 'SCIENCESCOPE_FIRST_CHUNK';
const second = 'SCIENCESCOPE_SECOND_CHUNK';
const sessions = [];
let captured = [];
let fixtureSecondSentAt = Infinity;

function fixtureResponse(request, response) {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    response.writeHead(404).end();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    const requestBody = JSON.parse(body);
    captured.push(requestBody);
    response.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive', 'cache-control': 'no-cache' });
    const send = (text) => response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    send(first);
    setTimeout(() => { fixtureSecondSentAt = performance.now(); send(second); }, 250);
    setTimeout(() => { response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'); response.write('data: [DONE]\n\n'); response.end(); }, 300);
  });
}

async function runSession(host, sessionId, expectedPrompt) {
  const events = [];
  const started = performance.now();
  await host.send({ sessionId, text: expectedPrompt, onEvent: (event) => events.push({ ...event, at: performance.now() - started }) });
  const deltas = events.filter((event) => event.type === 'text-delta').map((event) => event.delta).join('');
  const streamed = events.filter((event) => event.type === 'text-delta' && event.committed === false).map((event) => event.delta).join('');
  const completed = events.findLast((event) => event.type === 'completed');
  if (streamed !== first + second) throw new Error('offline stream chunks were duplicated or lost');
  if (deltas !== first + second) throw new Error('text-delta events contain a duplicated final response');
  if (!completed || completed.text !== first + second) throw new Error('final response did not match fixture');
  const firstEvent = events.find((event) => event.type === 'text-delta' && event.committed === false);
  const secondEvent = events.find((event) => event.type === 'text-delta' && event.delta === second && event.committed === false);
  if (!firstEvent || !secondEvent || firstEvent.at >= secondEvent.at || (started + firstEvent.at) >= fixtureSecondSentAt) throw new Error('first chunk was not delivered before fixture emitted delayed second chunk');
  return events;
}

const server = createServer(fixtureResponse);
await mkdir(workspace, { recursive: true });
await writeFile(join(root, 'AGENTS.md'), 'REPO_AGENTS_SENTINEL');
await writeFile(join(workspace, 'AGENTS.md'), 'WORKSPACE_AGENTS_SENTINEL');
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const port = server.address().port;
const providerConfig = { providers: { fixture: { displayName: 'Offline Fixture', api: 'openai-completions', apiKeyEnv: 'SCIENCESCOPE_OFFLINE_KEY', baseURL: `http://127.0.0.1:${port}/v1`, models: [{ id: 'fixture-model', name: 'Fixture', contextWindow: 32768, maxTokens: 1024 }], headers: {} } } };
const host = await createDshHost({ home: root, cwd: workspace, env: { SCIENCESCOPE_OFFLINE_KEY: 'offline-fixture' }, sessionHeaders: ['x-sciencescope-smoke'] });
try {
  // `patches` is the supported launch overlay; the stream-runtime host may
  // additionally expose it as an explicit option when composing patches.
  const model = { providerId: 'fixture', modelId: 'fixture-model' };
  const firstSession = await host.startSession({ model, workspace, runtimeConfig: providerConfig });
  sessions.push(firstSession);
  const firstEvents = await runSession(host, firstSession, 'SESSION_ONE_PROMPT');
  const secondSession = await host.startSession({ model, workspace, runtimeConfig: providerConfig, noTools: true });
  sessions.push(secondSession);
  await runSession(host, secondSession, 'SESSION_TWO_PROMPT');
  if (captured.at(-1)?.tools?.length) throw new Error('no-tools secretary session exposed runtime tools');
  const prompt = captured.at(-1)?.messages?.map((message) => message.content).join('\n') ?? '';
  if (!prompt.includes('WORKSPACE_AGENTS_SENTINEL') || prompt.includes('REPO_AGENTS_SENTINEL')) throw new Error('instruction boundary leaked ancestor context or dropped workspace context');
  if (firstEvents.some((event) => event.sessionId && event.sessionId !== firstSession)) throw new Error('root/session event isolation failed');
  console.log(JSON.stringify({ sessions: sessions.length, fixtureRequests: captured.length, firstChunkBeforeSecond: true, noDuplicateFinal: true, instructionBoundary: true, passed: true }));
} finally {
  await host.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(root, { recursive: true, force: true });
}
