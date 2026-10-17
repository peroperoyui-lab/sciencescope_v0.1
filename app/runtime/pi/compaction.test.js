import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createModels } from '@earendil-works/pi-ai/models';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { createPiRuntime } from './runtime.js';
import { sessionStore } from './sessions.js';
import { withCore } from '../../testing.js';
import { createTurnActivity } from '../../services/turn-activity.js';
import { createModelCatalog } from './catalog.js';
import { controlledStream } from './requests.js';
import { saveKey } from '../../services/providers.js';

async function fixture(core, work) {
  const faux = fauxProvider({
    tokensPerSecond: 100000,
    tokenSize: { min: 20, max: 20 },
    models: [{ id: 'test', contextWindow: 10000, maxTokens: 2000 }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const settings = async () =>
    (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
  const runtime = createPiRuntime({
    home: core.paths.runtime,
    logs: core.paths.logs,
    catalog: { resolve: async () => ({ model: faux.getModel(), entry: {}, models }) },
    compactPercent: async () => (await settings()).context.compactPercent,
  });
  const options = {
    model: { provider: faux.provider.id, model: 'test' },
    instructions: 'Keep evidence identifiers',
    tools: [],
    workFolder: core.paths.root,
    onToolCall: async () => null,
  };
  try {
    await work({ faux, runtime, options, store: sessionStore(core.paths.runtime) });
  } finally {
    await runtime.close();
  }
}

test('compaction runs after a tool result, keeps two complete exchanges, records activity and survives resume', () =>
  withCore('pi-compaction', (core) =>
    fixture(core, async ({ faux, runtime, options, store }) => {
      assert.equal(
        (await core.workspace.read({ resource: 'settings', key: 'app' })).value.context
          .compactPercent,
        80,
      );
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { context: { compactPercent: 50 } } },
      });
      await assert.rejects(
        core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { context: { compactPercent: 49 } } },
        }),
        { code: 'INVALID_COMPACTION_PERCENT' },
      );
      const old = 'OLD_EVIDENCE_' + 'x'.repeat(10000),
        toolText = 'CURRENT_EVIDENCE_' + 'y'.repeat(12000);
      /** @type {any} */
      let before;
      /** @type {any} */
      let summaryRequest;
      /** @type {any} */
      let answerRequest;
      faux.setResponses([
        fauxAssistantMessage('Earlier decision recorded.'),
        fauxAssistantMessage('Recent instruction retained.'),
        fauxAssistantMessage([fauxToolCall('read', {})], { stopReason: 'toolUse' }),
        async (context, request) => {
          before = await store.read(id);
          summaryRequest = { context, request };
          return fauxAssistantMessage('Earlier evidence: OLD_EVIDENCE. Decision recorded.');
        },
        async (context) => {
          answerRequest = context;
          return fauxAssistantMessage('Coherent continuation using CURRENT_EVIDENCE.');
        },
      ]);
      const sessionOptions = {
        ...options,
        tools: [{ name: 'read', description: 'Read evidence', parameters: {} }],
        onToolCall: async () => ({ text: toolText }),
      };
      const id = await runtime.startSession(sessionOptions);
      await runtime.send(id, old, () => {});
      await runtime.send(id, 'recent-second', () => {});
      const meeting = core.meetings.create({});
      const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
      const activity = createTurnActivity(core, turn.id),
        events = [];
      const result = await runtime.send(id, 'current-third', (event) => {
        events.push(event);
        activity.onEvent(event);
      });
      activity.finish();
      assert.equal(result.stopReason, 'completed', result.error);
      assert.equal(result.usage.requests, 3);
      assert.ok(summaryRequest);
      assert.ok(answerRequest);
      assert.ok(before);
      assert.equal(summaryRequest.request.toolChoice, 'none');
      assert.equal(summaryRequest.request.sessionId, id);
      assert.ok(JSON.stringify(summaryRequest.context.messages).includes(old));
      assert.ok(!JSON.stringify(summaryRequest.context.messages).includes(toolText));
      assert.ok(JSON.stringify(answerRequest.messages).includes(toolText));
      assert.ok(!JSON.stringify(answerRequest.messages).includes(old));
      const card = core.turns.toolCalls(turn.id).find((row) => row.kind === 'compaction');
      assert.ok(card.result.beforeTokens > card.result.afterTokens);
      assert.deepEqual(Object.keys(card.result).sort(), ['afterTokens', 'beforeTokens']);
      const saved = await store.read(id);
      const recentIndex = before.findIndex(
        (message) => message.role === 'user' && JSON.stringify(message).includes('recent-second'),
      );
      assert.deepEqual(
        saved.slice(saved.findIndex((message) => message.sciencescopeCompaction) + 1, -1),
        before.slice(recentIndex),
      );
      assert.ok(saved.some((message) => message.sciencescopeCompaction));
      assert.ok(events.some((event) => event.type === 'phase' && event.phase === 'compacting'));
      await runtime.release(id);
      /** @type {any} */
      let resumedContext;
      faux.setResponses([
        async (context) => {
          resumedContext = context;
          return fauxAssistantMessage('Resumed from summary.');
        },
      ]);
      await runtime.startSession({ ...sessionOptions, sessionId: id });
      assert.equal((await runtime.send(id, 'Continue', () => {})).stopReason, 'completed');
      assert.ok(resumedContext);
      assert.ok(JSON.stringify(resumedContext.messages).includes('Earlier evidence: OLD_EVIDENCE'));
      assert.ok(!JSON.stringify(resumedContext.messages).includes(old));
    }),
  ));

