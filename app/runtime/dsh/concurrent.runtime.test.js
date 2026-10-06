// Real DSH processes share one fresh home while their frozen inputs, bridge
// events, tools and persisted working memories remain separate. The model is
// a local OpenAI streaming fixture; this test never contacts a paid provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runtimeProviderConfig } from '../../services/providers.js';
import { createDshRuntime } from './runtime.js';

const textOf = (content) =>
  typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('');
const streamedText = (events) =>
  events
    .filter((event) => event.type === 'text-delta')
    .map((event) => event.delta)
    .join('');

// Starting processes remain owned until every launch settles, including when
// one rejects. Promise.all's early rejection would let cleanup race a peer boot.
async function settleOperations(operations) {
  const results = await Promise.allSettled(operations);
  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Concurrent DSH operations failed',
    );
  return results.map((result) => /** @type {PromiseFulfilledResult<any>} */ (result).value);
}
async function startFixtureModel() {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const transcript = input.messages.map((message) => textOf(message.content)).join('\n');
    const identity = transcript.includes('IDENTITY_ALPHA') ? 'ALPHA' : 'BETA';
    requests.push({ identity, input, transcript });
    const lastUser = input.messages.findLast((message) => message.role === 'user');
    const isFollowup = textOf(lastUser.content).includes('FOLLOWUP');
    const hasToolResult = input.messages.at(-1).role === 'tool';
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const write = (delta, finish = null) =>
      response.write(
        `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`,
      );
    if (isFollowup) {
      write({ content: `RESUMED_${identity} remembers FROZEN_USER and REFERENCE_${identity}` });
      write({}, 'stop');
    } else if (hasToolResult) {
      write({ content: `ANSWER_${identity} ${textOf(input.messages.at(-1).content)}` });
      write({}, 'stop');
    } else {
      write({ content: `PREAMBLE_${identity}` });
      write({
        tool_calls: [
          {
            index: 0,
            id: 'same_call_id',
            type: 'function',
            function: { name: 'research_read', arguments: JSON.stringify({ identity }) },
          },
        ],
      });
      write({}, 'tool_calls');
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  return {
    server,
    requests,
    port: /** @type {import('node:net').AddressInfo} */ (server.address()).port,
  };
}

test(
  'two experts run concurrently from one cutoff and resume their own DSH sessions',
  { timeout: 120_000 },
  async () => {
    const repository = fileURLToPath(new URL('../../../', import.meta.url));
    const parent = path.join(repository, '.sciencescope-local', 'temp', 'r4-3a');
    await mkdir(parent, { recursive: true });
    const folder = await mkdtemp(path.join(parent, 'dsh-concurrent-'));
    const fixture = await startFixtureModel();
    const configuration = {
      home: path.join(folder, 'shared-runtime'),
      credentialsPath: path.join(folder, 'secret', 'credentials.yaml'),
      providerConfig: async () =>
        runtimeProviderConfig([
          {
            id: 'fixture',
            baseUrl: `http://127.0.0.1:${fixture.port}/v1`,
            api: 'openai-completions',
            keyRef: 'SCIENCESCOPE_FIXTURE_KEY',
            models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 512 }],
          },
        ]),
      extraEnv: { SCIENCESCOPE_FIXTURE_KEY: 'fixture' },
    };
    let runtime = createDshRuntime(configuration);
    const identities = ['ALPHA', 'BETA'];
    const calls = [];
    let unlock = () => {};
    const bothCalled = new Promise((resolve) => {
      unlock = () => resolve(undefined);
    });
    const optionsFor = (identity, waitForPeers) => ({
      model: { provider: 'fixture', model: 'fixture' },
      workFolder: folder,
      instructions: `You are a research expert. IDENTITY_${identity}`,
      tools: [
        {
          name: 'research_read',
          description: 'Read a cited passage.',
          parameters: { identity: { type: 'string', required: true } },
        },
      ],
      onToolCall: async ({ name, args, callId }) => {
        assert.equal(name, 'research_read');
        assert.equal(args.identity, identity);
        calls.push({ identity, callId });
        if (calls.length === 2) unlock();
        if (waitForPeers) {
          let timer;
          try {
            await Promise.race([
              bothCalled,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Expert tools did not overlap')), 15_000);
              }),
            ]);
          } finally {
            clearTimeout(timer);
          }
        }
        return { citation: `REFERENCE_${identity}`, text: `PASSAGE_${identity}` };
      },
    });
    try {
      // Parallel cold starts also exercise shared sdk profile initialization.
      const sessions = await settleOperations(
        identities.map((identity) => runtime.startSession(optionsFor(identity, true))),
      );
      assert.notEqual(sessions[0], sessions[1]);
      const events = identities.map(() => []);
      const results = await settleOperations(
        sessions.map((session, index) =>
          runtime.send(session, 'FROZEN_USER: compare the shared research question.', (event) =>
            events[index].push(event),
          ),
        ),
      );
      assert.deepEqual(
        results.map((result) => result.stopReason),
        ['completed', 'completed'],
      );
      assert.equal(calls.length, 2);
      assert.equal(
        calls[0].callId,
        calls[1].callId,
        'the fixture deliberately reuses a model tool id across sessions',
      );
      for (const [index, identity] of identities.entries()) {
        const other = identities[1 - index];
        assert.match(
          streamedText(events[index]),
          new RegExp(`ANSWER_${identity}.*REFERENCE_${identity}`),
        );
        assert.doesNotMatch(
          streamedText(events[index]),
          new RegExp(`ANSWER_${other}|REFERENCE_${other}`),
        );
        assert.deepEqual(
          events[index].filter((event) => event.type === 'tool-call').map((event) => event.name),
          ['research_read'],
        );
        assert.equal(events[index].filter((event) => event.type === 'tool-result').length, 1);
        assert.ok(results[index].usage.context.usedTokens > 0);
      }
      const initial = fixture.requests.filter(({ input }) => input.messages.at(-1).role !== 'tool');
      assert.equal(initial.length, 2);
      const latestUsers = initial.map(({ input }) =>
        textOf(input.messages.findLast((message) => message.role === 'user').content),
      );
      assert.equal(
        latestUsers[0],
        latestUsers[1],
        'each expert receives exactly the same frozen cutoff',
      );
      await runtime.close();
      runtime = createDshRuntime(configuration);
      const resumed = await settleOperations(
        sessions.map((sessionId, index) =>
          runtime.startSession({ ...optionsFor(identities[index], false), sessionId }),
        ),
      );
      const followups = identities.map(() => []);
      const later = await settleOperations(
        resumed.map((session, index) =>
          runtime.send(session, 'FOLLOWUP: remember the previous research round.', (event) =>
            followups[index].push(event),
          ),
        ),
      );
      assert.deepEqual(
        later.map((result) => result.stopReason),
        ['completed', 'completed'],
      );
      for (const [index, identity] of identities.entries()) {
        const request = fixture.requests.findLast((entry) => entry.identity === identity);
        assert.match(request.transcript, new RegExp(`FROZEN_USER[\\s\\S]*REFERENCE_${identity}`));
        assert.doesNotMatch(
          request.transcript,
          new RegExp(`IDENTITY_${identities[1 - index]}|REFERENCE_${identities[1 - index]}`),
        );
        assert.match(streamedText(followups[index]), new RegExp(`RESUMED_${identity}`));
      }
      assert.equal(fixture.requests.length, 6, 'two tool loops and two resumed model requests');
    } finally {
      await runtime.close();
      fixture.server.closeAllConnections();
      await new Promise((resolve) => fixture.server.close(() => resolve(undefined)));
      await rm(folder, { recursive: true, force: true });
    }
  },
);

