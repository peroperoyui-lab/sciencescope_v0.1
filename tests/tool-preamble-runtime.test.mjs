import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';

// Real DSH + local fixture model: text written right before a tool call is an
// execution preamble. It travels with the tool call and is not part of the
// answer, for the Main expert and for panel experts alike.
test('tool preamble leaves the answer and rides on the tool call (Main and experts)',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'tool-preamble-'));
  await writeFile(path.join(root,'note.md'),'NOTE_BODY\n');
  const turns=new Map();let fixtureError;
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const input=JSON.parse(body);
    // One conversation per system prompt: first request calls a tool, second answers.
    const key=JSON.stringify(input.messages?.[0]?.content).slice(0,400);const n=(turns.get(key)||0)+1;turns.set(key,n);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const hasResult=input.messages?.some(m=>m.role==='tool');
    if(!hasResult){
      const tool=input.tools?.find(t=>/(^|_)read(_file)?$/i.test(t.function?.name))||input.tools?.find(t=>/read/i.test(t.function?.name));
      if(!tool){fixtureError='no read tool: '+input.tools?.map(t=>t.function?.name).join(',');res.end('data: [DONE]\n\n');return;}
      const props=Object.keys(tool.function.parameters?.properties||{});const pathKey=props.find(p=>/path|file/i.test(p))||props[0];
      res.write(`data: ${JSON.stringify({choices:[{delta:{content:'PREAMBLE_TEXT, reading the note.'}}]})}\n\n`);
      res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:`call-${turns.size}-${n}`,type:'function',function:{name:tool.function.name,arguments:JSON.stringify({[pathKey]:'note.md'})}}]}}]})}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
    }else{
      res.write('data: {"choices":[{"delta":{"content":"FINAL_ANSWER"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  try{
    const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'fixture'},workspace:root,runtimeConfig});
    await host.configurePolicy({sessionId,approvalPolicy:'never',sandboxMode:'workspace-write'});
    const events=[];
    const result=await host.send({sessionId,text:'Read note.md and answer.',onEvent:e=>events.push(e)});
    assert.equal(fixtureError,undefined);
    const call=events.find(e=>e.type==='tool-call');
    assert.ok(call,'tool call observed');
    assert.equal(call.preamble,'PREAMBLE_TEXT, reading the note.');
    assert.equal(result.finalResponse,'FINAL_ANSWER');
    assert.equal(events.at(-1).text,'FINAL_ANSWER');
    assert.ok(events.some(e=>e.type==='text-replace'&&e.text===''),'streamed preamble is withdrawn from the answer');

    const expertEvents=[];
    const panel=await host.runExperts({sessionId,runId:'run-pre',prompt:'Read note.md and answer.',onEvent:e=>expertEvents.push(e),experts:[{id:'alpha',persona:'PERSONA_ALPHA'}]});
    assert.equal(panel[0].stopReason,'completed');
    assert.equal(panel[0].text,'FINAL_ANSWER');
    const tool=expertEvents.find(e=>e.type==='expert-tool');
    assert.ok(tool,'expert tool call observed');
    assert.equal(tool.preamble,'PREAMBLE_TEXT, reading the note.');
    assert.match(tool.argumentsPreview,/note\.md/);
    assert.ok(tool.callId);
    const done=expertEvents.find(e=>e.type==='expert-tool-result');
    assert.equal(done?.callId,tool.callId);
  }finally{await host.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(root,{recursive:true,force:true});}
});
