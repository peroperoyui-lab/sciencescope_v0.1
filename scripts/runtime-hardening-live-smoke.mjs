// Opt-in provider/runtime smoke. Only the tiny turn (and optional --long turn)
// reaches OpenCode Go/deepseek-v4.1-flash through the existing host-side proxy.
// The unknown-model error uses a localhost fixture, never another paid model.
// Usage: node scripts/runtime-hardening-live-smoke.mjs --live [--long]
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {createContextLiveHarness} from './evals/context-live-harness.mjs';

const harness=await createContextLiveHarness('runtime-hardening',{
  maxRequests:process.argv.includes('--long')?4:2,
  maxTokens:process.argv.includes('--long')?1024:128,evidenceFile:'hardening-result.json',
});
const {root,host,model,evidence}=harness;
const workspace=path.join(root,'workspace');
let fixtureRequests=0;
const fixture=createServer((req,res)=>{
  fixtureRequests++;req.resume();
  res.writeHead(404,{'content-type':'application/json'});
  res.end(JSON.stringify({error:{message:'Synthetic model not found',type:'model_not_found'}}));
});
const results=[];
const step=async(name,fn)=>{
  const start=Date.now();
  try{results.push({name,ok:true,detail:await fn(),ms:Date.now()-start});}
  catch(error){results.push({name,ok:false,detail:error.code||error.name||'ERROR',ms:Date.now()-start});}
};
try{
  await mkdir(workspace);
  await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
  await step('tiny real-provider turn',async()=>{
    const runtimeConfig=await host.getRuntimeConfig();
    const sessionId=await host.startSession({model,workspace,runtimeConfig,noTools:true});
    const result=await host.send({sessionId,text:'Reply with exactly: SCIENCESCOPE_LIVE_OK'});
    assert.ok(result.finalResponse.includes('SCIENCESCOPE_LIVE_OK'),'provider sentinel received');
    assert.ok(evidence.requests.every(request=>request.localAuth==='synthetic'),'SDK sends only a synthetic localhost credential');
    return 'sentinel received';
  });
  await step('localhost unknown-model error is categorised',async()=>{
    const runtimeConfig={providers:{fixture:{api:'openai-completions',
      baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,
      apiKeyEnv:'SCIENCESCOPE_EVAL_KEY',
      models:[{id:'sciencescope-does-not-exist',contextWindow:65536,maxTokens:128}],
    }}};
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'sciencescope-does-not-exist'},workspace,runtimeConfig,noTools:true});
    await assert.rejects(host.send({sessionId,text:'Synthetic error fixture only.'}),/DSH model request failed/);
    assert.ok(fixtureRequests>0,'the local rejection was contacted');
    return 'categorised synthetic 404';
  });
  if(process.argv.includes('--long'))await step('turn longer than 5 minutes',async()=>{
    const runtimeConfig=await host.getRuntimeConfig();
    const sessionId=await host.startSession({model,workspace,runtimeConfig});
    await host.configurePolicy({sessionId,approvalPolicy:'never',sandboxMode:'workspace-write'});
    const result=await host.send({sessionId,text:'Use your shell tool to run exactly `sleep 330 && echo SLEPT` (one call, do not background it). After it finishes reply with exactly: SCIENCESCOPE_LONG_OK'});
    assert.ok(result.finalResponse.includes('SCIENCESCOPE_LONG_OK'),'long-turn sentinel received');
    return 'completed after long tool call';
  });
}finally{
  fixture.closeAllConnections();await new Promise(resolve=>fixture.close(()=>resolve()));
  evidence.checks.hardening=results;evidence.localFixtureRequests=fixtureRequests;
  await harness.close();
}
console.log(JSON.stringify({results,fixtureRequests,paidRequests:evidence.forwardedRequests,usage:evidence.usage,root}));
process.exitCode=results.every(result=>result.ok)?0:1;
