import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDesktopApi} from '../scripts/desktop-api.mjs';

const model={providerId:'fixture',modelId:'fixture'};
async function fixture(){
 const base=path.resolve('.sciencescope-local/temp/t24-validation');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'continuation-api-'));
 const state={starts:[],sends:[],tools:[],continues:[],outputs:[],expertOutputs:[],runtimeConfig:{providers:{}},toolHandler:null};
 const host={capabilities:{tokenStreaming:true},listProviders:async()=>[],getRuntimeConfig:async()=>state.runtimeConfig,getContextUsage:async()=>null,observeSession:()=>()=>{},
  startSession:async options=>{state.starts.push(options);return options.sessionId??`session-fixture${state.starts.length}`;},releaseSession:async()=>{},configureReasoning:async()=>{},configurePolicy:async()=>{},configureBrief:async()=>{},close:async()=>{},sessionTurns:async()=>({turns:[{endSeq:3}]}),
  setToolHandler:handler=>{state.toolHandler=handler;},
  send:async input=>{state.sends.push(input);const output=state.outputs.shift()??{text:'CONTINUED',stopReason:'completed'};if(output.text)input.onEvent({type:'text-delta',delta:output.text});input.onEvent({type:'completed',text:output.text,stopReason:output.stopReason});return {finalResponse:output.text,stopReason:output.stopReason};},
  runExperts:async input=>input.experts.map(expert=>({expertId:expert.id,childSessionId:`child-${expert.id}`,stopReason:'max-tokens',text:'EXPERT_PARTIAL'})),cancelExperts:async()=>{},
  continueExpert:async input=>{state.continues.push(input);if(state.expertOutputs.length)return {expertId:input.expert.id,childSessionId:input.childSessionId,...state.expertOutputs.shift()};const result=await state.toolHandler({sessionId:input.sessionId,expertId:input.expert.id,name:'research_propose',callId:'continued-proposal',args:{op:'create',item:{type:'memory',subtype:'decision',scope:'personal',title:'Continuation provenance',body:'Continued expert evidence.'},rationale:'Test provenance.'}});state.tools.push(result);return {expertId:input.expert.id,childSessionId:input.childSessionId,stopReason:'completed',text:'EXPERT_REST'};},
 };
 let api,server,origin;
 async function open(){api=await createDesktopApi({dataRoot:root,runtimeHost:host});server=createServer((req,res)=>void api.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;}
 await open();
 async function call(route,body){const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const text=await response.text();return {status:response.status,events:text.trim().split('\n').filter(Boolean).map(JSON.parse)};}
 return {state,call,reopen:async()=>{await api.close();await new Promise(resolve=>server.close(resolve));await open();},close:async()=>{await api.close();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}};
}

test('Main persists empty and long capped outputs, cold continues same session and rejects stale replies',async()=>{
 const f=await fixture();try{
  for(const [id,text]of [['empty',''],['long','L'.repeat(70000)]]){
   f.state.outputs.push({text,stopReason:'max-tokens'});
   const first=await f.call('/api/chat',{chatId:id,projectId:null,model,text:'TASK',userMessageId:`u-${id}`,assistantMessageId:`a-${id}`});assert.equal(first.status,200);assert.equal(first.events.at(-1).stopReason,'max-tokens');
   const saved=(await f.call(`/api/chats/${id}/messages`)).events[0].messages.find(m=>m.id===`a-${id}`);assert.equal(saved.text,text);assert.equal(saved.completionStatus,'max-tokens');
  }
  const original=f.state.sends.at(-1).sessionId;await f.reopen();
  const continued=await f.call('/api/chat/continue',{chatId:'long',messageId:'a-long',userMessageId:'continue-u',assistantMessageId:'continue-a'});assert.equal(continued.status,200);assert.equal(f.state.sends.at(-1).sessionId,original);
  const page=(await f.call('/api/chats/long/messages')).events[0].messages;assert.equal(page.find(m=>m.id==='a-long').text.length,70000);assert.equal(page.find(m=>m.id==='continue-a').text,'CONTINUED');
  const count=f.state.sends.length;const stale=await f.call('/api/chat/continue',{chatId:'long',messageId:'a-long'});assert.equal(stale.status,409);assert.equal(stale.events[0].code,'CONTINUATION_STALE');assert.equal(f.state.sends.length,count);
 }finally{await f.close();}
});

test('private assistant capped outputs survive restart and continue without Main mutation or draft loss',async()=>{
 const f=await fixture();try{
  await f.call('/api/chat',{chatId:'main',projectId:null,model,text:'MAIN_ANCHOR',userMessageId:'main-u',assistantMessageId:'main-a'});
  f.state.outputs.push({text:'',stopReason:'max-tokens'});
  const first=await f.call('/api/assistant/chat',{scope:'global',ownerId:'global',model,text:'PRIVATE_SCRATCH',userMessageId:'assistant-u'});assert.equal(first.status,200);
  const accepted=first.events.find(e=>e.type==='accepted');const original=f.state.sends.at(-1).sessionId;assert.notEqual(original,f.state.sends[0].sessionId);
  await f.call('/api/assistant/draft',{scope:'global',ownerId:'global',text:'USER_UNSENT_DRAFT',attachmentIds:[]});await f.reopen();
  const snapshot=(await f.call('/api/assistant?scope=global&ownerId=global')).events[0];assert.equal(snapshot.messages.find(m=>m.id===accepted.assistantMessageId).completionStatus,'max-tokens');assert.equal(snapshot.draft,'USER_UNSENT_DRAFT');
  const continued=await f.call('/api/assistant/continue',{scope:'global',ownerId:'global',messageId:accepted.assistantMessageId,userMessageId:'assistant-continue-u'});assert.equal(continued.status,200);assert.equal(f.state.sends.at(-1).sessionId,original);
  const after=(await f.call('/api/assistant?scope=global&ownerId=global')).events[0];assert.equal(after.draft,'USER_UNSENT_DRAFT');
  const main=(await f.call('/api/chats/main/messages')).events[0].messages;assert.equal(main.length,2);assert.doesNotMatch(JSON.stringify(main),/PRIVATE_SCRATCH|assistant-continue-u/);
  const before=f.state.sends.length;const stale=await f.call('/api/assistant/continue',{scope:'global',ownerId:'global',messageId:accepted.assistantMessageId});assert.equal(stale.status,409);assert.equal(stale.events[0].code,'CONTINUATION_STALE');assert.equal(f.state.sends.length,before);
 }finally{await f.close();}
});

