// The runtime port: everything ScienceScope needs from an agent runtime.
// Core and services depend only on this shape; `pi/` composes pi-ai with
// pi-agent-core and `scripted.js` implements it for tests.
//
// A runtime session is one AI's working memory in one meeting. The meeting
// record (our database) stays the source of truth; a session can be dropped
// and rebuilt from it at any time.

/**
 * @typedef {{ provider: string, model: string, effort?: string, maxTokens?: number }} ModelChoice
 * @typedef {{ type: 'image', data: string, mimeType: string }} ImageContent
 * @typedef {{text:string, images:Array<{data:string,mimeType:string}>, preview?:any}} ImageToolResult
 *
 * @typedef {{ name: string, description: string, parameters: Record<string, any> }} ToolSpec
 *   `parameters` uses the field map DSL: `{ field: { type, required?, enum?, items?,
 *   properties?, additionalProperties?, description? } }`.
 *
 * @typedef {(call: { name: string, args: any, callId: string, signal: AbortSignal }) => Promise<any>} ToolHandler
 *   Runs a ScienceScope tool and returns JSON or ImageToolResult. Image bytes go
 *   to model working memory; tool-result events contain only preview metadata.
 *
 * @typedef {{ type: 'text-delta', delta: string }
 *   | { type: 'phase', phase: 'connecting' | 'thinking' | 'answering' | 'tool' | 'retrying' | 'waiting-approval' | 'compacting' }
 *   | { type: 'compaction', beforeTokens: number, afterTokens: number }
 *   | { type: 'thinking-delta', delta: string }
 *   | { type: 'retry', attempt: number, maxAttempts: number, error: string, delayMs: number }
 *   | { type: 'attempt-start' }
 *   | { type: 'attempt-discarded' }
 *   | { type: 'tool-call', callId: string, name: string, args: any }
 *   | { type: 'tool-result', callId: string, isError: boolean, result: any }
 *   | { type: 'step-end', text: string, hasToolCalls: boolean, usage?: any }
 * } RuntimeEvent
 *   `attempt-discarded`: the text streamed since the last `attempt-start` was
 *   dropped (a failed attempt that the runtime retries).
 *
 * @typedef {{ stopReason: 'completed' | 'max_tokens' | 'cancelled' | 'failed',
 *   error?: string, usage?: any }} TurnResult
 *
 * @typedef {{
 *   startSession(options: { sessionId?: string, model: ModelChoice, workFolder: string,
 *     instructions: string, tools: ToolSpec[], onToolCall: ToolHandler, noTools?: boolean,
 *     env?: {PATH?:string,VIRTUAL_ENV?:string} }): Promise<string>,
 *   send(sessionId: string, input: string, onEvent: (event: RuntimeEvent) => void, images?: ImageContent[]): Promise<TurnResult>,
 *   interrupt(sessionId: string): Promise<void>,
 *   setInstructions(sessionId: string, instructions: string): Promise<void>,
 *   release(sessionId: string): Promise<void>,
 *   close(): Promise<void>,
 * }} Runtime
 *   `startSession` with an existing `sessionId` resumes it (its working memory
 *   survives a restart when the runtime persists it). `release` frees the
 *   process but keeps what can be resumed.
 */

/**
 * Keep image bytes out of the durable transcript and event log.
 * @param {any} result
 */
export function recordedToolResult(result) {
  if (!Array.isArray(result?.images)) return result;
  const record = { ...result };
  delete record.images;
  return record;
}
