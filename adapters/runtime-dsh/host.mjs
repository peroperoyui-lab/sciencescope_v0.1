/**
 * Small ScienceScope boundary around the published DeepSeek Harness SDK.
 *
 * This adapter owns SDK processes only. Provider configuration/discovery is
 * deliberately not implemented here: the SDK exposes an exact provider/model
 * route at initialize time, not a provider CRUD API.
 */

const SDK_PACKAGE = '@deepseek-ai/dsh-sdk-client';
const LLM_PACKAGE = '@deepseek-ai/dsh-llm';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createResearchContextPatch } from './research-context.mjs';
import { createSessionProcessEnv, sessionEnvSignature } from './session-env.mjs';
import { createApplicationApprovalManager } from './application-approval.mjs';
import { getProtectedCredentialPaths, prepareCredentialIsolation, registeredProviderKeyEnv } from './credential-isolation.mjs';

const STREAM_PLUGIN = fileURLToPath(new URL('./assistant-stream-bridge.mjs', import.meta.url));
const CONTROL_PLUGIN = pathToFileURL(fileURLToPath(new URL('./session-control.mjs', import.meta.url))).href;
const SECRET_ENV_PLUGIN = new URL('./credential-isolation.mjs', import.meta.url).href;
const PROTECTED_PATH_PLUGIN = new URL('./protected-path-policy.mjs', import.meta.url).href;
const TURN_TIMEOUT_MS = 300000;
const STREAM_TIMEOUT_MS = 2500;

async function loadSdk() {
  try {
    return await import(SDK_PACKAGE);
  } catch (error) {
    throw new Error(
      `DeepSeek Harness SDK is unavailable. Install ${SDK_PACKAGE}@0.1.6-alpha.1 in the desktop host environment.`,
      { cause: error },
    );
  }
}

async function loadReasoningEffortId() {
  try {
    return (await import(LLM_PACKAGE)).ReasoningEffortId;
  } catch (error) {
    throw new Error('DeepSeek Harness LLM types are unavailable; reasoning effort cannot be enabled.', { cause: error });
  }
}

export const DSH_CAPABILITIES = Object.freeze({
  runtime: true,
  sessions: true,
  committedMessageEvents: true,
  committedTextStreaming: true,
  tokenStreaming: true,
  reasoningEffort: true,
  providerSave: false,
  providerDiscover: false,
});

/**
 * @param {{home?: string, cwd?: string, dshBin?: string, env?: object}} options
 */
