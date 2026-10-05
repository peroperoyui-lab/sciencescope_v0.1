import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';
import {buildContextTools,contextRules,CONTEXT_API_VERSION} from '../scripts/context/tools.mjs';

const SESSION = Object.freeze({
  main:'session-t17main',
  secretary:'session-t17secretary',
  global:'session-t17global',
  missing:'session-t17missing',
  noTools:'session-t17notools',
});
const CONTEXT_TOOL_NAMES = new Set(['chat_recall','project_memory','research_search','research_read','research_propose','minutes_refresh','workspace_overview']);

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) return message.content.map(block=>block?.text??block?.content??'').join('');
  return JSON.stringify(message?.content??'');
}
function requestTools(request) { return (request?.input?.tools??[]).map(tool=>tool.function?.name).filter(Boolean); }
function requestTool(request,name) { return request?.input?.tools?.find(tool=>tool.function?.name===name)?.function; }
function valueProperties(request,name) { return requestTool(request,name)?.parameters?.properties??{}; }

// Real DSH + a deterministic local fixture model. The manifest is selected by
// stable ScienceScope session identity (or by the registered expert identity),
// never by model-provided arguments. No paid provider is used.
test('host manifests give Main, expert, secretary and global the scoped context tools',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'research-tools-'));
  const requests=[];const fixtureErrors=[];let genericChildTools;let genericToolResult;
  const fixture=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    const input=JSON.parse(body);const sessionId=String(req.headers['x-fixture']??'');
    const record={sessionId,input};requests.push(record);
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const finish=(content)=>{
      res.write(`data: ${JSON.stringify({choices:[{delta:{content}}]})}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      res.end('data: [DONE]\n\n');
    };
    const callTool=(name,args)=>{
      if(!requestTool(record,name)){
        fixtureErrors.push(`${sessionId}: ${name} missing; tools=${requestTools(record).join(',')}`);
        finish(`MISSING_${name}`);return;
      }
      res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:`call-${requests.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})}\n\n`);
      res.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
      res.end('data: [DONE]\n\n');
    };
    const last=input.messages?.at(-1);
    const userText=[...(input.messages??[])].reverse().find(message=>message.role==='user');
    const prompt=messageText(userText);
    const childEnvelope=(input.messages??[]).filter(message=>['system','user'].includes(message.role)).some(message=>messageText(message).includes('GENERIC_CHILD_TASK'));
    if(last?.role==='tool'){
      const content=messageText(last);
      if(prompt.includes('GENERIC_SUBAGENT_CHECK')){genericToolResult=content;finish('GENERIC_SUBAGENT_OK');}
      else if(content.includes('[S1 p.2]'))finish('ANSWER_WITH [S1 p.2]');
      else if(content.includes('minutesRevision'))finish('SECRETARY_REFRESH_OK');
      else if(content.includes('GLOBAL_SCOPE_MARKER'))finish('GLOBAL_SCOPE_OK');
      else if(content.includes('GENERIC_CHILD_DONE'))finish('GENERIC_SUBAGENT_OK');
      else finish('NO_CITE');
      return;
    }
    const system=JSON.stringify((input.messages??[]).filter(message=>message.role==='system'));
    if(childEnvelope){
      genericChildTools=requestTools(record);finish('GENERIC_CHILD_DONE');return;
    }
    if(sessionId===SESSION.missing){finish('MISSING_MANIFEST_NO_CONTEXT_TOOLS');return;}
    if(prompt.includes('GENERIC_SUBAGENT_CHECK')){
      callTool('subagent',{description:'check child tools',prompt:'GENERIC_CHILD_TASK',run_in_background:false});return;
    }
    if(system.includes('PERSONA_STAT')){
      callTool('research_search',{query:'随机分组',limit:3});return;
    }
    if(sessionId===SESSION.secretary){callTool('minutes_refresh',{});return;}
    if(sessionId===SESSION.global){callTool('project_memory',{projectId:'project-alpha',chatId:'chat-alpha',section:'status'});return;}
    callTool('research_search',{query:'随机分组',limit:3});
  });
  await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
  const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
  const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
  const calls=[];const manifestCalls=[];
  const roleBySession=new Map([[SESSION.main,'main'],[SESSION.secretary,'secretary'],[SESSION.global,'global']]);
  const handler=async call=>{
    if(call.name==='__manifest'){
      manifestCalls.push(structuredClone(call));
      if(call.sessionId===SESSION.missing)throw new Error('manifest fixture unavailable');
      const role=call.expertId?'expert':roleBySession.get(call.sessionId);
      if(!role)throw new Error(`manifest requested by unexpected session ${call.sessionId}`);
      return {contextApi:CONTEXT_API_VERSION,tools:buildContextTools(role)};
    }
    calls.push(structuredClone(call));
    if(call.name==='research_search')return {hits:[{cite:'[S1 p.2]',snippet:'RANDOM_SNIPPET 未随机分组'}]};
    if(call.name==='minutes_refresh')return {minutesRevision:7,refreshed:true};
    if(call.name==='project_memory')return {marker:'GLOBAL_SCOPE_MARKER',target:{projectId:call.args.projectId,chatId:call.args.chatId},section:call.args.section};
    throw new Error(`unexpected tool ${call.name}`);
  };
  host.setToolHandler(handler);
  try{
    const model={providerId:'fixture',modelId:'fixture'};
    await host.startSession({sessionId:SESSION.main,model,workspace:root,runtimeConfig});
    await host.configurePolicy({sessionId:SESSION.main,approvalPolicy:'never',sandboxMode:'workspace-write'});
    await host.configureBrief({sessionId:SESSION.main,text:'[ScienceScope project brief]\n- BRIEF_MARKER 主要终点：Matsuda 指数 [@a1b2c3d4]\n'+contextRules('main')});
    const main=await host.send({sessionId:SESSION.main,text:'这项研究随机分组了吗？',onEvent:()=>{}});
    assert.equal(main.finalResponse,'ANSWER_WITH [S1 p.2]','the Main tool result reached the model');

    const panel=await host.runExperts({sessionId:SESSION.main,runId:'run-tools',prompt:'这项研究随机分组了吗？',onEvent:()=>{},experts:[{id:'statistician',label:'统计审稿人',persona:'PERSONA_STAT'}]});
    assert.equal(panel[0].stopReason,'completed');
    assert.equal(panel[0].text,'ANSWER_WITH [S1 p.2]');

    await host.startSession({sessionId:SESSION.secretary,model,workspace:root,runtimeConfig});
    const secretary=await host.send({sessionId:SESSION.secretary,text:'请立即更新纪要。',onEvent:()=>{}});
    assert.equal(secretary.finalResponse,'SECRETARY_REFRESH_OK');

    await host.startSession({sessionId:SESSION.global,model,workspace:root,runtimeConfig});
    const global=await host.send({sessionId:SESSION.global,text:'读取 alpha 项目的状态。',onEvent:()=>{}});
    assert.equal(global.finalResponse,'GLOBAL_SCOPE_OK');

    const firstRequest=(sessionId,predicate=()=>true)=>requests.find(request=>request.sessionId===sessionId&&request.input.messages?.at(-1)?.role!=='tool'&&predicate(request));
    const mainRequest=firstRequest(SESSION.main,request=>!messageText(request.input.messages?.at(-1)).includes('GENERIC_SUBAGENT_CHECK'));
    const expertRequest=requests.find(request=>JSON.stringify(request.input.messages?.filter(message=>message.role==='system')).includes('PERSONA_STAT'));
    const secretaryRequest=firstRequest(SESSION.secretary);
    const globalRequest=firstRequest(SESSION.global);
    for(const [role,request] of Object.entries({main:mainRequest,expert:expertRequest,secretary:secretaryRequest,global:globalRequest})){
      assert.ok(request,`${role} made a model request`);
      const names=requestTools(request);
      for(const name of ['chat_recall','project_memory','research_search','research_read','research_propose'])assert.ok(names.includes(name),`${role} is offered ${name}`);
      assert.ok(valueProperties(request,'project_memory').section?.enum?.includes('status'),`${role} can read status`);
      const selectable=role==='global';
      for(const name of ['chat_recall','project_memory']){
        const properties=valueProperties(request,name);
        assert.equal(Object.hasOwn(properties,'chatId'),selectable,`${name}.chatId is ${selectable?'available only to global':'absent outside global'}`);
        assert.equal(Object.hasOwn(properties,'projectId'),selectable,`${name}.projectId is ${selectable?'available only to global':'absent outside global'}`);
      }
      assert.equal(names.includes('minutes_refresh'),role==='secretary',`${role} secretary-only tool set`);
      assert.equal(names.includes('workspace_overview'),role==='global',`${role} global-only tool set`);
    }
    assert.match(JSON.stringify(mainRequest.input.messages.filter(message=>message.role==='system')),/BRIEF_MARKER 主要终点/,'the brief is part of the Main system prompt');
    assert.match(JSON.stringify(mainRequest.input.messages.filter(message=>message.role==='system')),/For research questions use research_search first/,'versioned lookup priority reaches the actual DSH model input through configureBrief');
    assert.match(JSON.stringify(mainRequest.input.messages.filter(message=>message.role==='system')),/Once direct evidence covers the requested scope, answer and cite evidence for each claim/,'evidence sufficiency reaches the actual provider system input without a length preference');
    for(const request of [mainRequest,expertRequest,secretaryRequest,globalRequest]){
      assert.match(requestTool(request,'research_search').description,/throughout the answer, including follow-up verification/);
      assert.match(requestTool(request,'research_read').description,/nextOrdinal is optional continuation/);
    }

    assert.deepEqual(calls.map(call=>({sessionId:call.sessionId,name:call.name,expertId:call.expertId,args:call.args})),[
      {sessionId:SESSION.main,name:'research_search',expertId:undefined,args:{query:'随机分组',limit:3}},
      {sessionId:SESSION.main,name:'research_search',expertId:'statistician',args:{query:'随机分组',limit:3}},
      {sessionId:SESSION.secretary,name:'minutes_refresh',expertId:undefined,args:{}},
      {sessionId:SESSION.global,name:'project_memory',expertId:undefined,args:{projectId:'project-alpha',chatId:'chat-alpha',section:'status'}},
    ],'manifest traffic is excluded and application calls retain their session/expert scope');
    assert.deepEqual(manifestCalls.map(call=>({sessionId:call.sessionId,expertId:call.expertId})),[
      {sessionId:SESSION.main,expertId:undefined},
      {sessionId:SESSION.main,expertId:'statistician'},
      {sessionId:SESSION.secretary,expertId:undefined},
      {sessionId:SESSION.global,expertId:undefined},
    ],'the expert identity, not a model argument, selects the expert manifest');

    const manifestsBeforeGeneric=manifestCalls.length;
    const generic=await host.send({sessionId:SESSION.main,text:'GENERIC_SUBAGENT_CHECK',onEvent:()=>{}});
    assert.equal(generic.finalResponse,'GENERIC_SUBAGENT_OK');
    assert.equal(manifestCalls.length,manifestsBeforeGeneric,'an ordinary model-created subagent does not request an application manifest');
    assert.ok(Array.isArray(genericChildTools),`the generic child reached the local fixture model; parent tool result=${genericToolResult}`);
    assert.deepEqual(genericChildTools.filter(name=>CONTEXT_TOOL_NAMES.has(name)),[],'a generic subagent receives no ScienceScope context or research tools');

    const unavailable=[];const stop=host.observeSession(SESSION.missing,frame=>{
      const event=frame.type==='control-event'?frame.event:frame;
      if(event?.type==='context-tools-unavailable')unavailable.push(event);
    });
    await host.startSession({sessionId:SESSION.missing,model,workspace:root,runtimeConfig});
    stop();
    assert.deepEqual(unavailable,[{type:'context-tools-unavailable',code:'CONTEXT_MANIFEST_UNAVAILABLE'}]);
    const missing=await host.send({sessionId:SESSION.missing,text:'确认工具清单。',onEvent:()=>{}});
    assert.equal(missing.finalResponse,'MISSING_MANIFEST_NO_CONTEXT_TOOLS');
    const missingRequest=firstRequest(SESSION.missing);
    assert.deepEqual(requestTools(missingRequest).filter(name=>CONTEXT_TOOL_NAMES.has(name)),[],'a missing manifest registers no context/research tools');

    const manifestCountBeforeNoTools=manifestCalls.length;
    await host.startSession({sessionId:SESSION.noTools,model,workspace:root,runtimeConfig,noTools:true});
    assert.equal(manifestCalls.length,manifestCountBeforeNoTools,'a noTools session never requests the manifest');

    host.setToolHandler(null);
    await host.configureBrief({sessionId:SESSION.main,text:''});
    await host.send({sessionId:SESSION.main,text:'再说一次？',onEvent:()=>{}});
    const later=requests.at(-1);
    assert.doesNotMatch(JSON.stringify(later.input.messages.filter(message=>message.role==='system')),/BRIEF_MARKER/,'an emptied brief leaves the prompt');
    assert.match(messageText(later.input.messages.findLast(message=>message.role==='tool')),/not available/i,'without a handler the registered tool reports unavailability');

    assert.deepEqual(fixtureErrors,[]);
    assert.equal(requests.length,14,'the four-role, generic-child, missing-manifest and brief-update matrix uses a fixed local-model request count');
  }finally{await host.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));await rm(root,{recursive:true,force:true});}
});
