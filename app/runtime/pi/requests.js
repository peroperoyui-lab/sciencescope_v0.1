// This loop retries one provider request, never the agent/tool loop. The latter
// belongs entirely to pi-agent-core. Once any content is visible, retain it.
import { setTimeout as delay } from 'node:timers/promises';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { REQUEST_LIMITS } from './limits.js';
import { explainFailure } from './errors.js';

/**
 * Await a cooperative SDK or tool operation with prompt cancellation. The
 * underlying request receives the same signal, so its socket is also closed.
 * @template T
 * @param {Promise<T>} operation
 * @param {AbortSignal} signal
 * @returns {Promise<T>}
 */
export async function abortable(operation, signal) {
  signal.throwIfAborted();
  let cancel;
  const stopped = new Promise((_, reject) => {
    cancel = () => reject(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
  });
  try {
    return await Promise.race([operation, stopped]);
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

function emptyMessage(model) {
  return {
    role: /** @type {const} */ ('assistant'),
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: /** @type {'error' | 'aborted'} */ ('error'),
    timestamp: Date.now(),
  };
}

/**
 * @param {{selection:any,choice:any,sessionId:string,onEvent:(event:any)=>void,
 *   log:(record:any)=>Promise<void>,requests:any[],limits?:Partial<typeof REQUEST_LIMITS>,fetch?:any,noTools?:boolean}} dependencies
 */
export function controlledStream({
  selection,
  choice,
  sessionId,
  onEvent,
  log,
  requests,
  limits: overrides,
  fetch: requestFetch,
  noTools = false,
}) {
  const limits = { ...REQUEST_LIMITS, ...overrides };
  return (model, context, options = {}) => {
    const output = createAssistantMessageEventStream();
    const parent = options.signal ?? new AbortController().signal;
    const hostname = new URL(model.baseUrl).hostname;

    async function run() {
      for (let attempt = 1; attempt <= limits.maxAttempts; attempt++) {
        onEvent({ type: 'phase', phase: 'connecting' });
        onEvent({ type: 'attempt-start' });
        const controller = new AbortController();
        const signal = AbortSignal.any([parent, controller.signal]);
        let timer;
        let timeout;
        let firstEventMs = null;
        let status;
        let retryAfter;
        let visible = false;
        let usageReported = false;
        let final;
        let partial = emptyMessage(model);
        let iterator;
        const started = performance.now();
        const arm = (ms) => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            timeout = ms;
            controller.abort(new Error('Model stream timeout'));
          }, ms);
        };
        const received = () => {
          firstEventMs ??= performance.now() - started;
          arm(limits.idleEventMs);
        };
        arm(limits.firstEventMs);
        try {
          const stream = selection.models.streamSimple(model, context, {
            ...options,
            headers: { ...selection.entry.headers, ...options.headers },
            signal,
            maxRetries: 0,
            timeoutMs: limits.timeoutMs,
            ...(requestFetch ? { fetch: requestFetch } : {}),
            ...(choice.effort ? { reasoning: choice.effort } : { reasoning: undefined }),
            ...(choice.maxTokens ? { maxTokens: choice.maxTokens } : {}),
            ...(noTools ? { toolChoice: 'none' } : {}),
            onResponse(response) {
              status = response.status;
              retryAfter = response.headers['retry-after'];
            },
            onProviderStreamEvent(data) {
              received();
              usageReported ||= Boolean(data?.usage || data?.message?.usage);
            },
          });
          iterator = stream[Symbol.asyncIterator]();
          while (true) {
            const next = await abortable(iterator.next(), signal);
            if (next.done) break;
            const event = next.value;
            if ('partial' in event) partial = event.partial;
            if (event.type !== 'start' && event.type !== 'error') received();
            if (event.type === 'error') {
              final = event.error;
              break;
            }
            if (event.type === 'done') {
              final = event.message;
              break;
            }
            if (
              event.type === 'text_delta' ||
              event.type === 'thinking_delta' ||
              event.type === 'toolcall_delta'
            )
              visible ||= Boolean(event.delta);
            output.push(event);
          }
          final ??= await abortable(stream.result(), signal);
        } catch (error) {
          final = { ...partial, stopReason: 'error', errorMessage: String(error.message ?? error) };
        } finally {
          clearTimeout(timer);
          if (signal.aborted) void iterator?.return?.().catch(() => {});
        }

        if (
          final.stopReason === 'stop' &&
          !final.content.some(
            (part) => part.type === 'toolCall' || (part.type === 'text' && part.text.trim()),
          )
        )
          final = { ...final, stopReason: 'error', errorMessage: 'empty_response' };
        const failed =
          timeout ||
          parent.aborted ||
          final.stopReason === 'error' ||
          final.stopReason === 'aborted';
        const explanation = failed
          ? explainFailure({
              message: final,
              status,
              timeout,
              attempt,
              provider: selection.entry.name ?? model.provider,
              hostname,
              cancelled: parent.aborted,
            })
          : null;
        const known = usageReported || final.usage?.totalTokens > 0;
        requests.push({ usage: final.usage, known });
        await log({
          time: new Date().toISOString(),
          session: sessionId,
          provider: model.provider,
          model: model.id,
          api: model.api,
          hostname,
          httpStatus: status ?? null,
          totalMs: performance.now() - started,
          firstEventMs,
          stopReason: parent.aborted ? 'cancelled' : failed ? 'failed' : final.stopReason,
          error: explanation?.message ?? null,
          usage: known ? final.usage : null,
        });
        if (!failed) {
          output.push({ type: 'done', reason: final.stopReason, message: final });
          return;
        }
        if (!parent.aborted && !visible && explanation.retryable && attempt < limits.maxAttempts) {
          const seconds = Number(retryAfter);
          const requested = retryAfter
            ? Number.isFinite(seconds)
              ? seconds * 1000
              : Date.parse(retryAfter) - Date.now()
            : null;
          const delayMs =
            requested === null || !Number.isFinite(requested)
              ? limits.retryDelaysMs[attempt - 1]
              : Math.max(0, Math.min(limits.maxRetryAfterMs, requested));
          onEvent({ type: 'phase', phase: 'retrying' });
          onEvent({
            type: 'retry',
            attempt: attempt + 1,
            maxAttempts: limits.maxAttempts,
            error: explanation.message,
            delayMs,
          });
          onEvent({ type: 'attempt-discarded' });
          try {
            await delay(delayMs, undefined, { signal: parent });
          } catch {
            // An interrupted backoff ends this request without another attempt.
          }
          if (!parent.aborted) continue;
        }
        output.push({
          type: 'error',
          reason: parent.aborted ? 'aborted' : 'error',
          error: {
            ...final,
            stopReason: parent.aborted ? 'aborted' : 'error',
            errorMessage: parent.aborted ? '已停止。' : explanation.message,
          },
        });
        return;
      }
    }
    void run().catch(() =>
      output.push({
        type: 'error',
        reason: parent.aborted ? 'aborted' : 'error',
        error: {
          ...emptyMessage(model),
          stopReason: parent.aborted ? 'aborted' : 'error',
          errorMessage: '无法完成模型请求，请检查应用日志目录并重试。',
        },
      }),
    );
    return output;
  };
}
