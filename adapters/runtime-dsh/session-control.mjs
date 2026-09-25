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
  // Research Base tools. They run here but answer from the host application
  // (scripts/research-base), which binds each call to this session's chat,
  // project and role; an expert's calls also carry its expert id.
  const hostCallEndpoint = process.env.SCIENCESCOPE_HOST_CALL_ENDPOINT;
  const hostCall = (name, args, exec, agent) => new Promise((resolve, reject) => {
    const child = expertChildren.get(String(agent?.session?.id ?? ''));
    const body = JSON.stringify({ token, sessionId, name, args, callId: exec?.callId, expertId: child?.expertId });
    const target = new URL(hostCallEndpoint);
    const req = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 120000 }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => { try { const value = JSON.parse(text); if (value.error) reject(new Error(value.error)); else resolve(value.result); } catch { reject(new Error(`host tool call failed (HTTP ${res.statusCode})`)); } });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('host tool call timed out'))); req.end(body);
  });
  const jsonOutput = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };
  const refParam = { type: 'object', additionalProperties: false, description: 'A record reference returned by research_search.', properties: { type: { type: 'string', required: true, enum: ['source', 'chunk', 'item'] }, id: { type: 'string', required: true } } };
  const registerResearchTools = (tools, agent) => {
    tools.register(defineTool({
      name: 'research_search',
      description: "Search the user's research base for this project: parsed papers and files (passages with page numbers), sources, and confirmed knowledge, theory models/formulas/algorithms, claims and long-term memory. Keyword search (not semantic): use specific terms, synonyms and abbreviations, and search again with keywords in the other language (Chinese and English) because papers are often in English. Returns cite labels such as [S3 p.4] or [@a1b2c3d4]; cite them verbatim in your answer. Search before answering questions about the project's literature or earlier decisions.",
      parameters: {
        query: { type: 'string', required: true, description: 'Keywords, 1-2000 characters. Several short terms work better than a sentence.' },
        types: { type: 'array', items: { type: 'string', enum: ['chunk', 'source', 'item'] }, description: 'Restrict to passages (chunk), bibliographic sources, or distilled items.' },
        itemTypes: { type: 'array', items: { type: 'string', enum: ['knowledge', 'model', 'memory', 'claim', 'note'] } },
        limit: { type: 'integer', description: 'Maximum hits, 1-20 (default 8).' },
      },
      output: jsonOutput,
      async execute(args, exec) { return hostCall('research_search', args, exec, agent); },
    }));
    tools.register(defineTool({
      name: 'research_read',
      description: 'Read the full text around a research_search hit, a whole source page by page, or a distilled item with its evidence links. Give either ref (from a search hit) or cite (a label like [S3 p.4] or [@a1b2c3d4]).',
      parameters: {
        ref: refParam,
        cite: { type: 'string', description: 'A cite label such as [S3], [S3 p.4] or [@a1b2c3d4].' },
        page: { type: 'integer', description: 'For a source: read this page.' },
        fromOrdinal: { type: 'integer', description: 'For a source: continue from this passage number (nextOrdinal of the previous read).' },
        maxChars: { type: 'integer', description: '500-20000, default 6000.' },
      },
      output: jsonOutput,
      async execute(args, exec) { return hostCall('research_read', args, exec, agent); },
    }));
    tools.register(defineTool({
      name: 'research_propose',
      description: "Propose a change to the user's long-term research base: a new knowledge item, theory model/formula/algorithm, research claim, or memory (decision, convention, goal, open question, preference, lesson); an update or supersession of an existing item; or an evidence link. Nothing is saved until the user accepts it in the memory inbox. Propose only durable, project-relevant information, with evidence refs when you have them.",
      parameters: {
        op: { type: 'string', required: true, enum: ['create', 'update', 'supersede', 'archive', 'link'] },
        item: { type: 'object', additionalProperties: false, description: 'For create/update/supersede.', properties: {
          type: { type: 'string', enum: ['knowledge', 'model', 'memory', 'claim', 'note'] },
          subtype: { type: 'string', description: 'knowledge: finding|definition|method|fact; model: theory|formula|algorithm|statistical-model|protocol; memory: preference|goal|decision|convention|open-question|lesson; claim: hypothesis|claim|conclusion.' },
          title: { type: 'string' }, body: { type: 'string', description: 'Markdown; LaTeX math allowed.' },
          scope: { type: 'string', enum: ['project', 'personal'], description: 'Default: the current project; personal when the chat has no project.' },
          payload: { type: 'json', description: 'Typed details. model: {latex, variables:[{symbol,meaning,unit}], assumptions:[], steps:[], domain}; claim: {statement, claimStatus: hypothesis|supported|contested|refuted|uncertain}.' },
          importance: { type: 'integer', description: '1-5.' },
        } },
        targetId: { type: 'string', description: 'For update/supersede/archive: the item id or its [@handle].' },
        evidence: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { ref: refParam, cite: { type: 'string', description: 'Instead of ref: a cite label such as [S3 p.4] or [@a1b2c3d4].' }, relation: { type: 'string', enum: ['supports', 'contradicts', 'qualifies', 'derived-from', 'about', 'cites'] }, quote: { type: 'string' } } } },
        from: refParam, to: refParam,
        relation: { type: 'string', enum: ['supports', 'contradicts', 'qualifies', 'derived-from', 'defines', 'uses', 'about', 'cites', 'same-as'] },
        rationale: { type: 'string', required: true, description: 'Why this should be remembered; one or two sentences.' },
      },
      output: jsonOutput,
      async execute(args, exec) { return hostCall('research_propose', args, exec, agent); },
    }));
  };
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
    if(hostCallEndpoint)registerResearchTools(agentCtx.tools, null);
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
  // Project brief: a second system-prompt section after the persona, empty
  // until the host sets it. Changed only while idle, like the persona.
  let briefEntry; let currentBrief = '';
  const configureBrief = async (value) => {
    if (handle.agent.status !== 'idle') throw new Error('brief can only change while idle');
    return handle.agent.runMaintenance(async () => {
      if (!briefEntry) {
        if (!promptContext?.systemPrompt) throw new Error('DSH system-prompt service is unavailable');
        const order = promptContext.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX');
        briefEntry = promptContext.systemPrompt.section({ name: 'sciencescope.project-brief', order: typeof order === 'number' ? order + 1 : order, text: () => currentBrief });
      }
      currentBrief = value;
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
    if (req.method !== 'POST' || !['/prompt', '/goal', '/policy', '/reasoning', '/model', '/persona', '/brief', '/interrupt', '/approval/reply', '/context-usage', '/experts', '/experts/cancel'].includes(req.url)) { res.writeHead(404); res.end(); return; }
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
        if (req.url === '/brief') {
          if (typeof value.text !== 'string' || value.text.length > 40000) throw new Error('brief text must be a string up to 40000 characters');
          await configureBrief(value.text);
          res.writeHead(204); res.end(); return;
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
  // Expert subagents are separate agents that do not inherit the parent's
  // registered tools: give each child the research tools when it is created.
  ctx.on('agent/created', ({ agent }) => {
    if (!hostCallEndpoint || String(agent?.session?.id) === sessionId || !agent?.ctx?.tools) return;
    try { registerResearchTools(agent.ctx.tools, agent); } catch { /* a child without a tool registry keeps its defaults */ }
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
