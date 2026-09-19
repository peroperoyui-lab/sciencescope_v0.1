import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

test('DSH effort changes affect the next request, retain history, and reject unsupported choices',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'effort-wire-'));const requests=[];
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;requests.push(JSON.parse(body));
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    res.end('data: {"choices":[{"delta":{"content":"EFFORT_OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  try{
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'fixture'},workspace:root,runtimeConfig:{providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256,reasoningEfforts:{low:'low',high:'high'},compat:{supportsReasoningEffort:true}}]}}}});
    await host.configureReasoning({sessionId,reasoningEffort:'low'});
    await host.send({sessionId,text:'First message sentinel.'});
    await host.configureReasoning({sessionId,reasoningEffort:'high'});
    await host.send({sessionId,text:'Second message sentinel.'});
    assert.equal(requests.length,2);
    assert.deepEqual(requests.map(r=>r.reasoning_effort),['low','high']);
    assert.match(JSON.stringify(requests[1].messages),/First message sentinel/);
    assert.match(JSON.stringify(requests[1].messages),/EFFORT_OK/);
    await assert.rejects(host.configureReasoning({sessionId,reasoningEffort:'invented'}));
    assert.equal(requests.length,2);
  }finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});
