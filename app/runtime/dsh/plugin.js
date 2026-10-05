// @ts-nocheck -- DSH types its plugin APIs for TypeScript plugins (generic tool
// definitions); this file is verified by runtime.runtime.test.js instead.
//
// ScienceScope's plugin inside a DSH session process. It:
// - resumes (or creates) the session's agent with our instructions and tools;
// - posts runtime events to the bridge, in order;
// - forwards tool calls to the bridge and returns the answers;
// - serves /prompt, /interrupt and /instructions on a localhost control port.
// Configuration comes from environment variables set by runtime.js.
import { createServer, request } from 'node:http';
import { readFileSync } from 'node:fs';
import { createUserMessage, isTokenDelta } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt';

export const name = 'sciencescope-bridge';
export const inject = ['agents', 'approval'];

const STOP_REASONS = { completed: 'completed', 'max-tokens': 'max_tokens', aborted: 'cancelled' };

/** POST JSON to the bridge and return its JSON answer. */
function post(url, body, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const target = new URL(url);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    signal?.addEventListener('abort', () => req.destroy(new Error('tool call aborted')), {
      once: true,
    });
    req.end(text);
  });
}

function textOf(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

export function apply(ctx) {
  const bridgeUrl = process.env.SCIENCESCOPE_BRIDGE_URL;
  const token = process.env.SCIENCESCOPE_BRIDGE_TOKEN;
  const sessionId = process.env.SCIENCESCOPE_SESSION_ID;
  const configFile = process.env.SCIENCESCOPE_SESSION_CONFIG;
  if (!bridgeUrl || !token || !sessionId || !configFile) return;
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  let instructions = config.instructions;

  const send = (body, options) => post(bridgeUrl, { token, sessionId, ...body }, options);
  let queue = Promise.resolve();
  const emit = (event) => {
    queue = queue.then(() => send({ type: 'event', event }).catch(() => {}));
  };

  let turnEnd = null;
  let lastFailure = null;
  const mine = (session) => String(session?.id) === sessionId;

  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (!mine(agent.session)) return;
    if (frame.type === 'start') emit({ type: 'attempt-start' });
    if (frame.type === 'end' && frame.outcome?.eventType !== 'assistant/message') {
      emit({ type: 'attempt-discarded' });
    }
    if (frame.type === 'chunk' && isTokenDelta(frame.chunk) && frame.chunk.type === 'text-delta') {
      if (frame.chunk.text) emit({ type: 'text-delta', delta: frame.chunk.text });
    }
  });

  ctx.on('session/event', (session, event) => {
    if (!mine(session)) return;
    const data = event.data ?? {};
    if (event.type === 'tool/call') {
      emit({
        type: 'tool-call',
        callId: String(data.callId),
        name: data.name,
        args: data.arguments,
      });
    } else if (event.type === 'tool/result') {
      const result = data.message?.content?.find((block) => block.type === 'tool-result');
      if (result) {
        emit({
          type: 'tool-result',
          callId: String(result.toolCallId),
          isError: Boolean(result.isError),
          result: result.content,
        });
      }
    } else if (event.type === 'assistant/message') {
      const content = data.message?.content ?? [];
      emit({
        type: 'step-end',
        text: textOf(data.message),
        hasToolCalls: content.some((block) => block?.type === 'tool-call'),
        usage: data.usage,
      });
    } else if (event.type === 'assistant/attempt') {
      const finish = data.stream?.findLast?.((record) => record?.chunk?.type === 'finish')?.chunk;
      if (finish?.reason?.kind === 'error') lastFailure = finish.reason.failure ?? null;
    } else if (event.type === 'turn/end') {
      turnEnd = { kind: data.reason?.kind, usage: data.usage };
    }
  });

  const jsonOutput = {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  };

  const setup = async (agentCtx) => {
    agentCtx.systemPrompt.section({
      name: PERSONA_PREFIX_SECTION,
      order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: () => instructions,
    });
    for (const spec of config.tools ?? []) {
      agentCtx.tools.register(
        defineTool({
          name: spec.name,
          description: spec.description,
          parameters: spec.parameters,
          output: jsonOutput,
          async execute(args, exec) {
            const answer = await send(
              { type: 'tool', name: spec.name, args, callId: String(exec?.callId ?? '') },
              { signal: exec?.signal },
            );
            if (answer?.error) throw new Error(answer.error);
            return answer?.result ?? null;
          },
        }),
      );
    }
  };

  // What the next request would carry against the model's window (the same
  // measurement the v0 adapter used); shown as the input box's context ring.
  const measureContext = () => {
    const session = handle?.agent?.session;
    if (!session) return null;
    const pressure = ctx.get('sessionProjections')?.snapshot(session, ['contextPressure'])
      ?.values?.contextPressure;
    const measured =
      pressure?.projectedTokens === undefined && pressure?.pressureTokens === undefined
        ? ctx.get('tokenMeter')?.measure(session)
        : undefined;
    const usedTokens =
      pressure?.projectedTokens ?? pressure?.pressureTokens ?? measured?.totalTokens;
    return {
      usedTokens: Number.isInteger(usedTokens) ? usedTokens : null,
      contextWindow: Number.isInteger(pressure?.contextWindow) ? pressure.contextWindow : null,
      estimated:
        pressure?.projectedTokens !== undefined || measured?.baseline?.kind === 'estimated',
    };
  };

  const agentOptions = { provider: config.model.provider, model: config.model.model };
  if (config.model.maxTokens) agentOptions.maxTokens = config.model.maxTokens;
  let handle;

  const control = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const reply = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value ?? null));
      };
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (body.token !== token) throw new Error('invalid token');
        if (req.url === '/prompt') {
          turnEnd = null;
          lastFailure = null;
          const content = [{ type: 'text', text: body.text }];
          handle.agent.followup(createUserMessage({ content, source: { kind: 'user' } }));
          await handle.agent.whenIdle();
          await queue;
          const kind = turnEnd?.kind;
          let context = null;
          try {
            context = measureContext();
          } catch {
            // The measurement is best effort.
          }
          reply(200, {
            stopReason: STOP_REASONS[kind] ?? 'failed',
            usage: context ? { ...turnEnd?.usage, context } : turnEnd?.usage,
            ...(STOP_REASONS[kind] ? {} : { error: lastFailure?.message ?? kind ?? 'no turn end' }),
          });
        } else if (req.url === '/interrupt') {
          handle.agent.cancel({ kind: 'user' });
          await handle.agent.whenIdle();
          reply(200, {});
        } else if (req.url === '/instructions') {
          instructions = String(body.text ?? '');
          reply(200, {});
        } else {
          reply(404, { error: 'unknown route' });
        }
      } catch (error) {
        reply(400, { error: String(error?.message ?? error) });
      }
    });
  });

  control.listen(0, '127.0.0.1', async () => {
    try {
      try {
        handle = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, setup });
      } catch (error) {
        if (
          !/not found|unknown session|missing session|no persisted session/i.test(String(error))
        ) {
          throw error;
        }
        handle = await ctx.agents.create({
          sessionId,
          meta: { cwd: process.cwd() },
          agentOptions,
          setup,
        });
      }
      // Security is not a current focus: no approval prompts block the agent.
      ctx.approval?.setPolicy?.(handle.agent, 'never');
      const { port } = /** @type {import('node:net').AddressInfo} */ (control.address());
      await send({ type: 'ready', controlUrl: `http://127.0.0.1:${port}` });
    } catch (error) {
      await send({ type: 'failed', error: String(error?.message ?? error) }).catch(() => {});
    }
  });

  ctx.effect(
    () => async () => {
      await handle?.dispose?.().catch(() => {});
      await new Promise((resolve) => control.close(() => resolve(undefined)));
    },
    'sciencescope.bridge',
  );
}

export default { name, inject, apply };
