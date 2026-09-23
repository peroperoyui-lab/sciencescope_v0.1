import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';
import {createSkillManager} from '../adapters/runtime-dsh/skill-manager.mjs';
import {createDshWebHost} from '../adapters/runtime-dsh/web-host.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'skills-runtime-')),requests=[];let host,manager,web,fixtureError;
const fixture=createServer(async(req,res)=>{
  let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);requests.push(body);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(requests.length===1){const tool=body.tools?.find(t=>t.function?.name==='skill');if(!tool){fixtureError='DSH skill tool missing';res.end('data: [DONE]\n\n');return;}
    res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'skill-call',type:'function',function:{name:'skill',arguments:JSON.stringify({name:'scope-fixture-skill'})}}]}}]})}\n\n`);
    res.end('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');return;
  }
  res.end('data: {"choices":[{"delta":{"content":"SKILL_OK"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const model={providerId:'fixture',modelId:'fixture'};
const runtimeConfig={providers:{fixture:{api:'openai-completions',apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
try{
  manager=await createSkillManager({home:root});
  web=await createDshWebHost({home:root,cwd:root});const inventory=await web.call('pluginInventory','list',{});assert.ok(inventory.entries.length>0);await web.close();web=null;
  await manager.save({markdown:'---\nname: scope-fixture-skill\ndescription: A local deterministic research checklist.\n---\n\nSKILL_BODY_SENTINEL_8231\n'});
  host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  let sessionId=await host.startSession({model,workspace:root,runtimeConfig});const events=[];
  await host.send({sessionId,text:'Use the installed checklist to answer briefly.',onEvent:e=>events.push(e)});
  assert.equal(fixtureError,undefined);assert.match(JSON.stringify(requests[0].messages),/scope-fixture-skill/);
  assert.match(JSON.stringify(requests[1].messages),/SKILL_BODY_SENTINEL_8231/);
  assert.equal(events.find(e=>e.type==='tool-call').callId,events.find(e=>e.type==='tool-result').callId);
  await manager.setEnabled({name:'scope-fixture-skill',enabled:false});await host.releaseSession(sessionId);
  sessionId=await host.startSession({model,workspace:root,runtimeConfig});await host.send({sessionId,text:'Answer briefly.'});
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages),/scope-fixture-skill|SKILL_BODY_SENTINEL_8231/);
  await manager.setEnabled({name:'scope-fixture-skill',enabled:true});await host.releaseSession(sessionId);
  sessionId=await host.startSession({model,workspace:root,runtimeConfig});await host.send({sessionId,text:'Answer briefly.'});
  assert.match(JSON.stringify(requests.at(-1).messages),/scope-fixture-skill/);
  console.log(JSON.stringify({realDsh:true,pluginInventory:true,skillDiscovered:true,skillToolExecuted:true,disabledAbsentInFreshSession:true,reenabledVisible:true,localRequests:requests.length,paidRequests:0}));
}finally{await host?.close();await web?.close();await manager?.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));await rm(root,{recursive:true,force:true});}
