/** Adapter-owned presentation bridge for DSH's public assistant stream event. */
import { request } from 'node:http';
import { isTokenDelta } from '@deepseek-ai/dsh-llm';

export const name = 'sciencescope-assistant-stream-bridge';
export const inject = ['agents'];

export function apply(ctx) {
  const endpoint = process.env.SCIENCESCOPE_STREAM_ENDPOINT;
  const token = process.env.SCIENCESCOPE_STREAM_TOKEN;
  const sessionId = process.env.SCIENCESCOPE_STREAM_SESSION;
  if (!endpoint || !token || !sessionId) return;
  let sendTail = Promise.resolve();
  let sequence = 0;
  const send = (message) => new Promise((resolve) => {
    const body = JSON.stringify({ token, sessionId, sequence:++sequence, ...message });
    const target = new URL(endpoint);
    const req = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 2_000 }, (response) => { response.resume(); resolve(); });
    req.on('error', () => resolve());
    req.on('timeout', () => req.destroy());
    req.end(body);
  });
  const enqueue = (message) => { const result = sendTail = sendTail.then(() => send(message)); return result; };
  const committed = (data) => {
    const message = data?.message ?? data;
    const content = Array.isArray(message?.content) ? message.content : [];
    const text = content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('');
    return {turn:data?.turn,step:data?.step,...(message?.id === undefined ? {} : { messageId: message.id }),text};
  };
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (String(agent.session.id) !== sessionId) return;
    if (frame.type === 'start') { void enqueue({ type: 'stream-start', attemptId: frame.attemptId, revision: frame.revision }); return; }
    if (frame.type === 'end') { void enqueue({ type: 'stream-end', attemptId: frame.attemptId, outcome: frame.outcome }); return; }
    if (frame.type === 'chunk' && isTokenDelta(frame.chunk) && frame.chunk.type === 'text-delta' && frame.chunk.text) void enqueue({ type: 'text-delta', delta: frame.chunk.text, index: frame.index, attemptId: frame.attemptId });
  });
  ctx.on('agent/status', ({agent,status}) => {
    if (String(agent.session.id) === sessionId) void enqueue({type:status === 'idle' ? 'run-idle' : 'run-start'});
  });
  ctx.on('session/event', (session, event) => {
    if (String(session.id) !== sessionId) return;
    // Presentation receipts only. Do not copy raw command arguments, private
    // result metadata or credentials into application chat records.
    if (event.type === 'tool/call') void enqueue({type:'tool-call',callId:String(event.data.callId),name:event.data.name});
    if (event.type === 'tool/result') {
      const result = event.data.message?.content?.find(block => block.type === 'tool-result');
      if (result) void enqueue({type:'tool-result',callId:String(result.toolCallId),isError:!!result.isError});
    }
    if (event.type === 'assistant/message' || event.type === 'turn/end') void enqueue({ type: 'committed-event', eventType: event.type, seq:event.seq,time:event.time,data: committed(event.data) });
  });
}

export default { name, inject, apply };