test('a failed summary is one logged request and the answer continues with unchanged history', () =>
  withCore('pi-compaction-failure', (core) =>
    fixture(core, async ({ faux, runtime, options, store }) => {
      const old = 'old'.repeat(12000),
        id = 'compaction-failure';
      const seed = [
        { role: 'user', content: old, timestamp: 1 },
        fauxAssistantMessage('Old decision'),
        { role: 'user', content: 'recent', timestamp: 2 },
        fauxAssistantMessage('Recent decision'),
      ];
      await store.write(id, seed);
      faux.setResponses([
        fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'HTTP 503 unavailable' }),
        async (context) => {
          assert.ok(JSON.stringify(context.messages).includes(old));
          return fauxAssistantMessage('Continued without losing the original.');
        },
      ]);
      await runtime.startSession({ ...options, sessionId: id });
      const events = [],
        result = await runtime.send(id, 'current', (event) => events.push(event));
      assert.equal(result.stopReason, 'completed');
      assert.equal(result.usage.requests, 2);
      assert.ok(!events.some((event) => event.type === 'compaction'));
      assert.ok(!(await store.read(id)).some((message) => message.sciencescopeCompaction));
      const rows = (await readFile(path.join(core.paths.logs, 'model-requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.equal(rows[0].purpose, 'compaction');
      assert.equal(rows[0].stopReason, 'failed');
      assert.equal(rows[1].purpose, 'answer');
    }),
  ));

test('stopping during compaction aborts the summary and preserves the original context within two seconds', () =>
  withCore('pi-compaction-stop', (core) =>
    fixture(core, async ({ faux, runtime, options, store }) => {
      const id = 'compaction-stop';
      await store.write(id, [
        { role: 'user', content: 'old evidence '.repeat(4000), timestamp: 1 },
        fauxAssistantMessage('Old response'),
        { role: 'user', content: 'recent', timestamp: 2 },
        fauxAssistantMessage('Recent response'),
      ]);
      let started;
      const ready = new Promise((resolve) => {
        started = resolve;
      });
      let aborted = false;
      faux.setResponses([
        async (_context, request) => {
          started();
          try {
            await delay(10000, undefined, { signal: request.signal });
          } finally {
            aborted = request.signal.aborted;
          }
          return fauxAssistantMessage('Too late');
        },
      ]);
      await runtime.startSession({ ...options, sessionId: id });
      const answer = runtime.send(id, 'current', () => {});
      await ready;
      const time = performance.now();
      await runtime.interrupt(id);
      assert.equal((await answer).stopReason, 'cancelled');
      assert.ok(performance.now() - time < 2000);
      assert.ok(aborted);
      assert.ok(!(await store.read(id)).some((message) => message.sciencescopeCompaction));
    }),
  ));

test('auxiliary requests retain the SDK OpenCode session header without an Agent invocation', () =>
  withCore('pi-summary-routing', async (core) => {
    await saveKey(core.paths, 'opencode-go', 'local-fixture');
    const catalog = createModelCatalog({ paths: core.paths, providers: async () => [entry] });
    const entry = catalog.preset('opencode-go');
    const choice = { provider: 'opencode-go', model: 'deepseek-v4.1-flash' };
    const selection = await catalog.resolve(choice);
    const observed = [];
    const stream = controlledStream({
      selection,
      choice,
      sessionId: 'summary-session',
      onEvent: () => {},
      log: async () => {},
      requests: [],
      noTools: true,
      fetch: async (_input, init) => {
        observed.push(new Headers(init.headers).get('x-opencode-session'));
        const chunk = {
          id: 'fixture',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Summary' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    const result = await stream(selection.model, {
      messages: [{ role: 'user', content: 'Summarize', timestamp: 0 }],
    }).result();
    assert.equal(result.stopReason, 'stop');
    assert.deepEqual(observed, ['summary-session']);
  }));