export async function createDshHost(options = {}) {
  const sdk = await loadSdk();
  const ReasoningEffortId = await loadReasoningEffortId();
  if (!options.home) throw new TypeError('createDshHost requires home');
  const credentialPath = await prepareCredentialIsolation(options);
  const protectedPaths = [...new Set([...(options.protectedPaths ?? []), ...getProtectedCredentialPaths({ ...options, credentialPath }), join(options.home, 'session-patches'), join(options.home, 'sessions'), join(options.home, 'settings.yaml'), join(options.home, '.env')])];
  const cwd = options.cwd ?? options.home;
  const localRoot = join(options.home, '.sciencescope-local');
  const localTemp = join(localRoot, 'temp');
  const localCache = join(localRoot, 'cache');
  await mkdir(localTemp, { recursive: true });
  await mkdir(localCache, { recursive: true });
  const env = {
    ...process.env,
    DSH_AGENTS_HOME: join(options.home,'agents-home'),
    TEMP: localTemp,
    TMP: localTemp,
    npm_config_cache: localCache,
    ...(options.env ?? {}),
  };
  const harnesses = new Map();
  const sessions = new Map();
  const sessionEnvSignatures = new Map();
  const observers = new Map();
  const streamReceivers = new Map();
  const sessionIdleWaiters = new Map();
  const releasingSessions = new Set();
  const expertRuns = new Map();
  const applicationApprovals = createApplicationApprovalManager({
    isSessionActive: (sessionId) => sessions.has(sessionId) && !releasingSessions.has(sessionId),
    emit: (sessionId, event) => {
      const frame = { type: 'control-event', event };
      for (const observer of observers.get(sessionId) ?? []) {
        try { observer(frame); } catch { /* A UI observer cannot strand an application tool approval. */ }
      }
    },
  });
  // Application tools (e.g. research_search) run inside the DSH child but need
  // host data. The child posts {token, sessionId, name, args} to /host-call and
  // waits for the JSON answer; the host application installs the handler.
  let toolHandler = null;
  const streamServer = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/host-call') {
      let body = ''; request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; if (body.length > 1024*1024) request.destroy(); });
      request.on('end', async () => {
        const reply = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
        try {
          const message = JSON.parse(body);
          const receiver = streamReceivers.get(message.sessionId);
          if (!receiver || message.token !== receiver.token) { reply(401, { error: 'unauthorized' }); return; }
          if (typeof message.name !== 'string' || !/^[a-z_]{1,60}$/u.test(message.name)) throw new Error('invalid tool name');
          if (!toolHandler && message.name !== '__protected_path_approval') { reply(503, { error: 'This application tool is not available in this session.' }); return; }
          const controller = new AbortController();
          const onClose = () => { if (!response.writableEnded) controller.abort(new Error('DSH tool call disconnected')); };
          response.once('close', onClose);
          try {
            const call = { sessionId: message.sessionId, name: message.name, args: message.args ?? {}, callId: typeof message.callId === 'string' ? message.callId.slice(0, 200) : undefined, expertId: typeof message.expertId === 'string' ? message.expertId.slice(0, 80) : undefined, signal: controller.signal };
            let result;
            if (message.name === '__protected_path_approval') {
              if (!['bash','pwsh','run_code'].includes(call.args.toolName) || call.args.classification !== 'protected-path') throw new TypeError('Invalid protected path approval');
              result = { allowed: await applicationApprovals.request({sessionId:call.sessionId,toolName:call.args.toolName,classification:'protected-path',commandSummary:call.args.commandSummary,reason:'涉及应用内部数据：此命令需要单独确认。',expertId:call.expertId,signal:call.signal}) };
            } else result = await toolHandler(call);
            if (!controller.signal.aborted && !response.destroyed) reply(200, { result });
          } finally { response.off('close', onClose); }
        } catch (error) { if (!response.destroyed && !response.writableEnded) reply(200, { error: String(error?.message ?? error).slice(0, 2000) }); }
      });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/assistant-stream') { response.writeHead(404); response.end(); return; }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; if (body.length > 2*1024*1024) request.destroy(); });
    request.on('end', () => {
      try {
        if (body.length > 2*1024*1024) throw new Error('control frame too large');
        const message = JSON.parse(body);
        const receiver = streamReceivers.get(message.sessionId);
        if (!receiver || message.token !== receiver.token) { response.writeHead(401); response.end(); return; }
        if (message.type !== 'control-ready' && message.type !== 'control-error' && message.type !== 'control-event') {
          // Reject replays, but tolerate a gap: the bridge drops a frame on a
          // transient POST error and never resends it. Rejecting every later
          // frame would lose run-idle and fail the whole turn.
          if (!Number.isInteger(message.sequence) || message.sequence <= receiver.sequence) throw new Error('Stream frame replayed');
          if (message.sequence !== receiver.sequence + 1) receiver.gaps = (receiver.gaps ?? 0) + 1;
          receiver.sequence = message.sequence;
        }
        if (message.type === 'run-start') receiver.runState = 'running';
        if (message.type === 'run-idle') receiver.runState = 'idle';
        if (message.type !== 'control-ready' && message.type !== 'control-error') {
          for (const observer of observers.get(message.sessionId) ?? []) observer(message);
        }
        receiver.onMessage(message); response.writeHead(204); response.end();
      } catch { response.writeHead(400); response.end(); }
    });
  });
  await new Promise((resolve, reject) => { streamServer.once('error', reject); streamServer.listen(0, '127.0.0.1', resolve); });
  const streamAddress = streamServer.address();
  const streamEndpoint = `http://127.0.0.1:${streamAddress.port}/assistant-stream`;

  async function startSession({ model, workspace, runtimeConfig, sessionId: requestedSessionId, noTools = false, persona, proposalTargetChatId, sessionEnv = {}, maxTokens } = {}) {
    if (!model?.providerId || !model?.modelId) throw new TypeError('model.providerId and model.modelId are required');
    if (maxTokens !== undefined && (!Number.isSafeInteger(maxTokens) || maxTokens < 1)) throw new TypeError('maxTokens must be a positive safe integer');
    if (model.reasoningEffort !== undefined && (typeof model.reasoningEffort !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/u.test(model.reasoningEffort))) {
      throw new TypeError('model.reasoningEffort must be a non-empty DSH reasoning-effort id');
    }
    const sessionId = requestedSessionId ?? ('session-'+randomUUID().replaceAll('-',''));
    if (typeof sessionId !== 'string' || !/^session-[A-Za-z0-9]+$/u.test(sessionId)) throw new TypeError('sessionId must be a stable DSH session identity');
    const key = sessionId;
    const requestedEnvSignature = sessionEnvSignature(sessionEnv);
    const providerKeyEnv = await registeredProviderKeyEnv(options.home, runtimeConfig);
    const explicitProviderKeys = providerKeyEnv.filter(ref => Object.keys(options.env ?? {}).some(key => key.toLowerCase() === ref.toLowerCase()));
    // Explicit localhost fixture tokens may enter the frozen credential snapshot;
    // the hygiene plugin strips them before any shell executes. Remote keys never do.
    const allowedProviderKeyEnv = explicitProviderKeys.filter(ref => Object.values(runtimeConfig?.providers ?? {}).filter(provider => provider?.apiKeyEnv?.toLowerCase() === ref.toLowerCase()).every(provider => {
      try { const url = new URL(provider.baseURL); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol); } catch { return false; }
    }) && Object.values(runtimeConfig?.providers ?? {}).some(provider => provider?.apiKeyEnv?.toLowerCase() === ref.toLowerCase()));
    const sessionProcessEnv = createSessionProcessEnv(env, sessionEnv, { providerKeyEnv, allowedProviderKeyEnv });
    if (sessions.has(sessionId)) {
      if (sessionEnvSignatures.get(sessionId) !== requestedEnvSignature) {
        const error = new Error('The DSH session already uses a different Python environment; releaseSession before restarting it.');
        error.code = 'SESSION_ENV_CHANGED_RELEASE_REQUIRED';
        throw error;
      }
      return sessionId;
    }
    if (sessionEnvSignatures.has(sessionId)) throw new Error(`DSH session is already starting: ${sessionId}`);
    if (harnesses.has(sessionId)) throw new Error(`DSH session is already starting: ${sessionId}`);
    const patches = [];
    const streamToken = randomUUID()+randomUUID();
    let readyResolve; let readyReject;
    const controlReady = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    // control-error can arrive while harness.start() is still pending, before
    // the race below observes this promise. An unobserved rejection terminates
    // the whole desktop host process, so mark it handled here; every consumer
    // still awaits controlReady and receives the rejection.
    controlReady.catch(() => {});
    streamReceivers.set(sessionId, { token: streamToken, sequence:0, controlReady, onMessage: (message) => {
      if (message.type === 'control-ready') readyResolve(message);
      if (message.type === 'control-error') readyReject(new Error(message.error));
    } });
    sessionEnvSignatures.set(sessionId, requestedEnvSignature);
    try {
    const research = await createResearchContextPatch({home:options.home,workspace:workspace ?? cwd,persona});
    patches.push(research.patchPath);
    const launchPatchId = randomUUID();
    const streamPatch = join(options.home, 'session-patches', sessionId+'.'+launchPatchId+'.assistant-stream.json');
    await mkdir(join(options.home, 'session-patches'), { recursive: true });
    await writeFile(streamPatch, JSON.stringify([{ id: 'credentials', config: { path: credentialPath } }, { insert: [{ id: 'sciencescope-credential-env-hygiene', name: SECRET_ENV_PLUGIN, config: { providerKeyEnv } }, { id: 'assistant-stream-bridge', name: pathToFileURL(STREAM_PLUGIN).href }, { id: 'session-control', name: CONTROL_PLUGIN }, { id: 'sciencescope-protected-path-policy', name: PROTECTED_PATH_PLUGIN, config: { protectedPaths } }] }]), {flag:'wx'});
    patches.push(streamPatch);
    if (options.sessionHeaders?.length) {
      const config = structuredClone(runtimeConfig);
      const provider = config?.providers?.[model.providerId];
      if (!provider) throw new Error('Session headers require a resolved provider configuration');
      provider.headers = {...provider.headers};
      for (const header of options.sessionHeaders) {
        if (!/^[A-Za-z0-9-]+$/.test(header)) throw new Error('Invalid session header name');
        if (provider.headers[header]) throw new Error('A configured header conflicts with the session header');
        provider.headers[header] = sessionId;
      }
      const directory = join(options.home,'session-patches');
      await mkdir(directory,{recursive:true});
      const patch = join(directory,sessionId+'.'+launchPatchId+'.yaml');
      await writeFile(patch,JSON.stringify([{id:'llm-pi-ai',config}]),{flag:'wx'});
      patches.push(patch);
    }
    } catch (error) { streamReceivers.delete(sessionId); sessionEnvSignatures.delete(sessionId); throw error; }
    let harness = harnesses.get(key);
    if (!harness) {
      harness = new sdk.DeepSeekHarness({
        ...(options.dshBin ? { dshBin: options.dshBin } : {}),
        profile: 'sdk',
        initializeTimeoutMs:30000,
        patches,
        dshHome: options.home,
        processCwd: workspace ?? cwd,
        env: { ...sessionProcessEnv, SCIENCESCOPE_STREAM_ENDPOINT: streamEndpoint, SCIENCESCOPE_HOST_CALL_ENDPOINT: streamEndpoint.replace(/\/assistant-stream$/u, '/host-call'), SCIENCESCOPE_STREAM_TOKEN: streamToken, SCIENCESCOPE_STREAM_SESSION: sessionId, SCIENCESCOPE_PROVIDER: model.providerId, SCIENCESCOPE_MODEL: model.modelId, ...(persona === undefined ? {} : { SCIENCESCOPE_PERSONA: persona }), ...(proposalTargetChatId ? { SCIENCESCOPE_PROPOSAL_TARGET_CHAT_ID: proposalTargetChatId } : {}), ...(noTools ? { SCIENCESCOPE_NO_TOOLS: '1' } : {}), ...(maxTokens === undefined ? {} : { SCIENCESCOPE_MAX_TOKENS: String(maxTokens) }) },
        cwd: workspace ?? cwd,
        provider: model.providerId,
        model: model.modelId,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
        ...(maxTokens === undefined ? {} : { maxTokens }),
      });
      harnesses.set(key, harness);
    }
    try { await harness.start(); }
    catch(error) {
      harnesses.delete(key); streamReceivers.delete(sessionId); sessionEnvSignatures.delete(sessionId);
      await harness.close().catch(()=>{}); throw error;
    }
    let timer;
    try { await Promise.race([streamReceivers.get(sessionId).controlReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DSH session control did not become ready')), 15000); })]); }
    catch (error) { await harness.close().catch(() => {}); harnesses.delete(key); sessions.delete(key); streamReceivers.delete(key); sessionEnvSignatures.delete(key); throw error; }
    finally { clearTimeout(timer); }
    harness.session(sessionId);
    sessions.set(sessionId, harness);
    return sessionId;
  }

  async function send({ sessionId, text, onEvent } = {}) {
    const harness = sessions.get(sessionId);
    if (!harness) throw new Error(`Unknown DSH session: ${sessionId}`);
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('text is required');
    onEvent?.({ type: 'accepted', sessionId });
    const receiver = streamReceivers.get(sessionId);
    if (!receiver) throw new Error(`Unknown DSH stream receiver: ${sessionId}`);
    let drained = false;
    let running = false;
    let visibleText = '';
    let beforeAttempt = '';
    let toolBoundary = 0;
    let lastFailure;
    receiver.onMessage = (message) => {
      if (message.type === 'attempt-failed') lastFailure = message;
      if (message.type === 'control-event') {
        if (message.event && typeof message.event === 'object') onEvent?.(message.event);
        return;
      }
      if (message.type === 'run-start') { running = true; drained = false; }
      // Text the model wrote right before a tool call is an execution preamble
      // ("I'll read the draft first"): it belongs to that call's activity card,
      // not to the answer. The answer keeps only text outside such preambles.
      if(message.type==='tool-call'){
        const start=Math.max(beforeAttempt.length,toolBoundary);
        const preamble=visibleText.slice(start).trim();
        if(preamble){visibleText=visibleText.slice(0,start);onEvent?.({type:'text-replace',text:visibleText});}
        toolBoundary=visibleText.length;
        onEvent?.({type:'tool-call',turn:message.turn,step:message.step,callId:message.callId,name:message.name,argumentsPreview:message.argumentsPreview,...(preamble?{preamble:preamble.slice(0,4000)}:{})});
      }
      if(message.type==='tool-result')onEvent?.({type:'tool-result',turn:message.turn,step:message.step,callId:message.callId,isError:message.isError,resultPreview:message.resultPreview});
      if (message.type === 'stream-start') beforeAttempt = visibleText;
      if (message.type === 'text-delta') {
        visibleText += message.delta;
        onEvent?.({ type: 'text-delta', delta: message.delta, committed: false, attemptId: message.attemptId, index: message.index });
      }
      if (message.type === 'stream-end' && message.outcome?.eventType !== 'assistant/message') {
        visibleText = beforeAttempt;
        toolBoundary = Math.min(toolBoundary, visibleText.length);
        onEvent?.({type:'text-replace',text:visibleText});
      }
      // This queued barrier is after ALL attempts/tool-loop steps, not merely
      // the first attempt's end. SDK idle may arrive before the HTTP queue.
      if (message.type === 'run-idle' && running) drained = true;
    };
    try {
      const control = await receiver.controlReady;
      const controlUrl = new URL(control.controlEndpoint);
      const body = JSON.stringify({ token: receiver.token, sessionId, text });
      await new Promise((resolve, reject) => {
        // /prompt answers only when the whole agent turn is idle, so the socket
        // is legitimately silent for the full turn. Research turns with tool
        // loops routinely exceed any fixed idle timeout; a timeout here would
        // report failure while DSH keeps working. The turn is bounded instead
        // by the user's Stop (/interrupt) and by child-process exit (socket error).
        const req = request({ hostname: controlUrl.hostname, port: controlUrl.port, path: controlUrl.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (response) => { response.resume(); response.statusCode === 204 ? resolve() : reject(new Error(`DSH session control failed: HTTP ${response.statusCode}`)); });
        req.on('error', reject); req.end(body);
      });
      const deadline = Date.now() + STREAM_TIMEOUT_MS;
      while (!drained && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
      if (!drained) throw new Error('DSH assistant stream did not finish delivery');
      const result = { sessionId, finalResponse: visibleText, events: [], notifications: [] };
      if (!result.finalResponse?.trim()) {
        throw new Error(lastFailure ? `DSH model request failed (${lastFailure.code}): ${lastFailure.message}` : 'DSH run ended without a final text response', lastFailure ? { cause: { code: lastFailure.code } } : undefined);
      }
      onEvent?.({ type: 'completed', sessionId, text: result.finalResponse, committed: true });
      return result;
    } finally { receiver.onMessage = () => {}; }
  }

  async function close() {
    applicationApprovals.cancelAll('host closing');
    for (const [sessionId] of sessionIdleWaiters) cancelSessionIdleWaiters(sessionId, new Error('DSH host is closing'));
    const pending = [...harnesses.values()].map((harness) => harness.close());
    harnesses.clear();
    sessions.clear();
    sessionEnvSignatures.clear();
    expertRuns.clear();
    streamReceivers.clear();
    observers.clear();
    await Promise.allSettled(pending);
    streamServer.closeAllConnections();
    await new Promise((resolve) => streamServer.close(() => resolve()));
  }

  async function releaseSession(sessionId) {
    if (typeof sessionId !== 'string') throw new TypeError('sessionId is required');
    releasingSessions.add(sessionId);
    cancelSessionIdleWaiters(sessionId, new Error('DSH session was released while waiting for idle'));
    applicationApprovals.cancelSession(sessionId, 'session released');
    const harness = harnesses.get(sessionId);
    if (!harness) { releasingSessions.delete(sessionId); return false; }
    try { await harness.close(); }
    finally {
      harnesses.delete(sessionId); sessions.delete(sessionId); streamReceivers.delete(sessionId);
      sessionEnvSignatures.delete(sessionId); observers.delete(sessionId); releasingSessions.delete(sessionId);
    }
    return true;
  }

  // Conversation branching (T12): completed-turn boundaries, and a persisted
  // child session resumable with startSession({sessionId}).
  async function sessionTurns({sessionId}) { return control(sessionId, '/turns', {}, { timeout: 30000 }); }
  async function forkSession({sessionId, atSeq}) { return control(sessionId, '/fork', atSeq === undefined ? {} : { atSeq }, { timeout: 60000 }); }

  async function control(sessionId, path, payload = {}, { timeout = TURN_TIMEOUT_MS } = {}) {
    const receiver = streamReceivers.get(sessionId);
    if (!receiver) throw new Error(`Unknown DSH session: ${sessionId}`);
    const control = await receiver.controlReady;
    const controlUrl = new URL(control.controlEndpoint);
    const body = JSON.stringify({ token: receiver.token, sessionId, ...payload });
    return new Promise((resolve, reject) => {
      const req = request({ hostname: controlUrl.hostname, port: controlUrl.port, path, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, ...(timeout ? { timeout } : {}) }, (response) => {
        let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; }); response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) { try { resolve(text ? JSON.parse(text).result : undefined); } catch { resolve(undefined); } }
          else reject(new Error(`DSH session control failed: HTTP ${response.statusCode} ${text}`));
        });
      });
      req.on('error', reject);
      // Node's default agent gives every socket a 5s idle timeout and only
      // emits 'timeout'; a request meant to wait for a whole turn must not
      // treat that as fatal, so the handler exists only with an explicit timeout.
      if (timeout) req.on('timeout', () => req.destroy(new Error('DSH session control timed out')));
      req.end(body);
    });
  }

  function observeSession(sessionId, onEvent) {
    if (typeof onEvent !== 'function') throw new TypeError('onEvent is required');
    const set = observers.get(sessionId) ?? new Set(); set.add(onEvent); observers.set(sessionId, set);
    return () => { set.delete(onEvent); if (!set.size) observers.delete(sessionId); };
  }

  function cancelSessionIdleWaiters(sessionId, error) {
    for (const cancel of sessionIdleWaiters.get(sessionId) ?? []) cancel(error);
  }
  function waitForSessionIdle(sessionId, { timeout = 30000 } = {}) {
    const receiver = streamReceivers.get(sessionId);
    if (!receiver) return Promise.reject(new Error(`Unknown DSH session: ${sessionId}`));
    if (receiver.runState !== 'running') return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); stop();
        const waiters = sessionIdleWaiters.get(sessionId); waiters?.delete(cancel);
        if (!waiters?.size) sessionIdleWaiters.delete(sessionId);
        error ? reject(error) : resolve();
      };
      const cancel = (error) => finish(error);
      const stop = observeSession(sessionId, (frame) => { if (frame.type === 'run-idle') finish(); });
      const waiters = sessionIdleWaiters.get(sessionId) ?? new Set(); waiters.add(cancel); sessionIdleWaiters.set(sessionId, waiters);
      const timer = setTimeout(() => finish(new Error('DSH session did not become idle before the timeout')), timeout);
      if (receiver.runState !== 'running') finish();
    });
  }

  async function sessionGoal({ sessionId, objective, maxGoalRounds } = {}) { return control(sessionId, '/goal', { action: 'create', objective, ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) }); }
  async function getGoal(sessionId) { return control(sessionId, '/goal', { action: 'get' }); }
  async function pauseGoal({ sessionId, ref } = {}) { return control(sessionId, '/goal', { action: 'pause', ref }); }
  async function resumeGoal({ sessionId, ref } = {}) { return control(sessionId, '/goal', { action: 'resume', ref }); }
  async function completeGoal({ sessionId, ref } = {}) { return control(sessionId, '/goal', { action: 'complete', ref }); }
  async function clearGoal({sessionId,ref}={}){return control(sessionId,'/goal',{action:'clear',ref});}
  async function configurePolicy({ sessionId, approvalPolicy, sandboxMode } = {}) { return control(sessionId, '/policy', { approvalPolicy, sandboxMode }); }
  async function configureReasoning({sessionId,reasoningEffort}) { return control(sessionId,'/reasoning',{reasoningEffort}); }
  async function configureModel({sessionId,model,reasoningEffort}) { return control(sessionId,'/model',{model,reasoningEffort}); }
  async function configurePersona({sessionId,persona}) { return control(sessionId, '/persona', { persona }); }
  // Project brief (core memory): a system-prompt section, replaced between turns.
  async function configureBrief({sessionId,text}) { return control(sessionId, '/brief', { text: typeof text === 'string' ? text : '' }); }
  function setToolHandler(handler) { toolHandler = typeof handler === 'function' ? handler : null; }
  async function requestApplicationApproval(request) { return applicationApprovals.request(request); }
  async function interrupt(sessionId) { applicationApprovals.cancelSession(sessionId, 'session interrupted'); return control(sessionId,'/interrupt'); }
  async function scheduleSessionEnvRefresh(sessionId) { return control(sessionId, '/python-env/refresh'); }
  async function replyApproval({sessionId,requestId,outcome}) {
    const applicationReply = applicationApprovals.reply({sessionId, requestId, outcome});
    if (applicationReply !== null) return applicationReply;
    return control(sessionId,'/approval/reply',{requestId,outcome});
  }
  async function getContextUsage({ sessionId } = {}) { return control(sessionId, '/context-usage'); }
  // Like /prompt, an expert round answers only when every expert settled, so
  // it has no idle timeout; cancelExperts bounds it.
  async function runExperts({ sessionId, runId, prompt, experts, onEvent } = {}) {
    const runKey = `${sessionId}:${runId}`;
    expertRuns.set(runKey, new Set((experts ?? []).map((expert) => expert?.id).filter((id) => typeof id === 'string')));
    const stop = typeof onEvent === 'function' ? observeSession(sessionId, (frame) => {
      const event = frame.type === 'control-event' ? frame.event : frame;
      if (event?.runId === runId && ['expert-start', 'expert-end', 'expert-delta', 'expert-reset', 'expert-tool', 'expert-tool-result'].includes(event.type)) onEvent(event);
    }) : () => {};
    try { return await control(sessionId, '/experts', { runId, prompt, experts }, { timeout: 0 }); }
    finally { stop(); expertRuns.delete(runKey); }
  }
  async function cancelExperts({ sessionId, runId } = {}) {
    applicationApprovals.cancelExperts(sessionId, expertRuns.get(`${sessionId}:${runId}`), 'expert run cancelled');
    return control(sessionId, '/experts/cancel', { runId });
  }

  const pause = pauseGoal;
  const resume = resumeGoal;
  return { startSession, send, releaseSession, sessionTurns, forkSession, close, observeSession, waitForSessionIdle, sessionGoal, getGoal, pause, resume, pauseGoal, resumeGoal, completeGoal,clearGoal, configurePolicy,configureReasoning,configureModel,configurePersona,configureBrief,setToolHandler,requestApplicationApproval,scheduleSessionEnvRefresh,interrupt,replyApproval,getContextUsage,runExperts,cancelExperts, capabilities: DSH_CAPABILITIES };
}

export default { createDshHost, DSH_CAPABILITIES };
