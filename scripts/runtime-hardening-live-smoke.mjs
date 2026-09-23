// Opt-in paid-provider check for the 2026-09-23 runtime hardening. Not part of npm test.
// Key source: SCIENCESCOPE_LIVE_KEY, or the Git-ignored .sciencescope-local/secret/opencode.key.
// The key is passed to DSH through the child environment only; it is never printed or written.
// Usage: node scripts/runtime-hardening-live-smoke.mjs [--long]
//   default: one tiny turn + one nonexistent-model turn (~2 cheap requests)
//   --long:  also one tool turn that sleeps past the old 5-minute /prompt timeout
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

const baseURL = process.env.SCIENCESCOPE_LIVE_BASE_URL || 'https://opencode.ai/zen/go/v1';
const modelId = process.env.SCIENCESCOPE_LIVE_MODEL || 'deepseek-v4.1-flash';
const key = process.env.SCIENCESCOPE_LIVE_KEY || (await readFile(path.resolve('.sciencescope-local/secret/opencode.key'),'utf8')).trim();
const base = path.resolve('.sciencescope-local/temp'); await mkdir(base,{recursive:true});
const root = await mkdtemp(path.join(base,'live-hardening-'));
const models = [modelId,'sciencescope-does-not-exist'].map(id=>({id,contextWindow:65536,maxTokens:1024}));
const runtimeConfig = {providers:{live:{api:'openai-completions',baseURL,apiKeyEnv:'SCIENCESCOPE_LIVE_KEY_ENV',models}}};
const host = await createDshHost({home:root,cwd:root,sessionHeaders:[process.env.SCIENCESCOPE_LIVE_SESSION_HEADER || 'x-opencode-session'],env:{SCIENCESCOPE_LIVE_KEY_ENV:key}});
const results = [];
const step = async (name,fn) => { const t=Date.now(); try { results.push({name,ok:true,detail:await fn(),ms:Date.now()-t}); } catch(error) { results.push({name,ok:false,detail:String(error.message).replaceAll(key,'[redacted]').slice(0,240),ms:Date.now()-t}); } };
try {
  await step('tiny turn', async () => {
    const sessionId = await host.startSession({model:{providerId:'live',modelId},workspace:root,runtimeConfig});
    const r = await host.send({sessionId,text:'Reply with exactly: SCIENCESCOPE_LIVE_OK'});
    if (!r.finalResponse.includes('SCIENCESCOPE_LIVE_OK')) throw new Error('unexpected reply: '+r.finalResponse.slice(0,80));
    return 'sentinel received';
  });
  await step('provider rejects unknown model (expected failure, categorised)', async () => {
    const sessionId = await host.startSession({model:{providerId:'live',modelId:'sciencescope-does-not-exist'},workspace:root,runtimeConfig});
    try { await host.send({sessionId,text:'hi'}); } catch (error) { if (/DSH model request failed/.test(error.message)) return 'categorised: '+error.message.slice(0,120); throw error; }
    throw new Error('unknown model unexpectedly answered');
  });
  if (process.argv.includes('--long')) await step('turn longer than 5 minutes', async () => {
    const sessionId = await host.startSession({model:{providerId:'live',modelId},workspace:root,runtimeConfig});
    await host.configurePolicy({sessionId,approvalPolicy:'never',sandboxMode:'workspace-write'});
    const r = await host.send({sessionId,text:'Use your shell tool to run exactly `sleep 330 && echo SLEPT` (one call, do not background it). After it finishes reply with exactly: SCIENCESCOPE_LONG_OK'});
    if (!r.finalResponse.includes('SCIENCESCOPE_LONG_OK')) throw new Error('unexpected reply: '+r.finalResponse.slice(0,80));
    return 'completed after long tool call';
  });
} finally { await host.close(); await rm(root,{recursive:true,force:true}); }
for (const r of results) console.log(`${r.ok?'PASS':'FAIL'}  ${r.name}  (${Math.round(r.ms/1000)}s)  ${r.detail}`);
process.exitCode = results.every(r=>r.ok) ? 0 : 1;
