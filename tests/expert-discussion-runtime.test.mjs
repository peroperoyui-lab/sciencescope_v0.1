import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

test('experts answer one frozen prompt concurrently with their own model and persona',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'experts-runtime-'));const requests=[];let inFlight=0,maxInFlight=0;
  // Keep the first response pending until both children have requested their
  // answer. Child startup may exceed 300ms on a loaded machine; a fixed sleep
  // measured that startup timing instead of concurrent execution.
  let releaseAnswers,barrierTimer,bothArrived=false;
  const answersReady=new Promise(resolve=>{releaseAnswers=resolve;});
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const parsed=JSON.parse(body);requests.push(parsed);
    inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
    if(inFlight===1&&!barrierTimer)barrierTimer=setTimeout(()=>releaseAnswers(),10000);
    if(inFlight===2){bothArrived=true;clearTimeout(barrierTimer);releaseAnswers();}
    await answersReady;inFlight--;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: {"choices":[{"delta":{"content":"ANSWER_FROM_${parsed.model}"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const model=id=>({id,contextWindow:32768,maxTokens:256});
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[model('main-model'),model('model-a'),model('model-b'),model('model-legacy')]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  try{
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'main-model'},workspace:root,runtimeConfig});
    const events=[];const deltas={};
    const result=await host.runExperts({sessionId,runId:'run-1',prompt:'FROZEN_SHARED_INPUT',onEvent:e=>{events.push(`${e.type}:${e.expertId}`);if(e.type==='expert-delta')deltas[e.expertId]=(deltas[e.expertId]||'')+e.delta;},experts:[
      {id:'alpha',persona:'PERSONA_ALPHA reviewer',model:{providerId:'fixture',modelId:'model-a'},tools:'none'},
      {id:'beta',persona:'PERSONA_BETA reviewer',model:{providerId:'fixture',modelId:'model-b'},tools:'none',prompt:'BETA_ONLY_NOTE'},
    ]});
    assert.deepEqual(result.map(r=>[r.expertId,r.stopReason,r.text]),[['alpha','completed','ANSWER_FROM_model-a'],['beta','completed','ANSWER_FROM_model-b']]);
    assert.equal(requests.length,2);
    assert.equal(bothArrived,true,'both experts request an answer before either response is released (sequential execution expires the barrier)');
    assert.equal(maxInFlight,2,'experts run concurrently');
    for(const entry of result)assert.ok(Number.isInteger(entry.context?.usedTokens)&&entry.context.usedTokens>0,`${entry.expertId} reports its measured context`);
    const byModel=Object.fromEntries(requests.map(r=>[r.model,JSON.stringify(r.messages)]));
    assert.match(byModel['model-a'],/PERSONA_ALPHA/);assert.doesNotMatch(byModel['model-a'],/PERSONA_BETA|BETA_ONLY_NOTE/);
    assert.match(byModel['model-b'],/PERSONA_BETA/);assert.match(byModel['model-b'],/FROZEN_SHARED_INPUT\\n\\nBETA_ONLY_NOTE/);
    assert.deepEqual(events.filter(e=>e.startsWith('expert-end')).sort(),['expert-end:alpha','expert-end:beta']);
    assert.deepEqual(deltas,{alpha:'ANSWER_FROM_model-a',beta:'ANSWER_FROM_model-b'},'live text streams per expert');
    for(const id of ['alpha','beta'])assert.ok(events.lastIndexOf(`expert-delta:${id}`)<events.indexOf(`expert-end:${id}`),'deltas precede the end event');
    await assert.rejects(host.runExperts({sessionId,runId:'run-2',prompt:'x',experts:[{id:'dup',persona:'p'},{id:'dup',persona:'p'}]}),/duplicate expert id/);
    assert.equal(requests.length,2);
  }finally{clearTimeout(barrierTimer);releaseAnswers();await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});

