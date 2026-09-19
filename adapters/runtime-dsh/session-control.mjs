/** Adapter-owned lifecycle bridge over the public DSH AgentRegistry. */
import { createServer } from 'node:http';
import { request } from 'node:http';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { installModelSelection } from '@deepseek-ai/dsh-agent';

export const name = 'sciencescope-session-control';
export const inject = ['agents', 'goals', 'approval', 'sandboxPolicy', 'llm'];

export function apply(ctx) {
  const endpoint = process.env.SCIENCESCOPE_STREAM_ENDPOINT;
  const token = process.env.SCIENCESCOPE_STREAM_TOKEN;
  const sessionId = process.env.SCIENCESCOPE_STREAM_SESSION;
  if (!endpoint || !token || !sessionId) return;
  const postHost = (message) => new Promise((resolve) => {
    const body = JSON.stringify({ token, sessionId, ...message }); const target = new URL(endpoint);
    const req = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 2000 }, (res) => { res.resume(); resolve(); });
    req.on('error', resolve); req.on('timeout', () => req.destroy()); req.end(body);
  });
  let eventSequence = 0;
  const postEvent = (event) => postHost({ type: 'control-event', sequence: ++eventSequence, event });
  const pendingApprovals = new Map();
  const agentOptions = { provider: process.env.SCIENCESCOPE_PROVIDER, model: process.env.SCIENCESCOPE_MODEL };
  const noTools = process.env.SCIENCESCOPE_NO_TOOLS === '1';
  const selection={current:{...agentOptions},assembled:undefined};
  const setup = (agentCtx) => {
    installModelSelection(agentCtx,selection);
    if(noTools)agentCtx.tools.restrict({allow:[]});
  };
  let handle;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/prompt', '/goal', '/policy', '/reasoning', '/approval/reply'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    let body = ''; req.setEncoding('utf8'); req.on('data', (chunk) => { body += chunk; if(Buffer.byteLength(body)>2*1024*1024)req.destroy(); });
    req.on('end', async () => {
      try {
        const value = JSON.parse(body);
        if (value.token !== token || value.sessionId !== sessionId) throw new Error('invalid session control request');
        await ready;
        if (req.url === '/approval/reply') {
          const pending = pendingApprovals.get(value.requestId);
          if (!pending || !['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(value.outcome)) throw new Error('invalid approval reply');
          const entry = pendingApprovals.get(value.requestId); pendingApprovals.delete(value.requestId); entry?.signal?.removeEventListener('abort', entry.onAbort); entry?.resolve(value.outcome);
          res.writeHead(204); res.end(); return;
        }
        const session = handle.agent.session;
        if(req.url==='/reasoning'){
          if(handle.agent.status!=='idle')throw new Error('reasoning effort can only change while idle');
          const next={...agentOptions,...(value.reasoningEffort==null?{}:{reasoningEffort:value.reasoningEffort})};
          await ctx.llm.resolveCallConfig(next);
          selection.current=next;
          res.writeHead(204);res.end();return;
        }
        if (req.url === '/prompt') {
          if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('text is required');
          handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: value.text }], source: { kind: 'user' } }));
          await handle.agent.whenIdle();
        } else if (req.url === '/goal') {
          const ref = value.ref;
          let result;
          switch (value.action) {
            case 'create': result = ctx.goals.create(handle.agent, { objective: value.objective, ...(value.maxGoalRounds === undefined ? {} : { maxGoalRounds: value.maxGoalRounds }) }); break;
            case 'get': result = ctx.goals.get(handle.agent); break;
            case 'pause': result = ctx.goals.pause(handle.agent, ref); break;
            case 'resume': result = ctx.goals.resume(handle.agent, ref); break;
            case 'complete': result = ctx.goals.complete(handle.agent, ref); break;
            case 'block': result = ctx.goals.block(handle.agent, ref, value.reason); break;
            case 'clear': result = ctx.goals.clear(handle.agent, ref); break;
            case 'edit': result = ctx.goals.edit(handle.agent, ref, value.request); break;
            default: throw new Error('unknown goal action');
          }
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result })); return;
        } else {
          if (!['ask', 'never'].includes(value.approvalPolicy) && value.approvalPolicy !== undefined) throw new Error('invalid approval policy');
          if (value.approvalPolicy !== undefined) {
            if (!ctx.approval) throw new Error('DSH approval service is unavailable');
            ctx.approval.setPolicy(handle.agent, value.approvalPolicy);
          }
          if (value.sandboxMode !== undefined) setSandboxMode(session, value.sandboxMode);
          res.writeHead(204); res.end(); return;
        }
        res.writeHead(204); res.end();
      } catch (error) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
    });
  });
  server.listen(0, '127.0.0.1', async () => {
    const address = server.address();
    try {
      try { handle = await ctx.agents.resume({ resumeSessionId: sessionId, agentOptions, ...(setup ? { setup } : {}) }); }
      catch (error) {
        const message = String(error?.message ?? error);
        if (!/not found|unknown session|missing session|no persisted session/i.test(message)) throw error;
        handle = await ctx.agents.create({ sessionId, meta: { cwd: process.cwd() }, agentOptions, ...(setup ? { setup } : {}) });
      }
      readyResolve();
      await postHost({ type: 'control-ready', controlEndpoint: `http://127.0.0.1:${address.port}/prompt`, resumed: true });
    } catch (error) { await postHost({ type: 'control-error', error: error.message }); }
  });
  ctx.on('goal/activation-changed', (event) => {
    if (String(event.sessionId) === sessionId) void postEvent({ type: 'goal-activation', ...event });
  });
  ctx.on('approval/request', (requestEvent, next) => {
    if (String(requestEvent.agent?.session?.id) !== sessionId) return next();
    const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    void postEvent({ type: 'approval-request', requestId, toolName: requestEvent.toolName, callId: requestEvent.callId, reason: requestEvent.reason });
    return new Promise((resolve) => {
      const onAbort = () => { pendingApprovals.delete(requestId);void postEvent({type:'approval-cancelled',requestId}); resolve('cancelled'); };
      if(requestEvent.signal?.aborted){onAbort();return;}
      requestEvent.signal?.addEventListener('abort', onAbort, { once: true });
      pendingApprovals.set(requestId, { resolve, signal: requestEvent.signal, onAbort });
    });
  });
  ctx.on('session/event', (eventSession, event) => {
    if (String(eventSession.id) !== sessionId) return;
    if (['goal/change', 'approval/asked', 'approval/decided', 'sandbox/mode'].includes(event.type)) void postEvent({ type: 'session-event', eventType: event.type, data: event.data });
  });
  ctx.effect(() => async () => { for (const entry of pendingApprovals.values()) entry.resolve('cancelled'); pendingApprovals.clear(); await handle?.dispose().catch(() => {}); await new Promise((resolve) => server.close(() => resolve())); }, 'sciencescope.session-control');
}

export default { name, inject, apply };