test(
  'closing the runtime drains queued starts even when one launch fails',
  { timeout: 120_000 },
  async () => {
    const repository = fileURLToPath(new URL('../../../', import.meta.url));
    const parent = path.join(repository, '.sciencescope-local', 'temp', 'r4-3a');
    await mkdir(parent, { recursive: true });
    const folder = await mkdtemp(path.join(parent, 'dsh-start-close-'));
    let launches = 0;
    const runtime = createDshRuntime({
      home: path.join(folder, 'runtime'),
      credentialsPath: path.join(folder, 'secret', 'credentials.yaml'),
      providerConfig: async () => {
        if (++launches === 1) throw new Error('Fixture provider configuration failed');
        return runtimeProviderConfig([
          {
            id: 'fixture',
            api: 'openai-completions',
            baseUrl: 'http://127.0.0.1:1/v1',
            keyRef: 'SCIENCESCOPE_FIXTURE_KEY',
            models: [{ id: 'fixture', contextWindow: 32768, maxTokens: 512 }],
          },
        ]);
      },
      extraEnv: { SCIENCESCOPE_FIXTURE_KEY: 'fixture' },
    });
    const options = {
      model: { provider: 'fixture', model: 'fixture' },
      workFolder: folder,
      instructions: 'Local lifecycle fixture',
      tools: [],
      onToolCall: async () => null,
    };
    const pending = Promise.allSettled([
      runtime.startSession(options),
      runtime.startSession(options),
    ]);
    try {
      await runtime.close();
      const outcomes = await pending;
      assert.equal(outcomes[0].status, 'rejected');
      assert.match(
        /** @type {PromiseRejectedResult} */ (outcomes[0]).reason.message,
        /Fixture provider configuration failed/,
      );
      assert.equal(
        outcomes[1].status,
        'fulfilled',
        'a failed startup does not poison the queued peer',
      );
      const sessionId = /** @type {PromiseFulfilledResult<string>} */ (outcomes[1]).value;
      await assert.rejects(
        runtime.send(sessionId, 'must already be released', () => {}),
        /not running/,
      );
      await assert.rejects(runtime.startSession(options), /closed/);
    } finally {
      await runtime.close();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
