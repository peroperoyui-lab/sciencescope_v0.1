// A runtime for tests: each reply comes from a script function instead of a
// model. Scripts can stream text, call ScienceScope tools and choose how the
// turn ends, so conductor behaviour is testable without a model or DSH.

/**
 * @typedef {{ sessionId: string, input: string, inputs: string[], instructions: string,
 *   call: (name: string, args: any) => Promise<any>, signal: AbortSignal }} ScriptContext
 * @typedef {(context: ScriptContext) => AsyncIterable<
 *   string | { stop: 'max_tokens' | 'failed', error?: string } | import('./port.js').RuntimeEvent>} Script
 */

/**
 * @param {{ script: Script }} options
 * @returns {import('./port.js').Runtime & { sessions: Map<string, any> }}
 */
export function createScriptedRuntime({ script }) {
  const sessions = new Map();
  let counter = 0;

  return {
    sessions,
    async startSession({ sessionId, instructions, tools, onToolCall, model, workFolder, env }) {
      const id = sessionId ?? `scripted-${++counter}`;
      const existing = sessions.get(id);
      sessions.set(id, {
        id,
        instructions,
        tools,
        onToolCall,
        model,
        workFolder,
        env,
        inputs: existing?.inputs ?? [],
        controller: null,
      });
      return id;
    },

    async send(sessionId, input, onEvent) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error(`No scripted session ${sessionId}`);
      session.inputs.push(input);
      session.controller = new AbortController();
      const { signal } = session.controller;
      let calls = 0;
      let text = '';
      onEvent({ type: 'attempt-start' });
      onEvent({ type: 'phase', phase: 'connecting' });
      try {
        const steps = script({
          sessionId,
          input,
          inputs: session.inputs,
          instructions: session.instructions,
          signal,
          call: async (name, args) => {
            const callId = `call-${++calls}`;
            onEvent({ type: 'step-end', text, hasToolCalls: true });
            text = '';
            onEvent({ type: 'phase', phase: 'tool' });
            onEvent({ type: 'tool-call', callId, name, args });
            try {
              const result = await session.onToolCall({ name, args, callId, signal });
              onEvent({ type: 'tool-result', callId, isError: false, result });
              return result;
            } catch (error) {
              onEvent({
                type: 'tool-result',
                callId,
                isError: true,
                result: String(error.message),
              });
              throw error;
            }
          },
        });
        for await (const step of steps) {
          if (signal.aborted) return { stopReason: 'cancelled' };
          if (typeof step === 'string') {
            text += step;
            onEvent({ type: 'phase', phase: 'answering' });
            onEvent({ type: 'text-delta', delta: step });
          } else if ('stop' in step) {
            onEvent({ type: 'step-end', text, hasToolCalls: false });
            return { stopReason: step.stop, error: step.error };
          } else onEvent(step);
        }
        onEvent({ type: 'step-end', text, hasToolCalls: false });
        // Context pressure as DSH reports it: here simply the characters sent so far.
        const usedTokens = session.inputs.join('').length + session.instructions.length;
        return {
          stopReason: signal.aborted ? 'cancelled' : 'completed',
          usage: { context: { usedTokens, contextWindow: null, estimated: true } },
        };
      } finally {
        session.controller = null;
      }
    },

    async interrupt(sessionId) {
      sessions.get(sessionId)?.controller?.abort();
    },
    async setInstructions(sessionId, instructions) {
      const session = sessions.get(sessionId);
      if (session) session.instructions = instructions;
    },
    async release() {},
    async close() {},
  };
}
