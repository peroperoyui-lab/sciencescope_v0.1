import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

test('experts answer one frozen prompt concurrently with their own model and persona',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'experts-runtime-'));const requests=[];let inFlight=0,maxInFlight=0;
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const parsed=JSON.parse(body);requests.push(parsed);
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    await new Promise(r=>setTimeout(r,300));inFlight--;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: {"choices":[{"delta":{"content":"ANSWER_FROM_${parsed.model}"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const model=id=>({id,contextWindow:32768,maxTokens:256});
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[model('main-model'),model('model-a'),model('model-b')]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  try{
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'main-model'},workspace:root,runtimeConfig});
    const events=[];const deltas={};
    const result=await host.runExperts({sessionId,runId:'run-1',prompt:'FROZEN_SHARED_INPUT',onEvent:e=>{events.push(`${e.type}:${e.expertId}`);if(e.type==='expert-delta')deltas[e.expertId]=(deltas[e.expertId]||'')+e.delta;},experts:[
      {id:'alpha',persona:'PERSONA_ALPHA reviewer',model:{providerId:'fixture',modelId:'model-a'},tools:'none'},
      {id:'beta',persona:'PERSONA_BETA reviewer',model:{providerId:'fixture',modelId:'model-b'},tools:'none',prompt:'BETA_ONLY_NOTE'},
    ]});
    assert.deepEqual(result.map(r=>[r.expertId,r.stopReason,r.text]),[['alpha','completed','ANSWER_FROM_model-a'],['beta','completed','ANSWER_FROM_model-b']]);
    assert.equal(requests.length,2);assert.equal(maxInFlight,2,'experts run concurrently');
    for(const entry of result)assert.ok(Number.isInteger(entry.context?.usedTokens)&&entry.context.usedTokens>0,`${entry.expertId} reports its measured context`);
    const byModel=Object.fromEntries(requests.map(r=>[r.model,JSON.stringify(r.messages)]));
    assert.match(byModel['model-a'],/PERSONA_ALPHA/);assert.doesNotMatch(byModel['model-a'],/PERSONA_BETA|BETA_ONLY_NOTE/);
    assert.match(byModel['model-b'],/PERSONA_BETA/);assert.match(byModel['model-b'],/FROZEN_SHARED_INPUT\\n\\nBETA_ONLY_NOTE/);
    assert.deepEqual(events.filter(e=>e.startsWith('expert-end')).sort(),['expert-end:alpha','expert-end:beta']);
    assert.deepEqual(deltas,{alpha:'ANSWER_FROM_model-a',beta:'ANSWER_FROM_model-b'},'live text streams per expert');
    for(const id of ['alpha','beta'])assert.ok(events.lastIndexOf(`expert-delta:${id}`)<events.indexOf(`expert-end:${id}`),'deltas precede the end event');
    await assert.rejects(host.runExperts({sessionId,runId:'run-2',prompt:'x',experts:[{id:'dup',persona:'p'},{id:'dup',persona:'p'}]}),/duplicate expert id/);
    assert.equal(requests.length,2);
  }finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});
