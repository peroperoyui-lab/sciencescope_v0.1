import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';
import {createChatStore} from '../scripts/chat-store.mjs';
import {createDiscussionService} from '../scripts/discussion-service.mjs';

test('expert resumes its same child after cold parent restart with skills and scoped host tools',async()=>{
 const base=path.resolve('.sciencescope-local/temp/t24-validation');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'expert-continue-'));
 const requests=[],calls=[];
 const fixture=createServer(async(req,res)=>{
  let raw='';for await(const p of req)raw+=p;const input=JSON.parse(raw);requests.push(input);
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(delta,finish)=>res.write(`data: ${JSON.stringify({choices:[{delta,...(finish?{finish_reason:finish}:{})}]})}\n\n`);
  const messages=JSON.stringify(input.messages),continued=messages.includes('CONTINUE_ORIGINAL'),approval=messages.includes('CONTINUE_APPROVAL');
  if(input.model==='main'){send({content:'MAIN_ONLY'},'stop');}
  else if(approval&&input.messages.at(-1)?.role!=='tool'){
   const tool=input.tools.find(tool=>process.platform==='win32'?/pwsh$/i.test(tool.function.name):/bash$/i.test(tool.function.name));
   const command=Object.keys(tool.function.parameters.properties).find(key=>/command|cmd|script/i.test(key))??Object.keys(tool.function.parameters.properties)[0];
   send({tool_calls:[{index:0,id:'approval-call',type:'function',function:{name:tool.function.name,arguments:JSON.stringify({[command]:process.platform==='win32'?'Write-Output APPROVAL_RESUME_MARKER':'printf APPROVAL_RESUME_MARKER',description:'Check restored approval.',sandbox_permissions:'danger-full-access',justification:'Explicit fixture approval.'})}}]},'tool_calls');
  }
  else if(approval)send({content:'APPROVAL_CONTINUED'},'stop');
  else if(!continued){send({content:'PARTIAL_EXPERT'},'length');}
  else if(input.messages.at(-1)?.role!=='tool'){
   send({tool_calls:[{index:0,id:'scope-call',type:'function',function:{name:'research_read',arguments:'{"itemId":"scoped-item"}'}}]},'tool_calls');
  }else send({content:'EXPERT_CONTINUED'},'stop');
  res.end('data: [DONE]\n\n');
 });await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 const runtimeConfig={providers:{fixture:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_OFFLINE_KEY',models:['main','expert'].map(id=>({id,maxTokens:65536,contextWindow:262144}))}}};
 const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-fixture'],env:{SCIENCESCOPE_OFFLINE_KEY:'fixture'}});
 host.setToolHandler(async call=>{if(call.name==='__manifest')return {tools:[{name:'research_read',description:'Read a scoped research item.',parameters:{itemId:{type:'string',required:true}}}]};calls.push(call);return {text:'SCOPED_READ'};});
 const expert={id:'fixedexpert',label:'Fixture Expert',persona:'ORIGINAL_PERSONA',model:{providerId:'fixture',modelId:'expert'},boundSkills:[{name:'fixed-skill',markdown:'ORIGINAL_BOUND_SKILL'}]};
 try{
  const sessionId=await host.startSession({model:{providerId:'fixture',modelId:'main'},runtimeConfig,workspace:root});await host.configurePolicy({sessionId,approvalPolicy:'ask',sandboxMode:'workspace-write'});
  const initial=await host.runExperts({sessionId,runId:'initial',prompt:'ORIGINAL_TASK',experts:[expert]});assert.equal(initial[0].stopReason,'max-tokens');assert.ok(initial[0].childSessionId);
  const turnsBefore=await host.sessionTurns({sessionId});assert.equal(turnsBefore.turns.length,0);
  await host.releaseSession(sessionId);await host.startSession({sessionId,model:{providerId:'fixture',modelId:'main'},runtimeConfig,workspace:root});await host.configurePolicy({sessionId,approvalPolicy:'ask',sandboxMode:'workspace-write'});
  const events=[];const continued=await host.continueExpert({sessionId,runId:'continued',childSessionId:initial[0].childSessionId,expert,prompt:'CONTINUE_ORIGINAL',onEvent:e=>events.push(e)});
  assert.equal(continued.childSessionId,initial[0].childSessionId);assert.equal(continued.stopReason,'completed',JSON.stringify(continued));assert.equal(continued.text,'EXPERT_CONTINUED');
  assert.equal(calls.length,1);assert.equal(calls[0].sessionId,sessionId);assert.equal(calls[0].expertId,'fixedexpert');
  const second=requests.find(r=>JSON.stringify(r.messages).includes('CONTINUE_ORIGINAL'));assert.match(JSON.stringify(second.messages),/ORIGINAL_TASK/);assert.match(JSON.stringify(second.messages),/PARTIAL_EXPERT/);assert.match(JSON.stringify(second.messages),/ORIGINAL_PERSONA/);assert.match(JSON.stringify(second.messages),/ORIGINAL_BOUND_SKILL/);assert.ok(second.tools.some(t=>t.function.name==='research_read'));assert.ok(!second.tools.some(t=>t.function.name==='skill'));
  assert.equal((await host.sessionTurns({sessionId})).turns.length,0,'expert continuation does not advance Main');
  const approvals=[];let approvalTail=Promise.resolve();const unsubscribe=host.observeSession(sessionId,frame=>{
    const event=frame.type==='control-event'?frame.event:frame;
    if(event.type==='approval-request'){approvals.push(event);approvalTail=approvalTail.then(()=>host.replyApproval({sessionId,requestId:event.requestId,outcome:'rejected'}));}
  });
  try{
   const approved=await host.continueExpert({sessionId,runId:'approval-resume',childSessionId:initial[0].childSessionId,expert,prompt:'CONTINUE_APPROVAL'});await approvalTail;
   assert.equal(approved.text,'APPROVAL_CONTINUED');assert.equal(approvals.length,1,'restored child keeps user approval policy');assert.equal(approvals[0].expertId,expert.id);
   assert.match(JSON.stringify(requests.at(-1).messages),/reject|denied|not approved/i);
  }finally{unsubscribe();}
  await host.send({sessionId,text:'MAIN_AFTER'});const main=requests.find(r=>r.model==='main');assert.doesNotMatch(JSON.stringify(main.messages),/PARTIAL_EXPERT|CONTINUE_ORIGINAL|subagent-settled|EXPERT_CONTINUED/);
  const foreign=await host.startSession({model:{providerId:'fixture',modelId:'main'},runtimeConfig,workspace:root});
  await assert.rejects(host.continueExpert({sessionId:foreign,runId:'foreign',childSessionId:initial[0].childSessionId,expert,prompt:'CONTINUE_ORIGINAL'}),/HTTP 400/);
 }finally{await host.close();fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));await rm(root,{recursive:true,force:true});}
});

