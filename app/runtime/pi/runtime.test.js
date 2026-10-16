import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createModels } from '@earendil-works/pi-ai/models';
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { createPiRuntime } from './runtime.js';
import { tempDir } from '../../testing.js';

async function fixture(work, limits = {}) {
  const { dir, cleanup } = await tempDir('pi-runtime');
  const faux = fauxProvider({
    tokensPerSecond: 10000,
    tokenSize: { min: 1, max: 1 },
    models: [{ id: 'test', reasoning: true, contextWindow: 20000, maxTokens: 2000 }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const catalog = {
    resolve: async () => ({ model: faux.getModel(), entry: { name: 'Faux' }, models }),
  };
  const runtime = createPiRuntime({
    home: path.join(dir, 'runtime'),
    logs: path.join(dir, 'logs'),
    catalog,
    limits: { retryDelaysMs: [1, 1], ...limits },
  });
  const options = {
    model: { provider: faux.provider.id, model: 'test' },
    workFolder: dir,
    instructions: 'Test instructions',
    tools: [],
    onToolCall: async () => null,
  };
  try {
    await work({ runtime, faux, options, dir });
  } finally {
    await runtime.close();
    await cleanup();
  }
}

test('stream thinking and text, execute a host tool, then resume the complete transcript with new effort', async () => {
  await fixture(async ({ runtime, faux, options, dir }) => {
    let called = false;
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking('Think through the evidence'),
          fauxText('Checking the plan.'),
          fauxToolCall('read', { key: 'plans' }),
        ],
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('The plan is ready.'),
    ]);
    const resumeOptions = {
      ...options,
      tools: [
        {
          name: 'read',
          description: 'Read a resource',
          parameters: { key: { type: 'string', required: true } },
        },
      ],
      onToolCall: async ({ args, signal }) => {
        assert.equal(args.key, 'plans');
        assert.ok(signal);
        called = true;
        return { text: 'Evidence' };
      },
    };
    const id = await runtime.startSession(resumeOptions);
    const events = [];
    const result = await runtime.send(id, 'Read the plan', (event) => events.push(event));
    assert.equal(result.stopReason, 'completed');
    assert.equal(called, true);
    assert.ok(events.filter((event) => event.type === 'text-delta').length > 2);
    assert.equal(
      events
        .filter((event) => event.type === 'thinking-delta')
        .map((event) => event.delta)
        .join(''),
      'Think through the evidence',
    );
    assert.ok(events.some((event) => event.type === 'phase' && event.phase === 'tool'));
    assert.equal(result.usage.requests, 2);
    assert.equal(result.usage.context.contextWindow, 20000);
    assert.equal(result.usage.context.estimated, false);
    const saved = JSON.parse(
      await readFile(path.join(dir, 'runtime/pi/sessions', `${id}.json`), 'utf8'),
    );
    assert.ok(saved.messages.some((message) => message.role === 'toolResult'));
    assert.ok(
      saved.messages.some((message) => message.content?.some?.((part) => part.type === 'thinking')),
    );
    await runtime.release(id);
    faux.setResponses([
      async (context, request) => {
        assert.equal(request.reasoning, 'low');
        assert.ok(context.messages.some((message) => message.role === 'toolResult'));
        return fauxAssistantMessage('Resumed.');
      },
    ]);
    await runtime.startSession({
      ...resumeOptions,
      sessionId: id,
      model: { ...options.model, effort: 'low' },
    });
    assert.equal((await runtime.send(id, 'Continue', () => {})).stopReason, 'completed');
    await assert.rejects(runtime.startSession({ ...options, sessionId: 'missing-session' }));
  });
});

test('temporary failures are visible retries; an invalid key fails once', async () => {
  await fixture(async ({ runtime, faux, options, dir }) => {
    const failure = (message) =>
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: message });
    faux.setResponses([
      failure('HTTP 503 unavailable'),
      failure('HTTP 503 unavailable'),
      fauxAssistantMessage('Recovered'),
    ]);
    const id = await runtime.startSession(options);
    const events = [];
    const result = await runtime.send(id, 'Hello', (event) => events.push(event));
    assert.equal(result.stopReason, 'completed');
    assert.equal(result.usage.requests, 3);
    assert.deepEqual(
      events.filter((event) => event.type === 'retry').map((event) => event.attempt),
      [2, 3],
    );
    faux.setResponses([
      async () => {
        throw new Error('HTTP 401 invalid API key');
      },
    ]);
    const denied = await runtime.send(id, 'Hello', () => {});
    assert.equal(denied.stopReason, 'failed');
    assert.match(denied.error, /密钥无效.*HTTP 401/);
    assert.equal(denied.usage.requests, 1);
    assert.equal(denied.usage.unknownRequests, 1);
    const rows = (await readFile(path.join(dir, 'logs/model-requests.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(rows.length, 4);
    assert.equal(rows.at(-1).usage, null);
  });
});

test('a first-event timeout cancels its request and retries, and stop interrupts pending thinking', async () => {
  await fixture(
    async ({ runtime, faux, options }) => {
      const pending = async (_context, request) => {
        await delay(10000, undefined, { signal: request.signal });
        return fauxAssistantMessage('Too late');
      };
      faux.setResponses([pending, fauxAssistantMessage('Recovered')]);
      const id = await runtime.startSession(options);
      const events = [];
      const recovered = await runtime.send(id, 'Hello', (event) => events.push(event));
      assert.equal(recovered.stopReason, 'completed');
      assert.equal(events.filter((event) => event.type === 'retry').length, 1);
      faux.setResponses([pending]);
      const answer = runtime.send(id, 'Stop this', () => {});
      await delay(5);
      const stoppedAt = performance.now();
      await runtime.interrupt(id);
      assert.equal((await answer).stopReason, 'cancelled');
      assert.ok(performance.now() - stoppedAt < 2000);
    },
    { firstEventMs: 40 },
  );
});

test('stop forwards the abort signal to a running host tool and settles within two seconds', async () => {
  await fixture(async ({ runtime, faux, options }) => {
    faux.setResponses([fauxAssistantMessage(fauxToolCall('wait', {}), { stopReason: 'toolUse' })]);
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    let aborted = false;
    const id = await runtime.startSession({
      ...options,
      tools: [{ name: 'wait', description: 'Wait', parameters: {} }],
      onToolCall: async ({ signal }) => {
        started();
        try {
          await delay(10000, undefined, { signal });
        } finally {
          aborted = signal.aborted;
        }
      },
    });
    const answer = runtime.send(id, 'Wait', () => {});
    await ready;
    const stoppedAt = performance.now();
    await runtime.interrupt(id);
    assert.equal((await answer).stopReason, 'cancelled');
    assert.ok(aborted);
    assert.ok(performance.now() - stoppedAt < 2000);
  });
});

test('a no-tools summary explicitly requests no tool selection and registers no declarations', async () => {
  await fixture(async ({ runtime, faux, options }) => {
    faux.setResponses([
      async (context, request) => {
        assert.equal(request.toolChoice, 'none');
        assert.equal(JSON.stringify(context.messages).includes('forbidden_tool'), false);
        return fauxAssistantMessage('## Research goals\nPreserve the evidence.');
      },
    ]);
    const id = await runtime.startSession({
      ...options,
      noTools: true,
      tools: [{ name: 'forbidden_tool', description: 'Not available', parameters: {} }],
    });
    assert.equal((await runtime.send(id, 'Summarize', () => {})).stopReason, 'completed');
  });
});
