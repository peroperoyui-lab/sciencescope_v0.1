// Compose pi's Agent rather than implementing an agent loop. SDK transcripts
// are disposable working memory; the canonical meeting remains in our database.
// API usage follows earendil-works/pi README examples (MIT); no copied loop.
import { randomUUID } from 'node:crypto';
import { Agent } from '@earendil-works/pi-agent-core';
import { createInitialSystemMessage, toToolDeclaration } from '@earendil-works/pi-ai';
import { agentTools } from './tools.js';
import { controlledStream } from './requests.js';
import { sessionStore } from './sessions.js';
import { aggregateUsage } from './usage.js';
import { createRequestLog } from './request-log.js';

/**
 * @param {{home:string,logs:string,catalog:any,limits?:any,fetch?:any}} dependencies
 * @returns {import('../port.js').Runtime}
 */
export function createPiRuntime({ home, logs, catalog, limits, fetch: requestFetch }) {
  const sessions = new Map();
  const store = sessionStore(home);
  const log = createRequestLog(logs);
  let closed = false;

  async function startSession(options) {
    if (closed) throw new Error('Runtime is closed');
    const id = options.sessionId ?? randomUUID();
    const previous = sessions.get(id);
    if (previous?.agent.state.isStreaming) throw new Error('Session is busy');
    const previousMessages =
      previous?.agent.state.messages ?? (options.sessionId ? await store.read(id) : []);
    const selection = await catalog.resolve(options.model);
    const tools = options.noTools ? [] : agentTools(options.tools, options.onToolCall);
    const initial = createInitialSystemMessage(options.instructions, tools.map(toToolDeclaration));
    const history = previousMessages.filter((message) => message.role !== 'system');
    const messages = initial ? [initial, ...history] : history;
    const agent = new Agent({
      sessionId: id,
      initialState: { model: selection.model, messages, tools, systemPrompt: options.instructions },
      // The per-send request controller is installed before prompt().
      streamFn: () => {
        throw new Error('No active send');
      },
    });
    sessions.set(id, {
      agent,
      choice: options.model,
      selection,
      noTools: Boolean(options.noTools),
      requests: [],
    });
    await store.write(id, agent.state.messages);
    return id;
  }

  /**
   * @param {string} id
   * @param {string} input
   * @param {(event:import('../port.js').RuntimeEvent)=>void} onEvent
   * @returns {Promise<import('../port.js').TurnResult>}
   */
  async function send(id, input, onEvent) {
    const session = sessions.get(id);
    if (!session || closed) throw new Error('Session is not open');
    const { agent, selection, choice } = session;
    if (agent.state.isStreaming) throw new Error('Session is busy');
    const requests = [];
    session.cancelled = false;
    session.requests = requests;
    agent.streamFunction = controlledStream({
      selection,
      choice,
      sessionId: id,
      onEvent,
      log,
      requests,
      limits,
      noTools: session.noTools,
      fetch: requestFetch,
    });
    const unsubscribe = agent.subscribe(async (event) => {
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta') {
          onEvent({ type: 'phase', phase: 'answering' });
          onEvent({ type: 'text-delta', delta: update.delta });
        } else if (update.type === 'thinking_delta') {
          onEvent({ type: 'phase', phase: 'thinking' });
          onEvent({ type: 'thinking-delta', delta: update.delta });
        }
      } else if (event.type === 'message_end' && event.message.role === 'assistant') {
        const message = event.message;
        onEvent({
          type: 'step-end',
          text: message.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join(''),
          hasToolCalls: message.content.some((block) => block.type === 'toolCall'),
          usage: message.usage,
        });
      } else if (event.type === 'tool_execution_start') {
        onEvent({ type: 'phase', phase: 'tool' });
        onEvent({
          type: 'tool-call',
          callId: event.toolCallId,
          name: event.toolName,
          args: event.args,
        });
      } else if (event.type === 'tool_execution_end') {
        onEvent({
          type: 'tool-result',
          callId: event.toolCallId,
          isError: event.isError,
          result: event.result.details ?? event.result.content,
        });
      } else if (event.type === 'turn_end') await store.write(id, agent.state.messages);
    });
    try {
      await agent.prompt(input);
      const last = agent.state.messages.findLast((message) => message.role === 'assistant');
      const reason = session.cancelled ? 'aborted' : last?.stopReason;
      return {
        stopReason:
          reason === 'aborted'
            ? 'cancelled'
            : reason === 'error'
              ? 'failed'
              : reason === 'length'
                ? 'max_tokens'
                : 'completed',
        ...(last?.errorMessage ? { error: last.errorMessage } : {}),
        usage: aggregateUsage(requests, selection.model.contextWindow),
      };
    } finally {
      unsubscribe();
    }
  }

  return {
    startSession,
    send,
    async interrupt(id) {
      const session = sessions.get(id);
      if (session) {
        session.cancelled = true;
        session.agent.abort();
      }
    },
    async setInstructions(id, instructions) {
      const agent = sessions.get(id)?.agent;
      if (!agent) throw new Error('Session is not open');
      const message = createInitialSystemMessage(
        instructions,
        agent.state.tools.map(toToolDeclaration),
      );
      const history = agent.state.messages.filter((entry) => entry.role !== 'system');
      agent.state.messages = message ? [message, ...history] : history;
      await store.write(id, agent.state.messages);
    },
    async release(id) {
      const agent = sessions.get(id)?.agent;
      agent?.abort();
      await agent?.waitForIdle();
      sessions.delete(id);
    },
    async close() {
      closed = true;
      for (const session of sessions.values()) {
        session.cancelled = true;
        session.agent.abort();
      }
      await Promise.all([...sessions.values()].map(({ agent }) => agent.waitForIdle()));
      sessions.clear();
    },
  };
}