test('bound expert skills stay with their child and do not change Main skill invocation',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'expert-bound-skills-'));const requests=[];
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const parsed=JSON.parse(body);requests.push(parsed);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end(`data: {"choices":[{"delta":{"content":"ANSWER_FROM_${parsed.model}"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const skillDir=path.join(root,'skills');await mkdir(skillDir,{recursive:true});
  const skill=(name,body)=>`---\nname: ${name}\ndescription: fixture ${name}\n---\n${body}`;
  await writeFile(path.join(skillDir,'bound-alpha.md'),skill('bound-alpha','RUNTIME_ALPHA_BODY'),'utf8');
  await writeFile(path.join(skillDir,'bound-beta.md'),skill('bound-beta','RUNTIME_BETA_BODY'),'utf8');
  await writeFile(path.join(skillDir,'unbound-secret.md'),skill('unbound-secret','UNBOUND_RUNTIME_BODY'),'utf8');
  const model=id=>({id,contextWindow:32768,maxTokens:256});
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[model('main-model'),model('model-a'),model('model-b'),model('model-legacy')]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  try{
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'main-model'},workspace:root,runtimeConfig});
    const expertEvents=[];
    const result=await host.runExperts({sessionId,runId:'bound-skills',prompt:'FROZEN_SHARED_INPUT /unbound-secret',experts:[
      {id:'independent-reviewer-a',persona:'REVIEWER_A',model:{providerId:'fixture',modelId:'model-a'},boundSkills:[{name:'bound-alpha',markdown:'BOUND_ALPHA_BODY with literal {{tokenExample}}'}]},
      {id:'independent-reviewer-b',persona:'REVIEWER_B',model:{providerId:'fixture',modelId:'model-b'},boundSkills:[{name:'bound-beta',markdown:'BOUND_BETA_BODY'}]},
      {id:'legacy-expert',persona:'LEGACY_EXPERT',model:{providerId:'fixture',modelId:'model-legacy'}},
    ],onEvent:event=>expertEvents.push(event)});
    assert.deepEqual(result.map(row=>[row.expertId,row.stopReason]),[['independent-reviewer-a','completed'],['independent-reviewer-b','completed'],['legacy-expert','completed']],JSON.stringify(result));
    const byModel=Object.fromEntries(requests.map(input=>[input.model,JSON.stringify(input.messages)]));
    assert.match(byModel['model-a'],/BOUND_ALPHA_BODY with literal \{\{tokenExample\}\}/);
    assert.doesNotMatch(byModel['model-a'],/BOUND_BETA_BODY|UNBOUND_RUNTIME_BODY|RUNTIME_ALPHA_BODY|RUNTIME_BETA_BODY/);
    assert.match(byModel['model-b'],/BOUND_BETA_BODY/);
    assert.doesNotMatch(byModel['model-b'],/BOUND_ALPHA_BODY|UNBOUND_RUNTIME_BODY|RUNTIME_ALPHA_BODY|RUNTIME_BETA_BODY/);
    for(const modelId of ['model-a','model-b']){
      assert.doesNotMatch(byModel[modelId],/<available_skills>|skill-catalog/,'a bound child has no global skill catalog');
    }
    assert.doesNotMatch(JSON.stringify(expertEvents),/BOUND_ALPHA_BODY|BOUND_BETA_BODY|RUNTIME_ALPHA_BODY|RUNTIME_BETA_BODY|UNBOUND_RUNTIME_BODY/,'runtime events never carry skill bodies');
    assert.match(byModel['model-legacy'],/<available_skills>|skill-catalog/,'an expert without boundSkills keeps the legacy catalog');
    assert.match(byModel['model-legacy'],/UNBOUND_RUNTIME_BODY/,'an expert without boundSkills keeps legacy slash invocation');
    assert.equal(requests.filter(input=>input.model==='model-a'||input.model==='model-b'||input.model==='model-legacy').length,3);

    await host.send({sessionId,text:'/unbound-secret'});
    const mainInput=requests.find(input=>input.model==='main-model');
    assert.ok(mainInput,'Main made a model request');
    assert.match(JSON.stringify(mainInput.messages),/UNBOUND_RUNTIME_BODY/,'Main keeps its normal DSH skill invocation behavior');
  }finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});
