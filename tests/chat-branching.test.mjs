import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from '../scripts/desktop-api.mjs';
import { ChatStore } from '../scripts/chat-store.mjs';
import { createExecutionService } from '../scripts/execution-service.mjs';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';

test('chat branching API preserves completed runtime prefixes, draft, settings and source isolation', { timeout: 30000 }, async () => {
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'chat-branch-api-'));
  const sessions=new Map(),starts=[];let next=0,gate=null;
  const host={capabilities:{tokenStreaming:true},listProviders:async()=>[],getRuntimeConfig:async()=>({}),getContextUsage:async()=>null,
    observeSession:()=>()=>{},close:async()=>{},configurePolicy:async()=>{},configureReasoning:async()=>{},configureBrief:async()=>{},releaseSession:async()=>{},getGoal:async()=>null,
    startSession:async options=>{starts.push(structuredClone(options));const id=options.sessionId||`session-${++next}`;if(!sessions.has(id))sessions.set(id,{turns:[],history:[]});return id;},
    sessionTurns:async({sessionId})=>({turns:sessions.get(sessionId)?.turns||[],lastSeq:sessions.get(sessionId)?.turns.at(-1)?.endSeq||0}),
    forkSession:async({sessionId,atSeq})=>{const source=sessions.get(sessionId);if(!source)throw Error('unknown source');const childId=`session-${++next}`;const turns=source.turns.filter(turn=>turn.endSeq<=atSeq);sessions.set(childId,{turns:[...turns],history:source.history.filter(item=>item.seq<=atSeq)});return {sessionId:childId,boundarySeq:atSeq};},
    runExperts:async({experts,onEvent})=>{const results=experts.map(expert=>({expertId:expert.id,text:`${expert.id.toUpperCase()}_VIEW`,stopReason:gate==='failed-expert'?'error':'completed',context:{usedTokens:10}}));for(const result of [...results].reverse())onEvent({type:'expert-end',...result});return results;},
    send:async({sessionId,text,onEvent})=>{if(gate)await gate;const s=sessions.get(sessionId),turn=s.turns.length+1,endSeq=(s.turns.at(-1)?.endSeq||0)+3;s.history.push({seq:endSeq,text});s.turns.push({index:turn,startSeq:endSeq-2,endSeq});if(text.includes('A')){onEvent?.({type:'tool-call',callId:'call-A',name:'read',argumentsPreview:'A.txt'});onEvent?.({type:'tool-result',callId:'call-A',name:'read',isError:false,resultPreview:'file A'});}onEvent?.({type:'completed',text:`reply ${turn}: ${text}`});return {finalResponse:`reply ${turn}: ${text}`};},
  };
  const errors=[];const api=await createDesktopApi({dataRoot:root,runtimeHost:host,onError:error=>errors.push(error)});const server=createServer((req,res)=>void api.handle(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(route,body){const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});const text=await response.text();const bodyValue=response.headers.get('content-type')?.includes('ndjson')?text.trim().split('\n').filter(Boolean).map(JSON.parse):JSON.parse(text);return {status:response.status,body:bodyValue};}
  const model={providerId:'fixture',modelId:'offline'};
  try{
    await request('/api/roles/save',{role:'main',config:{prompt:'Branch test persona',model:null,reasoningEffort:null}});
    await request('/api/chat',{chatId:'branch-source',projectId:null,model,text:'A',userMessageId:'u-a',assistantMessageId:'a-a',reasoningEffort:'high'});
    await request('/api/python/bind',{scope:'chat',targetId:'branch-source',envId:'system'});
    await request('/api/chat',{chatId:'branch-source',projectId:null,model,text:'B',userMessageId:'u-b',assistantMessageId:'a-b',reasoningEffort:'high'});
    const reply=await request('/api/chats/branch',{chatId:'branch-source',messageId:'a-a',mode:'reply'});
    assert.equal(reply.status,200,`${JSON.stringify(reply.body)} ${errors.at(-1)?.stack}`);assert.equal(reply.body.title,'分支：A');assert.equal(reply.body.draftText,'A');
    const replyPage=await request(`/api/chats/${reply.body.chatId}/messages`);
    assert.equal(replyPage.body.total,2);assert.equal(replyPage.body.chat.branchedFrom.messageId,'a-a');assert.equal(replyPage.body.chat.reasoningEffort,'high');
    assert.equal(replyPage.body.chat.draftText,'A');
    assert.equal(replyPage.body.messages[1].toolActivity[0].resultPreview,'file A');
    const childStart=starts.find(item=>item.sessionId===replyPage.body.chat.runtimeSessionId)||starts.at(-1);
    assert.equal(childStart.persona,'Branch test persona');
    assert.equal(childStart.model.reasoningEffort,'high');
    assert.equal(childStart.workspace,starts[0].workspace);
    const dbHandle=(await import('node:sqlite')).DatabaseSync;
    const raw=new dbHandle(path.join(root,'.sciencescope-local','state','sciencescope.sqlite'));
    try{
      const child=raw.prepare('SELECT runtime_session_id,reasoning_effort,branched_from_json,runtime_workspace FROM chats WHERE id=?').get(reply.body.chatId);
      assert.ok(child.runtime_session_id);assert.equal(child.reasoning_effort,'high');assert.ok(child.branched_from_json);assert.ok(child.runtime_workspace);
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM tool_activity WHERE chat_id=?').get(reply.body.chatId).n,1);
      assert.equal(raw.prepare("SELECT prompt FROM role_bindings WHERE chat_id=? AND role='main'").get(reply.body.chatId).prompt,'Branch test persona');
      assert.equal(raw.prepare("SELECT env_id FROM python_env_bindings WHERE scope='chat' AND target_id=?").get(reply.body.chatId).env_id,'system');
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM messages WHERE chat_id=?').get('branch-source').n,4);
    }finally{raw.close();}
    await request('/api/chats/draft',{chatId:reply.body.chatId,text:'edited draft'});
    assert.equal((await request(`/api/chats/${reply.body.chatId}/messages`)).body.chat.draftText,'edited draft');
    await request('/api/chat',{chatId:reply.body.chatId,projectId:null,model,text:'edited draft',userMessageId:'branch-draft-user',assistantMessageId:'branch-draft-answer'});
    assert.equal((await request(`/api/chats/${reply.body.chatId}/messages`)).body.chat.draftText,null);
    const reask=await request('/api/chats/branch',{chatId:'branch-source',messageId:'u-b',mode:'reask'});
    assert.equal(reask.status,200);assert.equal(reask.body.draftText,'B');
    const reaskPage=await request(`/api/chats/${reask.body.chatId}/messages`);
    assert.equal(reaskPage.body.total,2);assert.deepEqual(reaskPage.body.messages.map(message=>message.id.startsWith('branch-')), [true,true]);
    const first=await request('/api/chats/branch',{chatId:'branch-source',messageId:'u-a',mode:'reask'});
    assert.equal(first.status,200);assert.equal(first.body.draftText,'A');
    assert.equal((await request(`/api/chats/${first.body.chatId}/messages`)).body.total,0);
    assert.equal((await request('/api/chats/branch',{chatId:'invalid id',messageId:'u-a',mode:'reask'})).status,400);
    let release;gate=new Promise(resolve=>{release=resolve;});
    const sendPromise=request('/api/chat',{chatId:'branch-source',projectId:null,model,text:'C',userMessageId:'u-c',assistantMessageId:'a-c'});
    await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal((await request('/api/chats/branch',{chatId:'branch-source',messageId:'a-a',mode:'reply'})).body.code,'CHAT_BUSY');
    release();gate=null;
    await sendPromise;
    const discussion=await request('/api/discussion',{chatId:'branch-source',projectId:null,model,kind:'ordered',text:'Panel question',expertIds:['methodologist','red-team'],reviewerId:'statistician',userMessageId:'panel-user'});
    assert.equal(discussion.status,200);
    const sourcePage=await request('/api/chats/branch-source/messages');
    const panel=sourcePage.body.messages.filter(message=>message.expert);
    assert.deepEqual(panel.map(message=>message.expert.expertId),['methodologist','red-team','statistician'],'completion order differs from visible roster order');
    assert.equal(sourcePage.body.messages.find(message=>message.id==='panel-user').branchMode,'reask');
    const expertBranch=await request('/api/chats/branch',{chatId:'branch-source',messageId:panel[0].id,mode:'reply'});
    assert.equal(expertBranch.status,200);
    const expertPage=(await request(`/api/chats/${expertBranch.body.chatId}/messages`)).body;
    assert.deepEqual(expertPage.messages.filter(message=>message.expert).map(message=>message.expert.expertId),['methodologist'],'visible prefix ends at selected expert, even when it completed last');
    assert.notEqual(expertPage.messages.at(-1).expert.runId,panel[0].expert.runId);
    assert.equal(expertPage.messages.at(-1).expert.mainSeen,false);
    assert.equal(expertPage.chat.draftText,'Panel question');
    const expertSession=starts.at(-1).sessionId;
    assert.equal(sessions.get(expertSession).turns.at(-1).endSeq,9,'expert branch forks at prior Main endSeq');
    await request('/api/chat',{chatId:expertBranch.body.chatId,projectId:null,model,text:'Continue chosen expert',userMessageId:'expert-child-u',assistantMessageId:'expert-child-a'});
    assert.match(sessions.get(expertSession).history.at(-1).text,/METHODOLOGIST_VIEW/);
    assert.doesNotMatch(sessions.get(expertSession).history.at(-1).text,/RED-TEAM_VIEW|STATISTICIAN_VIEW/);
    assert.equal((await request('/api/discussion/adopt',{chatId:'branch-source',messageId:panel[2].id,adopted:true})).status,200);
    await request('/api/chat',{chatId:'branch-source',projectId:null,model,text:'Read panel',userMessageId:'panel-followup-u',assistantMessageId:'panel-followup-a'});
    assert.equal((await request('/api/chats/branch-source/messages')).body.messages.find(message=>message.id===panel[2].id).expert.mainSeen,true);
    const reviewerBranch=await request('/api/chats/branch',{chatId:'branch-source',messageId:panel[2].id,mode:'reply'});
    const reviewerPage=(await request(`/api/chats/${reviewerBranch.body.chatId}/messages`)).body;
    assert.equal(reviewerPage.messages.at(-1).expert.adopted,true);
    assert.equal(reviewerPage.messages.at(-1).expert.mainSeen,false,'later source Main catch-up lies outside this prefix');
    const laterBranch=await request('/api/chats/branch',{chatId:'branch-source',messageId:'panel-followup-a',mode:'reply'});
    assert.equal((await request(`/api/chats/${laterBranch.body.chatId}/messages`)).body.messages.find(message=>message.expert?.review).expert.mainSeen,true,'copied Main boundary already read the adopted review');
    gate='failed-expert';
    const failed=await request('/api/discussion',{chatId:'branch-source',projectId:null,model,kind:'invited',text:'Failed panel',expertIds:['red-team'],userMessageId:'failed-panel-user'});
    assert.equal(failed.status,200);gate=null;
    const failedPage=(await request('/api/chats/branch-source/messages')).body;
    assert.equal(failedPage.messages.find(message=>message.id==='failed-panel-user').branchMode,null);
    assert.equal(failedPage.messages.at(-1).branchMode,null);
    assert.equal((await request('/api/chats/branch',{chatId:'branch-source',messageId:failedPage.messages.at(-1).id,mode:'reply'})).body.code,'BRANCH_POINT_UNKNOWN');
  }finally{gate=null;await api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:500});}
});