test('expert cold continuation uses private binding and tool proposals point at its new answer',async()=>{
 const f=await fixture();try{
  const first=await f.call('/api/discussion',{chatId:'panel',projectId:null,model,text:'EXPERT_TASK',kind:'invited',expertIds:['methodologist'],userMessageId:'panel-u'});assert.equal(first.status,200);const original=first.events.find(e=>e.type==='expert-end');assert.equal(original.canContinue,true);
  await f.reopen();const continued=await f.call('/api/discussion/continue',{chatId:'panel',messageId:original.messageId,childSessionId:'ATTACKER_CHILD'});assert.equal(continued.status,200);const next=continued.events.find(e=>e.type==='expert-end');assert.equal(next.text,'EXPERT_REST');
  assert.equal(f.state.continues[0].childSessionId,'child-methodologist');assert.doesNotMatch(JSON.stringify(continued.events),/child-methodologist|ATTACKER_CHILD/);
  const proposal=(await f.call('/api/research/proposals?status=pending')).events[0].proposals.find(p=>p.origin.toolCallId==='continued-proposal');assert.equal(proposal.origin.messageId,next.messageId);assert.equal(proposal.origin.expertId,'methodologist');
  const stale=await f.call('/api/discussion/continue',{chatId:'panel',messageId:original.messageId});assert.equal(stale.status,409);assert.equal(stale.events[0].code,'EXPERT_ALREADY_CONTINUED');
 }finally{await f.close();}
});

test('failed and cancelled expert attempts keep the original partial continuable across cold reload',async()=>{
 const f=await fixture();try{
  const roster=(await f.call('/api/experts')).events[0].experts;
  await f.call('/api/experts',{experts:roster.map(expert=>expert.id==='independent-reviewer'?{...expert,enabled:true}:expert)});
  const first=await f.call('/api/discussion',{chatId:'recover-panel',projectId:null,model,text:'EXPERT_TASK',kind:'ordered',expertIds:['methodologist'],reviewerId:'independent-reviewer',userMessageId:'recover-u'});
  assert.equal(first.status,200);const original=first.events.filter(e=>e.type==='expert-end').find(e=>e.review);assert.ok(original,'fixture includes reviewer partial');
  for(const [reason,text]of [['error','FAILED_ATTEMPT'],['aborted','CANCELLED_ATTEMPT']]){
   await f.reopen();f.state.expertOutputs.push({stopReason:reason,text});
   const attempt=await f.call('/api/discussion/continue',{chatId:'recover-panel',messageId:original.messageId,childSessionId:'ATTACKER_CHILD'});assert.equal(attempt.status,200);const next=attempt.events.find(e=>e.type==='expert-end');assert.equal(next.stopReason,reason);
   assert.equal(f.state.continues.at(-1).childSessionId,'child-independent-reviewer');
   const adopt=await f.call('/api/discussion/adopt',{chatId:'recover-panel',messageId:next.messageId,adopted:true});assert.equal(adopt.status,409,'failed reviewer cannot be adopted');
   await f.reopen();const page=(await f.call('/api/chats/recover-panel/messages')).events[0].messages;
   assert.equal(page.find(m=>m.id===original.messageId).expert.canContinue,true,'original partial remains recoverable');
   assert.equal(page.find(m=>m.id===next.messageId).text,text,'failed attempt stays visible');
  }
  f.state.expertOutputs.push({stopReason:'max-tokens',text:'LENGTH_REST'});
  const length=await f.call('/api/discussion/continue',{chatId:'recover-panel',messageId:original.messageId});assert.equal(length.status,200);const partial=length.events.find(e=>e.type==='expert-end');
  await f.reopen();let page=(await f.call('/api/chats/recover-panel/messages')).events[0].messages;
  assert.equal(page.find(m=>m.id===original.messageId).expert.canContinue,false,'usable length consumes original');assert.equal(page.find(m=>m.id===partial.messageId).expert.canContinue,true);
  f.state.expertOutputs.push({stopReason:'completed',text:'COMPLETED_REST'});
  const completed=await f.call('/api/discussion/continue',{chatId:'recover-panel',messageId:partial.messageId,childSessionId:'ATTACKER_CHILD'});assert.equal(completed.status,200);const final=completed.events.find(e=>e.type==='expert-end');assert.equal(f.state.continues.at(-1).childSessionId,'child-independent-reviewer');
  await f.reopen();page=(await f.call('/api/chats/recover-panel/messages')).events[0].messages;assert.equal(page.find(m=>m.id===partial.messageId).expert.canContinue,false);
  const adopted=await f.call('/api/discussion/adopt',{chatId:'recover-panel',messageId:final.messageId,adopted:true});assert.equal(adopted.status,200);
 }finally{await f.close();}
});
