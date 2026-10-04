import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

test('real DSH keeps length output, empty incomplete tools, usage and same-session continuation',async()=>{
  const base=path.resolve('.sciencescope-local/temp/t24-validation');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'output-runtime-')),requests=[];let toolsExecuted=0;
  const fixture=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;const input=JSON.parse(raw);requests.push(input);
    res.writeHead(200,{'content-type':'text/event-stream'});
    const send=delta=>res.write(`data: ${JSON.stringify({choices:[{delta}]})}\n\n`);
    const continuing=JSON.stringify(input.messages).includes('CONTINUE_LONG');
    if(input.model==='tiny'){
      for(let index=0;index<1600;index++)send({content:String(index%10)});
      res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'length'}],usage:{prompt_tokens:100,completion_tokens:1600,total_tokens:1700}})}\n\n`);res.end('data: [DONE]\n\n');return;
    }
    if(input.model==='unknown'){send({content:'UNKNOWN_USAGE'});res.end('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');return;}
    if(input.model==='steps'&&input.messages.at(-1)?.role!=='tool'){
      send({content:'EXECUTION_PREAMBLE'});send({tool_calls:[{index:0,id:'read-call',type:'function',function:{name:'research_read',arguments:'{}'}}]});
      res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130,prompt_tokens_details:{cached_tokens:40}}})}\n\n`);res.end('data: [DONE]\n\n');return;
    }
    if(input.model==='partial-tool')send({tool_calls:[{index:0,id:'partial-call',type:'function',function:{name:'research_read',arguments:'{"unfinished":'}}]});
    else send({content:continuing?'CONTINUED_END':'PARTIAL_START_'+ 'X'.repeat(70000)});
    res.write(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:continuing?'stop':'length'}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130,prompt_tokens_details:{cached_tokens:40},completion_tokens_details:{reasoning_tokens:10}}})}\n\n`);
    res.end('data: [DONE]\n\n');
  });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:['long','partial-tool','steps','unknown','tiny'].map(id=>({id,maxTokens:65536,contextWindow:262144}))}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  host.setToolHandler(async invocation=>{if(invocation.name==='__manifest')return {tools:[{name:'research_read',description:'Read scoped fixture data.',parameters:{}}]};toolsExecuted++;return {data:'READ'};});
  try {
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'long'},runtimeConfig,workspace:root,noTools:true});
    const events=[];const first=await host.send({sessionId,text:'LONG_OUTPUT',onEvent:e=>events.push(e)});
    assert.equal(first.stopReason,'max-tokens');assert.equal(first.finalResponse.length,70014);
    assert.equal(events.at(-1).stopReason,'max-tokens');assert.equal(first.usage.totalTokens,130);
    assert.equal(first.usage.inputTokens,60);assert.equal(first.usage.cacheReadTokens,40);assert.equal(first.usage.outputTokens,30);assert.equal(first.usage.unknownRequests,0);
    assert.equal(requests[0].max_completion_tokens??requests[0].max_tokens,65536);
    await host.releaseSession(sessionId);await host.startSession({sessionId,model:{providerId:'fixture',modelId:'long'},runtimeConfig,workspace:root,noTools:true});
    const second=await host.send({sessionId,text:'CONTINUE_LONG'});assert.equal(second.finalResponse,'CONTINUED_END');assert.equal(second.stopReason,'completed');
    assert.match(JSON.stringify(requests[1].messages),/PARTIAL_START_/);
    const empty=await host.startSession({model:{providerId:'fixture',modelId:'partial-tool'},runtimeConfig,workspace:root});
    const partial=await host.send({sessionId:empty,text:'PARTIAL_TOOL'});assert.equal(partial.stopReason,'max-tokens');assert.equal(partial.finalResponse,'');assert.equal(toolsExecuted,0);
    const steps=await host.startSession({model:{providerId:'fixture',modelId:'steps'},runtimeConfig,workspace:root});const stepEvents=[];
    const two=await host.send({sessionId:steps,text:'TWO_STEPS',onEvent:e=>stepEvents.push(e)});
    assert.equal(two.stopReason,'max-tokens');assert.equal(two.usage.requests,2);assert.equal(two.usage.totalTokens,260);assert.equal(two.usage.cacheReadTokens,80);
    assert.doesNotMatch(two.finalResponse,/EXECUTION_PREAMBLE/);assert.equal(stepEvents.find(e=>e.type==='tool-call').preamble,'EXECUTION_PREAMBLE');
    assert.equal(toolsExecuted,1);
    const unknown=await host.startSession({model:{providerId:'fixture',modelId:'unknown'},runtimeConfig,workspace:root,noTools:true});
    const usageMissing=await host.send({sessionId:unknown,text:'WITHOUT_USAGE'});assert.equal(usageMissing.usage.totalTokens,undefined);assert.equal(usageMissing.usage.unknownRequests,1);
    await assert.rejects(host.configureBrief({sessionId:unknown,text:'R'.repeat(65*1024*1024)}),/HTTP 413[\s\S]*64 MiB/);
    assert.equal((await host.send({sessionId:unknown,text:'AFTER_RESOURCE_REJECTION'})).finalResponse,'UNKNOWN_USAGE','413 leaves the existing session usable');
    // A real SDK child can finish generation while localhost presentation is
    // still backlogged. Model one small synchronous application checkpoint per
    // delta; 1600 tiny frames exceed the former 2.5s post-idle grace period.
    const tiny=await host.startSession({model:{providerId:'fixture',modelId:'tiny'},runtimeConfig,workspace:root,noTools:true});
    const delayCell=new Int32Array(new SharedArrayBuffer(4));let deltaCount=0,firstDeltaAt;
    const delivered=await host.send({sessionId:tiny,text:'MANY_TINY_DELTAS',onEvent:event=>{
      if(event.type==='text-delta'){firstDeltaAt??=Date.now();deltaCount++;Atomics.wait(delayCell,0,0,3);}
    }});
    assert.equal(deltaCount,1600);assert.ok(Date.now()-firstDeltaAt>4000,'sink backlog exceeds old delivery grace');
    assert.equal(delivered.finalResponse,'0123456789'.repeat(160));assert.equal(delivered.stopReason,'max-tokens');
    assert.equal(delivered.usage.totalTokens,1700);assert.equal(delivered.usage.requests,1);
  }finally{await host.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));await rm(root,{recursive:true,force:true});}
});