test('automatic turns persist reliable success, abort, and failure receipts', {timeout:20000}, async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'chat-branch-auto-'));
  const chatStore=await new ChatStore({stateDir:path.join(root,'state')}).init();
  const database=openApplicationDatabaseSync({stateDir:path.join(root,'state')});
  await chatStore.ensureChat({chatId:'auto-chat',title:'Auto',model:{providerId:'p',modelId:'m'}});
  await chatStore.appendMessage({chatId:'auto-chat',id:'auto-user-ok',role:'user',text:'goal',completionStatus:'pending'});
  const listeners=new Map(),events=[];
  const host={observeSession:(id,fn)=>{listeners.set(id,fn);return()=>listeners.delete(id);},configurePolicy:async()=>{},sessionGoal:async()=>({id:'goal',revision:1,phase:'active'}),
    getGoal:async()=>({id:'goal',revision:1,phase:'active'}),close:async()=>{}};
  const bindings=new Map([['auto-chat',{sessionId:'auto-session',goalActive:false}]]);
  const execution=createExecutionService({host,database,chatStore,bindings,onTurnPersisted:value=>events.push(value)});
  try{
    await execution.start('auto-chat',bindings.get('auto-chat'),'objective',3,'auto-user-ok');
    const emit=event=>listeners.get('auto-session')({type:'control-event',sequence:99,event});
    emit({type:'committed-event',eventType:'assistant/message',seq:12,time:new Date().toISOString(),data:{turn:1,text:'success output'}});
    emit({type:'committed-event',eventType:'turn/end',seq:15,data:{turn:1,stopReason:'completed'}});
    emit({type:'run-idle',sequence:100});
    await execution.waitForTurnWrites('auto-chat');
    assert.equal(chatStore.getMessage('auto-chat','runtime-auto-session-12').completionStatus,'completed');
    assert.equal(chatStore.getMessage('auto-chat','runtime-auto-session-12').runtimeSeq,15);
    assert.equal(chatStore.getMessage('auto-chat','auto-user-ok').completionStatus,'completed');
    assert.equal(chatStore.getMessage('auto-chat','auto-user-ok').runtimeSeq,15);
    emit({type:'committed-event',eventType:'assistant/message',seq:21,time:new Date().toISOString(),data:{turn:2,text:'aborted output'}});
    emit({type:'committed-event',eventType:'turn/end',seq:24,data:{turn:2,stopReason:'aborted'}});
    emit({type:'committed-event',eventType:'assistant/message',seq:30,time:new Date().toISOString(),data:{turn:3,text:'failed output'}});
    emit({type:'committed-event',eventType:'turn/end',seq:33,data:{turn:3,stopReason:'error'}});
    await execution.waitForTurnWrites('auto-chat');
    assert.equal(chatStore.getMessage('auto-chat','runtime-auto-session-21').completionStatus,'cancelled');
    assert.equal(chatStore.getMessage('auto-chat','runtime-auto-session-30').completionStatus,'failed');
    assert.equal(events.filter(event=>event.chatId==='auto-chat').length,6);
  }finally{await execution.close();chatStore.close();database.close();await rm(root,{recursive:true,force:true});}
});
