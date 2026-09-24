/** Adapter-owned lifecycle bridge over the public DSH AgentRegistry. */
import { createServer } from 'node:http';
import { request } from 'node:http';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { randomUUID } from 'node:crypto';
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt';
import { isTokenDelta } from '@deepseek-ai/dsh-llm';
import { previewValue } from '../../scripts/tool-activity.mjs';

export const name = 'sciencescope-session-control';
export const inject = ['agents', 'goals', 'approval', 'sandboxPolicy', 'llm'];

export function apply(ctx) {
  const endpoint = process.env.SCIENCESCOPE_STREAM_ENDPOINT;
  const token = process.env.SCIENCESCOPE_STREAM_TOKEN;
  const sessionId = process.env.SCIENCESCOPE_STREAM_SESSION;
  const proposalTargetChatId = process.env.SCIENCESCOPE_PROPOSAL_TARGET_CHAT_ID;
  if (!endpoint || !token || !sessionId) return;
  const postHost = (message) => new Promise((resolve) => {
    const body = JSON.stringify({ token, sessionId, ...message }); const target = new URL(endpoint);
    const req = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 2000 }, (res) => { res.resume(); resolve(); });
    req.on('error', resolve); req.on('timeout', () => req.destroy()); req.end(body);
  });
  let eventSequence = 0;
  // Serialised: expert text deltas must reach the host in order.
  let eventTail = Promise.resolve();
  const postEvent = (event) => { const sequence = ++eventSequence; eventTail = eventTail.then(() => postHost({ type: 'control-event', sequence, event })); return eventTail; };
  const pendingApprovals = new Map();
  const agentOptions = { provider: process.env.SCIENCESCOPE_PROVIDER, model: process.env.SCIENCESCOPE_MODEL };
  const noTools = process.env.SCIENCESCOPE_NO_TOOLS === '1';
  const selection={current:{...agentOptions},assembled:undefined};
  let promptContext;
  let personaEntry;
  let currentPersona = process.env.SCIENCESCOPE_PERSONA;
  const setup = (agentCtx) => {
    promptContext = agentCtx;
    installModelSelection(agentCtx,selection);
    if(proposalTargetChatId) agentCtx.tools.register(defineTool({
      name:'propose_main_draft',description:'Propose a draft instruction for the Main expert. This only waits for user review; it never sends the instruction.',
      parameters:{text:{type:'string',required:true,description:'Draft text, at most 64000 characters.'}},
      output:{schema:{type:'object',additionalProperties:false,properties:{status:{type:'string',required:true},proposalId:{type:'string',required:true}}},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
      async execute(args){
        if(typeof args.text!=='string'||!args.text.trim()||args.text.length>64000)throw new Error('text must be 1-64000 characters');
        const proposalId=randomUUID();await postEvent({type:'main-draft-proposal',proposalId,text:args.text});
        return {status:'awaiting_user_review',proposalId};
      }
    }));
    if(noTools)agentCtx.tools.restrict({allow:[]});
  };
  let handle;
  let readyResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const configurePersona = async (value) => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('persona is required');
    if (handle.agent.status !== 'idle') throw new Error('persona can only change while idle');
    return handle.agent.runMaintenance(async () => {
      if (handle.agent.status !== 'idle') throw new Error('persona can only change while idle');
      if (!personaEntry) {
        if (!promptContext?.systemPrompt) throw new Error('DSH system-prompt service is unavailable');
        const dispose = promptContext.systemPrompt.section({
          name: PERSONA_PREFIX_SECTION,
          order: promptContext.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
          text: () => currentPersona,
        });
        personaEntry = { dispose };
      }
      currentPersona = value;
    });
  };
  // Expert discussion: each expert is a fresh in-process DSH child (spawn
  // provider) with its own persona and model route, all answering the same
  // frozen prompt concurrently. The Main agent's history is not changed.
  const expertRuns = new Map();
  // child session id → {runId, expertId}: lets progress of an expert's own
  // agent (text and tool calls) reach the UI while the round is running.
  const expertChildren = new Map();
  const EXPERT_ID = /^[A-Za-z0-9_-]{1,80}$/u;
  const runExperts = async (value) => {
    const subagents = ctx.get('subagents');
    if (!subagents?.start) throw new Error('DSH subagent service is unavailable');
    if (typeof value.runId !== 'string' || !EXPERT_ID.test(value.runId) || expertRuns.has(value.runId)) throw new Error('invalid expert run id');
    if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 400000) throw new Error('expert prompt is required');
    const experts = Array.isArray(value.experts) ? value.experts : [];
    if (!experts.length || experts.length > 8) throw new Error('between 1 and 8 experts are required');
    for (const expert of experts) {
      if (!expert || typeof expert.id !== 'string' || !EXPERT_ID.test(expert.id)) throw new Error('invalid expert id');
      if (typeof expert.persona !== 'string' || !expert.persona.trim() || expert.persona.length > 16000) throw new Error('expert persona is required');
      if (expert.model !== undefined && (typeof expert.model?.providerId !== 'string' || typeof expert.model?.modelId !== 'string')) throw new Error('invalid expert model');
      if (expert.prompt !== undefined && (typeof expert.prompt !== 'string' || !expert.prompt.trim() || expert.prompt.length > 400000)) throw new Error('invalid expert prompt');
    }
    if (new Set(experts.map((expert) => expert.id)).size !== experts.length) throw new Error('duplicate expert id');
    const controller = new AbortController();
    expertRuns.set(value.runId, controller);
    try {
      return await Promise.all(experts.map(async (expert) => {
        const agentOptions = {
          ...(expert.model ? { provider: expert.model.providerId, model: expert.model.modelId } : {}),
          ...(typeof expert.reasoningEffort === 'string' ? { reasoningEffort: expert.reasoningEffort } : {}),
        };
        const startedAt = Date.now();
        void postEvent({ type: 'expert-start', runId: value.runId, expertId: expert.id });
        let run;
        try {
          run = await subagents.start('spawn', {
            label: String(expert.label || expert.id).slice(0, 80),
            // The shared prompt is the frozen common input; an optional
            // per-expert prompt (e.g. "this block is your own answer") follows it.
            prompt: [{ type: 'text', text: expert.prompt ? `${value.prompt}\n\n${expert.prompt}` : value.prompt }],
            parent: handle.agent,
            signal: controller.signal,
            persona: expert.persona,
            ...(Object.keys(agentOptions).length ? { agentOptions } : {}),
            ...(expert.tools === 'none' ? { toolFilter: { allow: [] } } : {}),
          });
          expertChildren.set(String(run.id), { runId: value.runId, expertId: expert.id });
          const outcome = await run.result;
          const text = outcome.output.filter((block) => block?.type === 'text').map((block) => block.text).join('');
          const entry = { expertId: expert.id, stopReason: outcome.stopReason, text, ...(outcome.diagnostic ? { diagnostic: outcome.diagnostic.slice(0, 500) } : {}), ms: Date.now() - startedAt };
          void postEvent({ type: 'expert-end', runId: value.runId, ...entry });
          return entry;
        } catch (error) {
          const entry = { expertId: expert.id, stopReason: controller.signal.aborted ? 'aborted' : 'error', text: '', diagnostic: String(error?.message ?? error).slice(0, 500), ms: Date.now() - startedAt };
          void postEvent({ type: 'expert-end', runId: value.runId, ...entry });
          return entry;
        } finally { if (run) { expertChildren.delete(String(run.id)); childText.delete(String(run.id)); } await run?.dispose().catch(() => {}); }
      }));
    } finally { expertRuns.delete(value.runId); }
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/prompt', '/goal', '/policy', '/reasoning', '/model', '/persona', '/interrupt', '/approval/reply', '/context-usage', '/experts', '/experts/cancel'].includes(req.url)) { res.writeHead(404); res.end(); return; }
    let body = ''; req.setEncoding('utf8'); req.on('data', (chunk) => { body += chunk; if(Buffer.byteLength(body)>2*1024*1024)req.destroy(); });
    req.on('end', async () => {
      try {
        const value = JSON.parse(body);
        if (value.token !== token || value.sessionId !== sessionId) throw new Error('invalid session control request');
        await ready;
        const session = handle.agent.session;
        if (req.url === '/context-usage') {
          const projections = ctx.get('sessionProjections');
          const meter = ctx.get('tokenMeter');
          const values = projections?.snapshot(session, ['contextPressure']).values ?? {};
          const pressure = values.contextPressure;
          const measurement = pressure?.projectedTokens === undefined && pressure?.pressureTokens === undefined ? meter?.measure(session) : undefined;
          const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens ?? measurement?.totalTokens;
          const contextWindow = pressure?.contextWindow;
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ result: {
            usedTokens: Number.isInteger(usedTokens) ? usedTokens : null,
            contextWindow: Number.isInteger(contextWindow) ? contextWindow : null,
            estimated: usedTokens === undefined ? null : pressure?.projectedTokens !== undefined || measurement?.baseline?.kind === 'estimated',
          } }));
          return;
        }
        if (req.url === '/approval/reply') {
          const pending = pendingApprovals.get(value.requestId);
          if (!pending || !['allowed-once', 'rejected', 'cancelled', 'unavailable'].includes(value.outcome)) throw new Error('invalid approval reply');
          const entry = pendingApprovals.get(value.requestId); pendingApprovals.delete(value.requestId); entry?.signal?.removeEventListener('abort', entry.onAbort); entry?.resolve(value.outcome);
          res.writeHead(204); res.end(); return;
        }
        if (req.url === '/experts/cancel') {
          const run = expertRuns.get(value.runId);
          if (run) run.abort(new Error('experts cancelled by user'));
          res.writeHead(204); res.end(); return;
        }
        if (req.url === '/experts') {
          const result = await runExperts(value);
          res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ result })); return;
        }
        if(req.url==='/interrupt'){
          handle.agent.cancel({kind:'user'});
          await handle.agent.whenIdle();res.writeHead(204);res.end();return;
        }
        if(req.url==='/reasoning'){
          if(handle.agent.status!=='idle')throw new Error('reasoning effort can only change while idle');
          const next={...agentOptions,...(value.reasoningEffort==null?{}:{reasoningEffort:value.reasoningEffort})};
          await ctx.llm.resolveCallConfig(next);
          Object.assign(agentOptions,next); selection.current=next;
          if(value.reasoningEffort===undefined) { delete agentOptions.reasoningEffort; delete selection.current.reasoningEffort; }
          res.writeHead(204);res.end();return;
        }
        if(req.url==='/model'){
          if(handle.agent.status!=='idle')throw new Error('model can only change while idle');
          const next={provider:value.model?.providerId,model:value.model?.modelId,...(value.reasoningEffort===undefined?{}:{reasoningEffort:value.reasoningEffort})};
          await ctx.llm.resolveCallConfig(next); Object.assign(agentOptions,next); selection.current=next; if(value.reasoningEffort===undefined) { delete agentOptions.reasoningEffort; delete selection.current.reasoningEffort; } res.writeHead(204);res.end();return;
        }
        if (req.url === '/persona') {
          await configurePersona(value.persona);
          res.writeHead(204); res.end(); return;
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
  // Text an expert streams in the step that ends in a tool call is its
  // execution preamble; it travels with the tool call, not the answer.
  const childText = new Map();
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    const id = String(agent?.session?.id);
    const child = expertChildren.get(id);
    if (!child) return;
    if (frame.type === 'start') { childText.set(id, ''); void postEvent({ type: 'expert-reset', ...child }); }
    if (frame.type === 'chunk' && isTokenDelta(frame.chunk) && frame.chunk.type === 'text-delta' && frame.chunk.text) { childText.set(id, (childText.get(id) || '') + frame.chunk.text); void postEvent({ type: 'expert-delta', ...child, delta: frame.chunk.text }); }
  });
  ctx.on('session/event', (eventSession, event) => {
    const id = String(eventSession?.id);
    const child = expertChildren.get(id);
    if (!child) return;
    if (event.type === 'tool/call') {
      const preamble = (childText.get(id) || '').trim().slice(0, 4000); childText.set(id, '');
      void postEvent({ type: 'expert-tool', ...child, callId: String(event.data?.callId ?? ''), name: String(event.data?.name || 'tool').slice(0, 120), argumentsPreview: previewValue(event.data?.arguments), ...(preamble ? { preamble } : {}) });
    }
    if (event.type === 'tool/result') {
      const result = event.data?.message?.content?.find((block) => block.type === 'tool-result');
      if (result) void postEvent({ type: 'expert-tool-result', ...child, callId: String(result.toolCallId), isError: !!result.isError });
    }
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
  ctx.effect(() => async () => { for (const run of expertRuns.values()) run.abort(new Error('session closing')); for (const entry of pendingApprovals.values()) entry.resolve('cancelled'); pendingApprovals.clear(); await handle?.dispose().catch(() => {}); await new Promise((resolve) => server.close(() => resolve())); }, 'sciencescope.session-control');
}

export default { name, inject, apply };