test('discussion stores private immutable continuation bindings and appends partial and completed answers',async()=>{
 const base=path.resolve('.sciencescope-local/temp/t24-validation');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'discussion-continue-'));
 const store=await createChatStore({stateDir:root});const db=store.db.db,model={providerId:'fixture',modelId:'original'};
 await store.ensureChat({chatId:'chat',projectId:null,title:'Continuation',model});
 const original={id:'expert',label:'Original',role:'Research',persona:'ORIGINAL_IMMUTABLE',model,boundSkills:[{name:'skill',markdown:'PRIVATE_SKILL_BODY'}]};let restored;
 const host={runExperts:async({experts})=>experts.map(expert=>({expertId:expert.id,childSessionId:`opaque-child-${expert.id}`,stopReason:'max-tokens',text:'PARTIAL_TEXT'})),continueExpert:async input=>{restored=input;input.onEvent({type:'expert-start',runId:input.runId,expertId:input.expert.id});return {expertId:input.expert.id,childSessionId:input.childSessionId,stopReason:'completed',text:'REST_COMPLETED'};}};
 let service=createDiscussionService({host,chatStore:store,db});const events=[];
 try{
  await service.run({chatId:'chat',sessionId:'parent',experts:[original],kind:'invited',context:'',requestText:'TASK',userMessage:{id:'user',text:'TASK'},chatModel:model,environmentKey:'python-original',onEvent:e=>events.push(e)});
  const partial=events.find(e=>e.type==='expert-end');assert.equal(events.at(-1).failed,0);assert.equal(partial.canContinue,true);
  assert.doesNotMatch(JSON.stringify(events),/opaque-child|PRIVATE_SKILL_BODY|ORIGINAL_IMMUTABLE/);
  assert.match(service.pendingForMain('chat').text,/Partial answer[\s\S]*PARTIAL_TEXT/);
  original.persona='EDITED_LATER';original.boundSkills[0].markdown='EDITED_SKILL';
  service=createDiscussionService({host,chatStore:store,db});
  await assert.rejects(service.continueAnswer({chatId:'chat',messageId:partial.messageId,sessionId:'other',onEvent:()=>{}}),{code:'EXPERT_PARENT_MISMATCH'});
  await assert.rejects(service.continueAnswer({chatId:'chat',messageId:partial.messageId,sessionId:'parent',environmentKey:'python-changed',onEvent:()=>{}}),{code:'EXPERT_ENV_CHANGED'});
  const continued=[];const result=await service.continueAnswer({chatId:'chat',messageId:partial.messageId,sessionId:'parent',environmentKey:'python-original',onEvent:e=>continued.push(e)});
  assert.equal(restored.childSessionId,'opaque-child-expert');assert.equal(restored.expert.persona,'ORIGINAL_IMMUTABLE');assert.equal(restored.expert.boundSkills[0].markdown,'PRIVATE_SKILL_BODY');
  assert.notEqual(result.messageId,partial.messageId);assert.equal(store.getMessage('chat',partial.messageId).text,'PARTIAL_TEXT');assert.equal(store.getMessage('chat',result.messageId).text,'REST_COMPLETED');
  const meta=service.entriesFor('chat',[partial.messageId,result.messageId]);assert.equal(meta.get(partial.messageId).canContinue,false);assert.equal(meta.get(result.messageId).continuedFrom,partial.messageId);
  assert.doesNotMatch(JSON.stringify([...meta.values()]),/opaque-child|PRIVATE_SKILL_BODY/);
  await assert.rejects(service.continueAnswer({chatId:'chat',messageId:partial.messageId,sessionId:'parent',environmentKey:'python-original',onEvent:()=>{}}),{code:'EXPERT_ALREADY_CONTINUED'});
  service.pendingForMain('chat').commit();const reviewEvents=[];
  await service.run({chatId:'chat',sessionId:'parent',experts:[original],reviewer:{...original,id:'review',label:'Reviewer'},kind:'ordered',context:'',requestText:'REVIEW',userMessage:{id:'user-review',text:'REVIEW'},chatModel:model,environmentKey:'python-original',onEvent:e=>reviewEvents.push(e)});
  const partialReview=reviewEvents.find(e=>e.type==='expert-end'&&e.review);assert.throws(()=>service.adopt('chat',partialReview.messageId,true),{code:'REVIEW_NOT_COMPLETED'});
  const reviewRest=await service.continueAnswer({chatId:'chat',messageId:partialReview.messageId,sessionId:'parent',environmentKey:'python-original',onEvent:()=>{}});
  assert.equal(service.entriesFor('chat',[reviewRest.messageId]).get(reviewRest.messageId).adopted,false);
  service.adopt('chat',reviewRest.messageId,true);
  assert.match(service.pendingForMain('chat').text,/Completed reviewer answer[\s\S]*PARTIAL_TEXT[\s\S]*Reviewer continuation[\s\S]*REST_COMPLETED/);
  assert.equal(service.entriesFor('chat',[partialReview.messageId]).get(partialReview.messageId).adopted,false,'old incomplete review remains unadopted');
 }finally{store.close();await rm(root,{recursive:true,force:true});}
});
