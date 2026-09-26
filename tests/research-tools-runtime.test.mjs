import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

// Real DSH + local fixture model: the Research Base tools are registered in
// the Main session and in expert subagents, their calls reach the host through
// /host-call with the session (and expert) identity, and the project brief is
// a system-prompt section that the next request carries.
test('research tools reach the host from Main and experts; the brief enters the system prompt',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'research-tools-'));
  const requests=[];let fixtureError;
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const input=JSON.parse(body);requests.push(input);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const toolResult=input.messages?.at(-1)?.role==='tool'?input.messages.at(-1):null;
    if(!toolResult){
      const tool=input.tools?.find(t=>t.function?.name==='research_search');
      if(!tool){fixtureError='research_search missing: '+input.tools?.map(t=>t.function?.name).join(',');res.end('data: [DONE]\n\n');return;}
      res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:`call-${requests.length}`,type:'function',function:{name:'research_search',arguments:JSON.stringify({query:'随机分组',limit:3})}}]}}]})}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
    }else{
      const content=typeof toolResult.content==='string'?toolResult.content:JSON.stringify(toolResult.content);
      res.write(`data: ${JSON.stringify({choices:[{delta:{content:content.includes('[S1 p.2]')?'ANSWER_WITH [S1 p.2]':'NO_CITE'}}]})}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  const calls=[];
  host.setToolHandler(async call=>{calls.push(call);if(call.name!=='research_search')throw new Error('unexpected tool');return {hits:[{cite:'[S1 p.2]',snippet:'RANDOM_SNIPPET 未随机分组'}]};});
  try{
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'fixture'},workspace:root,runtimeConfig});
    await host.configurePolicy({sessionId,approvalPolicy:'never',sandboxMode:'workspace-write'});
    await host.configureBrief({sessionId,text:'[ScienceScope project brief]\n- BRIEF_MARKER 主要终点：Matsuda 指数 [@a1b2c3d4]'});
    const result=await host.send({sessionId,text:'这项研究随机分组了吗？',onEvent:()=>{}});
    assert.equal(fixtureError,undefined);
    assert.equal(result.finalResponse,'ANSWER_WITH [S1 p.2]','the tool result reached the model');
    assert.equal(calls[0].sessionId,sessionId);assert.equal(calls[0].expertId,undefined);
    assert.deepEqual(calls[0].args,{query:'随机分组',limit:3});
    const system=JSON.stringify(requests[0].messages.filter(m=>m.role==='system'));
    assert.match(system,/BRIEF_MARKER 主要终点/,'the brief is part of the system prompt');

    const panel=await host.runExperts({sessionId,runId:'run-tools',prompt:'这项研究随机分组了吗？',onEvent:()=>{},experts:[{id:'statistician',label:'统计审稿人',persona:'PERSONA_STAT'}]});
    assert.equal(fixtureError,undefined);assert.equal(panel[0].stopReason,'completed');
    assert.equal(panel[0].text,'ANSWER_WITH [S1 p.2]');
    assert.equal(calls[1].expertId,'statistician','expert calls carry the expert id');
    assert.equal(calls[1].sessionId,sessionId);
    // History tools are offered to the Main session and to experts alike.
    const toolNames=request=>(request.tools||[]).map(t=>t.function?.name);
    for(const name of ['chat_recall','project_memory'])assert.ok(toolNames(requests[0]).includes(name),`Main is offered ${name}`);
    const expertRequest=requests.find(r=>JSON.stringify(r.messages.filter(m=>m.role==='system')).includes('PERSONA_STAT'));
    for(const name of ['chat_recall','project_memory'])assert.ok(toolNames(expertRequest).includes(name),`experts are offered ${name}`);

    host.setToolHandler(null);
    await host.configureBrief({sessionId,text:''});
    await host.send({sessionId,text:'再说一次？',onEvent:()=>{}});
    const later=requests.at(-1);
    assert.doesNotMatch(JSON.stringify(later.messages.filter(m=>m.role==='system')),/BRIEF_MARKER/,'an emptied brief leaves the prompt');
    assert.match(JSON.stringify(later.messages.findLast(m=>m.role==='tool')?.content??''),/not available/,'without a handler the tool reports unavailability');
  }finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});
