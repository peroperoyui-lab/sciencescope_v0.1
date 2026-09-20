// Real runtime approval rejection. The requested shell command must not run.
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'approval-'));let count=0,approvals=0,fixtureError;
const fixture=createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);count++;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(count===1){
    const tool=input.tools?.find(t=>/pwsh$/.test(t.function?.name));
    if(!tool){fixtureError='No pwsh tool';res.end('data: [DONE]\n\n');return;}
    res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call-approval',type:'function',function:{name:tool.function.name,arguments:JSON.stringify({command:"Write-Output 'APPROVAL_FIXTURE'",description:'Local approval test',sandbox_permissions:'danger-full-access',justification:'Local fixture requests permission; the test rejects it.'})}}]}}]})}\n\n`);
    res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
  }else{res.write('data: {"choices":[{"delta":{"content":"DENIED_ACK"}}]}\n\n');res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');}
  res.end('data: [DONE]\n\n');
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
const host=await createDshHost({home:root,cwd:root,env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'},sessionHeaders:['x-fixture']});
try{
  const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'fixture'},workspace:root,runtimeConfig:{providers:{fixture:{displayName:'Fixture',api:'openai-completions',apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,models:[{id:'fixture',name:'Fixture',contextWindow:32768,maxTokens:1024}]}}}});
  await host.configurePolicy({sessionId,approvalPolicy:'ask',sandboxMode:'workspace-write'});
  host.observeSession(sessionId,frame=>{if(frame.type==='control-event'&&frame.event.type==='approval-request'){approvals++;void host.replyApproval({sessionId,requestId:frame.event.requestId,outcome:'rejected'});}});
  const events=[];
  await host.send({sessionId,text:'Fixture only: request a permission decision, then acknowledge rejection. Do not retry.',onEvent:event=>events.push(event)});
  const call=events.find(e=>e.type==='tool-call'),result=events.find(e=>e.type==='tool-result');
  assert.ok(call);assert.ok(result);assert.equal(call.callId,result.callId);
  assert.match(call.argumentsPreview,/APPROVAL_FIXTURE/);
  assert.equal(typeof result.resultPreview,'string');
  assert.notEqual(result.resultPreview,'undefined');
  assert.equal(typeof call.turn,'number');
  assert.equal(result.turn,call.turn);
  const contextUsage=await host.getContextUsage({sessionId});
  assert.equal(contextUsage.contextWindow,32768);
  assert.ok(contextUsage.usedTokens>0);
  assert.equal(fixtureError,undefined);assert.equal(approvals,1);assert.equal(count,2);
  console.log(JSON.stringify({passed:true,approvals,rejected:true,fixtureRequests:count}));
}finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
