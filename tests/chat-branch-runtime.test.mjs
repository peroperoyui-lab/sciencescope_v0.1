import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';
import {createDesktopApi} from '../scripts/desktop-api.mjs';

const model={providerId:'t12-local',modelId:'fixture'};
const sourceId='chat-t12-source';
const messageText=content=>typeof content==='string'?content:Array.isArray(content)?content.map(part=>part?.text??'').join(''):'';

// The fixture is an OpenAI-compatible loopback model. The application and DSH
// remain real; every prompt received by the fixture is recorded by session ID.
test('T12 app branches preserve DSH context, drafts and bindings across restart', {timeout:180_000}, async()=>{
  const base=path.resolve('.sciencescope-local/temp/t12-branch-validation/runtime');
  await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'run-'));
  const requests=[];
  const errors=[];
  const runtimeEvents=[];
  const committedTurnEnds=[];
  let fixture,host,api,server;
  const closeApp=async()=>{
    if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;}
    if(api){await api.close();api=null;host=null;}
    else if(host){await host.close();host=null;}
  };
  try{
    fixture=createServer(async(request,response)=>{
      let body='';for await(const chunk of request)body+=chunk;
      const input=JSON.parse(body);
      const messages=(input.messages??[]).map(message=>({role:message.role,text:messageText(message.content)}));
      const sessionId=String(request.headers['x-t12-session']??'');
      requests.push({sessionId,messages});
      const users=messages.filter(message=>message.role==='user').map(message=>message.text);
      const turn=users.filter(text=>/TURN_[A-Z]+/u.test(text)).at(-1)?.match(/TURN_[A-Z]+/u)?.[0]??'NONE';
      response.writeHead(200,{'content-type':'text/event-stream'});
      response.write(`data: ${JSON.stringify({choices:[{delta:{content:`ANSWER_${turn}`}}]})}\n\n`);
      response.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
      response.end('data: [DONE]\n\n');
    });
    await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
    const runtimeConfig={providers:{'t12-local':{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:'SCIENCESCOPE_T12_LOCAL_KEY',models:[{id:'fixture',contextWindow:32768,maxTokens:256}]}}};
    const openApp=async()=>{
      host=await createDshHost({home:path.join(root,'.sciencescope-local','dsh'),cwd:path.join(root,'.sciencescope-local','projects'),sessionHeaders:['x-t12-session'],env:{SCIENCESCOPE_T12_LOCAL_KEY:'fixture-only'}});
      const originalStart=host.startSession.bind(host),originalRelease=host.releaseSession.bind(host),originalTurns=host.sessionTurns.bind(host);
      host.startSession=async options=>{runtimeEvents.push({type:'start',requested:options.sessionId});const result=await originalStart(options);runtimeEvents.push({type:'started',sessionId:result});return result;};
      host.releaseSession=async sessionId=>{runtimeEvents.push({type:'release',sessionId});return originalRelease(sessionId);};
      host.sessionTurns=async options=>{runtimeEvents.push({type:'turns',sessionId:options.sessionId});return originalTurns(options);};
      const originalObserve=host.observeSession.bind(host);
      host.observeSession=(sessionId,observer)=>originalObserve(sessionId,frame=>{
        const event=frame.type==='control-event'?frame.event:frame;
        if(event?.type==='committed-event'&&event.eventType==='turn/end')committedTurnEnds.push({sessionId,seq:event.seq,stopReason:event.data?.stopReason});
        observer(frame);
      });
      host.listProviders=async()=>[{id:model.providerId,models:[{id:model.modelId}]}];
      host.getRuntimeConfig=async()=>runtimeConfig;
      api=await createDesktopApi({dataRoot:root,runtimeHost:host,onError:error=>errors.push({code:error.code??null,message:error.message,stack:error.stack})});
      server=createServer((request,response)=>{void api.handle(request,response);});
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    };
    const call=async(route,body)=>{
      const origin=`http://127.0.0.1:${server.address().port}`;
      const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(45_000)});
      const raw=await response.text();
      let value;
      if(response.headers.get('content-type')?.includes('application/x-ndjson'))value=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
      else value=raw?JSON.parse(raw):{};
      return {status:response.status,value,raw};
    };
    const send=async(chatId,turn,suffix)=>{
      const result=await call('/api/chat',{chatId,projectId:null,model,text:`Please note ${turn}.`,userMessageId:`user-${suffix}`,assistantMessageId:`assistant-${suffix}`,executionMode:'ask',workspaceChoice:{mode:'new'}});
      assert.equal(result.status,200,`${result.raw} ${JSON.stringify(errors)}`);
      assert.equal(result.value.at(-1)?.type,'completed');
      assert.equal(result.value.at(-1)?.text,`ANSWER_${turn}`);
      return result;
    };
    const page=async chatId=>{const result=await call(`/api/chats/${chatId}/messages`);assert.equal(result.status,200,result.raw);return result.value;};
    const branch=async(chatId,messageId,mode)=>{
      const result=await call('/api/chats/branch',{chatId,messageId,mode});
      assert.equal(result.status,200,`${result.raw} ${JSON.stringify(errors)}`);
      assert.ok(result.value.chatId&&result.value.title&&result.value.branchedFrom);
      return result.value;
    };
    const dbPath=path.join(root,'.sciencescope-local','state','sciencescope.sqlite');
    const bindings=()=>{const db=new DatabaseSync(dbPath,{readOnly:true});try{return db.prepare('SELECT chat_id,session_id FROM runtime_bindings ORDER BY chat_id').all();}finally{db.close();}};
    await openApp();
    await send(sourceId,'TURN_ALPHA','a');
    await send(sourceId,'TURN_BETA','b');
    const before=await page(sourceId);
    assert.deepEqual(before.messages.map(message=>[message.id,message.role,message.branchMode]),[
      ['user-a','user','reask'],['assistant-a','assistant','reply'],['user-b','user','reask'],['assistant-b','assistant','reply'],
    ]);
    assert.ok(before.messages.every(message=>message.completionStatus==='completed'&&Number.isSafeInteger(message.runtimeSeq)));
    assert.equal(before.messages[0].runtimeSeq,before.messages[1].runtimeSeq);
    assert.equal(before.messages[2].runtimeSeq,before.messages[3].runtimeSeq);
    assert.ok(before.messages[1].runtimeSeq<before.messages[3].runtimeSeq);
    assert.ok(before.messages[0].researchInput,'accepted source user carries a research-input receipt');
    const sourceBinding=bindings().find(binding=>binding.chat_id===sourceId)?.session_id;
    assert.match(sourceBinding,/^session-/u);
    const turns=await host.sessionTurns({sessionId:sourceBinding});
    assert.deepEqual(turns.turns.map(turn=>turn.endSeq),[before.messages[1].runtimeSeq,before.messages[3].runtimeSeq]);

    const reply=await branch(sourceId,'assistant-a','reply');
    assert.deepEqual(reply.branchedFrom,{chatId:sourceId,messageId:'assistant-a',title:before.chat.title});
    assert.equal(reply.draftText,before.messages[0].text);
    const replyPage=await page(reply.chatId);
    assert.equal(replyPage.chat.draftText,reply.draftText);
    assert.deepEqual(replyPage.messages.map(message=>message.text),before.messages.slice(0,2).map(message=>message.text));
    assert.deepEqual(replyPage.messages[0].researchInput,before.messages[0].researchInput);
    const replyBinding=bindings().find(binding=>binding.chat_id===reply.chatId)?.session_id;
    assert.match(replyBinding,/^session-/u);
    assert.notEqual(replyBinding,sourceBinding);
    await send(reply.chatId,'TURN_GAMMA','reply-gamma');
    const replyRequest=requests.findLast(request=>request.sessionId===replyBinding);
    const replyContext=replyRequest.messages.map(message=>message.text).join('\n');
    assert.match(replyContext,/TURN_ALPHA/u);
    assert.match(replyContext,/ANSWER_TURN_ALPHA/u);
    assert.doesNotMatch(replyContext,/TURN_BETA|ANSWER_TURN_BETA/u);

    const reask=await branch(sourceId,'user-b','reask');
    assert.deepEqual(reask.branchedFrom,{chatId:sourceId,messageId:'user-b',title:before.chat.title});
    assert.equal(reask.draftText,before.messages[2].text);
    const reaskPage=await page(reask.chatId);
    assert.equal(reaskPage.chat.draftText,reask.draftText);
    assert.deepEqual(reaskPage.messages.map(message=>message.text),before.messages.slice(0,2).map(message=>message.text));
    const reaskBinding=bindings().find(binding=>binding.chat_id===reask.chatId)?.session_id;
    assert.match(reaskBinding,/^session-/u);
    await send(reask.chatId,'TURN_DELTA','reask-delta');
    const reaskContext=requests.findLast(request=>request.sessionId===reaskBinding).messages.map(message=>message.text).join('\n');
    assert.match(reaskContext,/TURN_ALPHA|ANSWER_TURN_ALPHA/u);
    assert.doesNotMatch(reaskContext,/TURN_BETA|ANSWER_TURN_BETA|TURN_GAMMA/u);

    const first=await branch(sourceId,'user-a','reask');
    assert.equal(first.draftText,before.messages[0].text);
    const firstPage=await page(first.chatId);
    assert.equal(firstPage.chat.draftText,first.draftText);
    assert.deepEqual(firstPage.messages,[]);
    assert.equal(bindings().some(binding=>binding.chat_id===first.chatId),false);
    await send(first.chatId,'TURN_EPSILON','first-epsilon');
    const firstBinding=bindings().find(binding=>binding.chat_id===first.chatId)?.session_id;
    const firstContext=requests.findLast(request=>request.sessionId===firstBinding).messages.map(message=>message.text).join('\n');
    assert.doesNotMatch(firstContext,/TURN_ALPHA|ANSWER_TURN_ALPHA|TURN_BETA/u);

    const sourceAfter=await page(sourceId);
    assert.deepEqual(sourceAfter.messages.map(message=>message.text),before.messages.map(message=>message.text),'branching leaves source display history intact');
    await closeApp();
    await openApp();
    assert.deepEqual(bindings().filter(binding=>[sourceId,reply.chatId,reask.chatId,first.chatId].includes(binding.chat_id)).map(binding=>binding.session_id).sort(),[sourceBinding,replyBinding,reaskBinding,firstBinding].sort());
    assert.deepEqual((await page(reply.chatId)).chat.branchedFrom,reply.branchedFrom);
    assert.equal((await page(reask.chatId)).chat.draftText,reask.draftText);
    const postRestartBranch=await branch(sourceId,'assistant-a','reply');
    const postRestartBinding=bindings().find(binding=>binding.chat_id===postRestartBranch.chatId)?.session_id;
    assert.match(postRestartBinding,/^session-/u);
    await send(postRestartBranch.chatId,'TURN_THETA','restart-theta');
    const postRestartContext=requests.findLast(request=>request.sessionId===postRestartBinding).messages.map(message=>message.text).join('\n');
    assert.match(postRestartContext,/TURN_ALPHA|ANSWER_TURN_ALPHA/u);
    assert.doesNotMatch(postRestartContext,/TURN_BETA|ANSWER_TURN_BETA/u);
    await send(reply.chatId,'TURN_ZETA','reply-zeta');
    const resumedReply=requests.findLast(request=>request.sessionId===replyBinding).messages.map(message=>message.text).join('\n');
    assert.match(resumedReply,/TURN_ALPHA[\s\S]*TURN_GAMMA/u);
    assert.doesNotMatch(resumedReply,/TURN_BETA|TURN_DELTA/u);
    await send(sourceId,'TURN_ETA','source-eta');
    const resumedSource=requests.findLast(request=>request.sessionId===sourceBinding).messages.map(message=>message.text).join('\n');
    assert.match(resumedSource,/TURN_ALPHA[\s\S]*TURN_BETA/u);
    assert.doesNotMatch(resumedSource,/TURN_GAMMA|TURN_DELTA|TURN_ZETA/u);
    assert.equal((await page(reply.chatId)).messages.at(-1).text,'ANSWER_TURN_ZETA');
    assert.equal((await page(sourceId)).messages.at(-1).text,'ANSWER_TURN_ETA');
    const editReceipt=(id,seq,status)=>{const db=new DatabaseSync(dbPath);try{db.prepare('UPDATE messages SET runtime_seq=?,completion_status=? WHERE chat_id=? AND id=?').run(seq,status,sourceId,id);}finally{db.close();}};
    const originalA=before.messages[1];
    editReceipt('assistant-a',null,'completed');
    assert.equal((await page(sourceId)).messages.find(message=>message.id==='assistant-a').branchMode,null,'older rows without a DSH boundary have no branch entry');
    const old=await call('/api/chats/branch',{chatId:sourceId,messageId:'assistant-a',mode:'reply'});
    assert.equal(old.status,409,old.raw);
    assert.equal(old.value.code,'BRANCH_POINT_UNKNOWN');
    editReceipt('assistant-a',originalA.runtimeSeq,'completed');
    const originalB=before.messages[3];
    for(const status of ['failed','cancelled','pending']){
      editReceipt('assistant-b',originalB.runtimeSeq,status);
      assert.equal((await page(sourceId)).messages.find(message=>message.id==='assistant-b').branchMode,null,`${status} reply has no branch entry`);
      const denied=await call('/api/chats/branch',{chatId:sourceId,messageId:'assistant-b',mode:'reply'});
      assert.equal(denied.status,409,denied.raw);
      assert.equal(denied.value.code,'BRANCH_POINT_UNKNOWN');
    }
    editReceipt('assistant-b',originalB.runtimeSeq,'completed');
    const automatic=await call('/api/chat',{chatId:'chat-t12-auto',projectId:null,model,text:'Continue TURN_AUTO for two rounds.',userMessageId:'user-auto',assistantMessageId:'assistant-auto',executionMode:'auto',goalMaxRounds:2,workspaceChoice:{mode:'new'}});
    assert.equal(automatic.status,200,automatic.raw);
    assert.ok(automatic.value.some(event=>event.type==='goal-started'));
    let autoPage,autoStatus;
    const deadline=Date.now()+30_000;
    do{
      autoStatus=(await call('/api/execution?chatId=chat-t12-auto')).value;
      autoPage=await page('chat-t12-auto');
      if(autoStatus.goal?.phase==='blocked'&&autoPage.messages.length===3&&autoPage.messages.every(message=>message.completionStatus==='completed'&&Number.isSafeInteger(message.runtimeSeq)))break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }while(Date.now()<deadline);
    assert.equal(autoStatus.goal?.phase,'blocked',JSON.stringify(autoStatus));
    assert.equal(autoStatus.goal.roundsStarted,2);
    assert.deepEqual(autoPage.messages.map(message=>message.role),['user','assistant','assistant']);
    assert.ok(autoPage.messages.every(message=>message.completionStatus==='completed'&&Number.isSafeInteger(message.runtimeSeq)),JSON.stringify(autoPage.messages));
    assert.equal(autoPage.messages[0].runtimeSeq,autoPage.messages[1].runtimeSeq,'automatic user maps to its first completed turn');
    assert.ok(autoPage.messages[1].runtimeSeq<autoPage.messages[2].runtimeSeq);
    const autoBinding=bindings().find(binding=>binding.chat_id==='chat-t12-auto')?.session_id;
    const autoTurns=await host.sessionTurns({sessionId:autoBinding});
    assert.deepEqual(autoTurns.turns.map(turn=>turn.endSeq),autoPage.messages.slice(1).map(message=>message.runtimeSeq));
    assert.deepEqual(committedTurnEnds.filter(event=>event.sessionId===autoBinding).map(event=>event.stopReason),['completed','completed'],'bridge preserves actual DSH turn/end reasons');
    assert.equal(autoPage.messages[0].branchMode,'reask');
    assert.equal(autoPage.messages[1].branchMode,'reply');
    assert.equal(autoPage.messages[2].branchMode,'reply');
    const modelRequestsBeforeAutoBranch=requests.length;
    const autoChild=await branch('chat-t12-auto',autoPage.messages[1].id,'reply');
    const autoChildBinding=bindings().find(binding=>binding.chat_id===autoChild.chatId)?.session_id;
    assert.match(autoChildBinding,/^session-/u);
    const autoChildPage=await page(autoChild.chatId);
    assert.deepEqual(autoChildPage.messages.map(message=>message.text),autoPage.messages.slice(0,2).map(message=>message.text));
    const childExecution=await call(`/api/execution?chatId=${autoChild.chatId}`);
    assert.equal(childExecution.status,200,childExecution.raw);
    assert.equal(childExecution.value.mode,'auto','execution policy is inherited');
    assert.equal(childExecution.value.goal,null,'the child has no active automatic objective');
    assert.equal(await host.getGoal(autoChildBinding)??null,null,'the child DSH objective was explicitly cleared');
    assert.equal(requests.length,modelRequestsBeforeAutoBranch,'forking made no implicit model request');
    assert.equal((await call('/api/execution?chatId=chat-t12-auto')).value.goal?.phase,'blocked','source objective is unchanged');
    const sourceAutoAfter=await page('chat-t12-auto');
    assert.deepEqual(sourceAutoAfter.messages.map(message=>message.text),autoPage.messages.map(message=>message.text));
    const autoChildSend=await call('/api/chat',{chatId:autoChild.chatId,projectId:null,model,text:'Please note TURN_IOTA.',userMessageId:'user-auto-child',assistantMessageId:'assistant-auto-child',executionMode:'ask'});
    assert.equal(autoChildSend.status,200,autoChildSend.raw);
    assert.equal(autoChildSend.value.at(-1)?.type,'completed');
    assert.equal(autoChildSend.value.at(-1)?.text,'ANSWER_TURN_IOTA');
    const autoChildContext=requests.findLast(request=>request.sessionId===autoChildBinding).messages.map(message=>message.text).join('\n');
    assert.match(autoChildContext,/TURN_AUTO/u);
    assert.doesNotMatch(autoChildContext,/TURN_BETA|TURN_GAMMA|TURN_ETA/u);
    assert.equal((await call('/api/execution?chatId=chat-t12-auto')).value.goal?.phase,'blocked');
    assert.deepEqual((await page('chat-t12-auto')).messages.map(message=>message.text),autoPage.messages.map(message=>message.text));
    assert.deepEqual(errors,[]);
    await writeFile(path.join(base,'latest-result.json'),JSON.stringify({run:root,passed:true,modelRequests:requests.length,paidProviderRequests:0,sourceBinding,replyBinding,reaskBinding,firstBinding,postRestartBinding,autoBinding,autoChildBinding,runtimeEvents,committedTurnEnds},null,2));
  }catch(error){
    await writeFile(path.join(base,'latest-result.json'),JSON.stringify({run:root,passed:false,modelRequests:requests.length,paidProviderRequests:0,error:String(error?.stack??error),apiErrors:errors,runtimeEvents,committedTurnEnds},null,2));
    throw error;
  }finally{
    await closeApp();
    if(fixture){fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}
  }
});
