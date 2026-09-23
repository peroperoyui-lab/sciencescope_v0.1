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

const STREAM_PLUGIN = fileURLToPath(new URL('./assistant-stream-bridge.mjs', import.meta.url));
const CONTROL_PLUGIN = pathToFileURL(fileURLToPath(new URL('./session-control.mjs', import.meta.url))).href;
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
  const observers = new Map();
  const streamReceivers = new Map();
  const streamServer = createServer((request, response) => {
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

  async function startSession({ model, workspace, runtimeConfig, sessionId: requestedSessionId, noTools = false, persona, proposalTargetChatId } = {}) {
    if (!model?.providerId || !model?.modelId) throw new TypeError('model.providerId and model.modelId are required');
    if (model.reasoningEffort !== undefined && (typeof model.reasoningEffort !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/u.test(model.reasoningEffort))) {
      throw new TypeError('model.reasoningEffort must be a non-empty DSH reasoning-effort id');
    }
    const sessionId = requestedSessionId ?? ('session-'+randomUUID().replaceAll('-',''));
    if (typeof sessionId !== 'string' || !/^session-[A-Za-z0-9]+$/u.test(sessionId)) throw new TypeError('sessionId must be a stable DSH session identity');
    const key = sessionId;
    if (sessions.has(sessionId)) return sessionId;
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
    try {
    const research = await createResearchContextPatch({home:options.home,workspace:workspace ?? cwd,persona});
    patches.push(research.patchPath);
    const launchPatchId = randomUUID();
    const streamPatch = join(options.home, 'session-patches', sessionId+'.'+launchPatchId+'.assistant-stream.json');
    await mkdir(join(options.home, 'session-patches'), { recursive: true });
    await writeFile(streamPatch, JSON.stringify([{ insert: [{ id: 'assistant-stream-bridge', name: pathToFileURL(STREAM_PLUGIN).href }, { id: 'session-control', name: CONTROL_PLUGIN }] }]), {flag:'wx'});
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
    } catch (error) { streamReceivers.delete(sessionId); throw error; }
    let harness = harnesses.get(key);
    if (!harness) {
      harness = new sdk.DeepSeekHarness({
        ...(options.dshBin ? { dshBin: options.dshBin } : {}),
        profile: 'sdk',
        initializeTimeoutMs:30000,
        patches,
        dshHome: options.home,
        processCwd: workspace ?? cwd,
        env: { ...env, SCIENCESCOPE_STREAM_ENDPOINT: streamEndpoint, SCIENCESCOPE_STREAM_TOKEN: streamToken, SCIENCESCOPE_STREAM_SESSION: sessionId, SCIENCESCOPE_PROVIDER: model.providerId, SCIENCESCOPE_MODEL: model.modelId, ...(persona === undefined ? {} : { SCIENCESCOPE_PERSONA: persona }), ...(proposalTargetChatId ? { SCIENCESCOPE_PROPOSAL_TARGET_CHAT_ID: proposalTargetChatId } : {}), ...(noTools ? { SCIENCESCOPE_NO_TOOLS: '1' } : {}) },
        cwd: workspace ?? cwd,
        provider: model.providerId,
        model: model.modelId,
        ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
      });
      harnesses.set(key, harness);
    }
    try { await harness.start(); }
    catch(error) {
      harnesses.delete(key); streamReceivers.delete(sessionId);
      await harness.close().catch(()=>{}); throw error;
    }
    let timer;
    try { await Promise.race([streamReceivers.get(sessionId).controlReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DSH session control did not become ready')), 15000); })]); }
    catch (error) { await harness.close().catch(() => {}); harnesses.delete(key); sessions.delete(key); streamReceivers.delete(key); throw error; }
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
    let lastFailure;
    receiver.onMessage = (message) => {
      if (message.type === 'attempt-failed') lastFailure = message;
      if (message.type === 'control-event') {
        if (message.event && typeof message.event === 'object') onEvent?.(message.event);
        return;
      }
      if (message.type === 'run-start') { running = true; drained = false; }
      if(message.type==='tool-call')onEvent?.({type:'tool-call',turn:message.turn,step:message.step,callId:message.callId,name:message.name,argumentsPreview:message.argumentsPreview});
      if(message.type==='tool-result')onEvent?.({type:'tool-result',turn:message.turn,step:message.step,callId:message.callId,isError:message.isError,resultPreview:message.resultPreview});
      if (message.type === 'stream-start') beforeAttempt = visibleText;
      if (message.type === 'text-delta') {
        visibleText += message.delta;
        onEvent?.({ type: 'text-delta', delta: message.delta, committed: false, attemptId: message.attemptId, index: message.index });
      }
      if (message.type === 'stream-end' && message.outcome?.eventType !== 'assistant/message') {
        visibleText = beforeAttempt;
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
    const pending = [...harnesses.values()].map((harness) => harness.close());
    harnesses.clear();
    sessions.clear();
    streamReceivers.clear();
    observers.clear();
    await Promise.allSettled(pending);
    streamServer.closeAllConnections();
    await new Promise((resolve) => streamServer.close(() => resolve()));
  }

  async function releaseSession(sessionId) {
    if (typeof sessionId !== 'string') throw new TypeError('sessionId is required');
    const harness = harnesses.get(sessionId);
    if (!harness) return false;
    await harness.close();
    harnesses.delete(sessionId); sessions.delete(sessionId); streamReceivers.delete(sessionId);
    observers.delete(sessionId);
    return true;
  }

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
  async function interrupt(sessionId) {return control(sessionId,'/interrupt');}
  async function replyApproval({sessionId,requestId,outcome}) {return control(sessionId,'/approval/reply',{requestId,outcome});}
  async function getContextUsage({ sessionId } = {}) { return control(sessionId, '/context-usage'); }
  // Like /prompt, an expert round answers only when every expert settled, so
  // it has no idle timeout; cancelExperts bounds it.
  async function runExperts({ sessionId, runId, prompt, experts, onEvent } = {}) {
    const stop = typeof onEvent === 'function' ? observeSession(sessionId, (frame) => {
      const event = frame.type === 'control-event' ? frame.event : frame;
      if (event?.runId === runId && ['expert-start', 'expert-end', 'expert-delta', 'expert-reset', 'expert-tool'].includes(event.type)) onEvent(event);
    }) : () => {};
    try { return await control(sessionId, '/experts', { runId, prompt, experts }, { timeout: 0 }); }
    finally { stop(); }
  }
  async function cancelExperts({ sessionId, runId } = {}) { return control(sessionId, '/experts/cancel', { runId }); }

  const pause = pauseGoal;
  const resume = resumeGoal;
  return { startSession, send, releaseSession, close, observeSession, sessionGoal, getGoal, pause, resume, pauseGoal, resumeGoal, completeGoal,clearGoal, configurePolicy,configureReasoning,configureModel,configurePersona,interrupt,replyApproval,getContextUsage,runExperts,cancelExperts, capabilities: DSH_CAPABILITIES };
}

export default { createDshHost, DSH_CAPABILITIES };
