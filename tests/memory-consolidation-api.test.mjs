import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {ChatStore} from '../scripts/chat-store.mjs';
import {createAssistantConversations} from '../scripts/assistant-conversations.mjs';
import {createResearchBase} from '../scripts/research-base/index.mjs';
import {createDesktopApi} from '../scripts/desktop-api.mjs';

const model={providerId:'memory-api-local',modelId:'offline'};
async function fixture(){
  const base=path.resolve('.sciencescope-local/temp/t09-validation/api');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'run-'));const seed=await new ChatStore({stateDir:path.join(root,'.sciencescope-local/state')}).init();
  for(const id of ['main','no-model','private','stale']){
    await seed.ensureChat({chatId:id,...(id==='no-model'?{}:{model})});
    await seed.appendMessage({chatId:id,id:'u-'+id,role:'user',text:'Use paired measurements as the primary endpoint.',completionStatus:'completed'});
  }
  seed.db.db.exec('ALTER TABLE chats ADD COLUMN is_private INTEGER DEFAULT 0');seed.db.db.prepare('UPDATE chats SET is_private=1 WHERE id=?').run('private');
  const assistant=await createAssistantConversations({chatStore:seed}).ensure('global','global',model);
  const research=createResearchBase({database:seed.db,resolveResourcePath:async()=>null});
  const source=research.store.addSource({id:'external-source',kind:'webpage',title:'External fixture',url:'https://example.invalid/paper'});
  research.store.recordUsage({chatId:'main',messageId:'u-main',refs:[{type:'source',id:source.id}],how:'read'});
  const target=research.store.createItem({id:'itm_t09endpoint',type:'memory',subtype:'decision',scope:'personal',title:'Primary endpoint',body:'Use paired measurements as the primary endpoint.'});
  await research.ingest.idle();seed.close();
  const state={sessions:[],requests:[],target,hold:null,entered:null};
  const host={capabilities:{tokenStreaming:true},listProviders:async()=>[{id:model.providerId,models:[model.modelId]}],
    getRuntimeConfig:async()=>({}),getContextUsage:async()=>null,observeSession:()=>()=>{},setToolHandler:()=>{},
    configureBrief:async()=>{},configurePolicy:async()=>{},configureReasoning:async()=>{},releaseSession:async()=>{},close:async()=>{},
    startSession:async options=>{state.sessions.push(options);return options.sessionId||'memory-api-session-'+state.sessions.length;},
    send:async input=>{state.requests.push(input);
      let text='MAIN_DONE';
      if(input.text.startsWith('Extract research memory candidates')){
        const messages=JSON.parse(input.text.split('Original messages:')[1]);const message=messages.find(row=>row.speaker==='user')||messages[0];
        state.current=message;
        text=JSON.stringify({candidates:[{type:'memory',subtype:'decision',title:'Primary endpoint',body:'Use paired measurements as the primary endpoint.',payload:{},evidence:[{messageId:message.id,quote:'Use paired measurements as the primary endpoint.'}]}]});
      }else if(input.text.startsWith('Compare each proposed candidate')){
        const comparisons=JSON.parse(input.text.split('Comparisons:')[1]);const update=state.current.id==='u-stale';
        if(update)assert.ok(comparisons[0].items.some(item=>item.id===target.id));
        text=JSON.stringify({decisions:[{candidateIndex:0,op:update?'update':'create',targetId:update?target.id:null,rationale:'Offline route fixture.'}]});
      }else if(state.hold){state.entered?.();await state.hold;}
      input.onEvent?.({type:'completed',text});return {finalResponse:text};
    }};
  const apiToken='t09-local-route-token';const api=await createDesktopApi({dataRoot:root,runtimeHost:host,apiToken});
  const server=createServer((request,response)=>api.handle(request,response));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  async function call(route,body,authorized=true){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`,{method:body===undefined?'GET':'POST',headers:{...(authorized?{authorization:'Bearer '+apiToken}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const raw=await response.text();const records=raw.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));return {status:response.status,body:records.length===1?records[0]:records};}
  await call('research/consolidate/settings',{enabled:false});
  return {root,state,assistant,call,close:async()=>{await api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert.ok(root.startsWith(base+path.sep));await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});}};
}

test('consolidation routes authenticate, persist settings and reject unavailable Main contexts without model work',async()=>{
  const f=await fixture();try{
    assert.equal((await f.call('research/consolidate/settings',undefined,false)).status,401);
    assert.equal((await f.call('research/consolidate',{chatId:'main'},false)).status,401);
    const settings={enabled:false,idleMinutes:17,model};assert.deepEqual((await f.call('research/consolidate/settings',settings)).body,settings);
    assert.deepEqual((await f.call('research/consolidate/settings')).body,settings);
    assert.equal((await f.call('research/consolidate/settings',{idleMinutes:0})).status,400);
    await f.call('research/consolidate/settings',{model:null});
    const noModel=await f.call('research/consolidate',{chatId:'no-model'});assert.equal(noModel.status,409);assert.equal(noModel.body.code,'MODEL_NOT_AVAILABLE');
    for(const chatId of ['private',f.assistant.id,'missing'])assert.equal((await f.call('research/consolidate',{chatId})).status,404);
    assert.equal(f.state.requests.length,0);
  }finally{await f.close();}
});

test('external consolidation provenance survives edited acceptance and cannot be downgraded through the API',async()=>{
  const f=await fixture();try{
    const run=await f.call('research/consolidate',{chatId:'main'});assert.equal(run.status,200);assert.equal(run.body.state,'completed');assert.equal(run.body.proposalIds.length,1);
    const pending=(await f.call('research/proposals?status=pending')).body.proposals;const proposal=pending.find(p=>p.id===run.body.proposalIds[0]);
    assert.equal(proposal.origin.role,'consolidator');assert.deepEqual(proposal.origin.range,{from:1,to:1});assert.equal(proposal.payload.item.payload.originTrust,'external');
    assert.equal((await f.call('research/items?type=memory')).body.items.length,1,'only the seeded item exists before confirmation');
    for(const payload of [{originTrust:'user'},{sourceRefs:[]}]){
      const decision=await f.call('research/proposals/decide',{id:proposal.id,accept:true,edits:{item:{payload}}});assert.equal(decision.status,409);assert.equal(decision.body.code,'PROVENANCE_CHANGED');
    }
    const scope=await f.call('research/proposals/decide',{id:proposal.id,accept:true,edits:{item:{scope:'project'}}});assert.equal(scope.status,409);
    const accepted=await f.call('research/proposals/decide',{id:proposal.id,accept:true,edits:{item:{title:'User edited endpoint',body:'Approved paired endpoint.'}}});assert.equal(accepted.status,200);
    const item=(await f.call('research/item?id='+accepted.body.resultId)).body.item;
    assert.equal(item.title,'User edited endpoint');assert.equal(item.payload.originTrust,'external');assert.deepEqual(item.payload.sourceRefs,proposal.payload.item.payload.sourceRefs);
    assert.equal(f.state.requests.length,2);assert.ok(f.state.sessions.every(session=>session.noTools===true));assert.deepEqual(f.state.sessions.map(session=>session.maxTokens),[8192,8192]);
  }finally{await f.close();}
});

test('stale consolidation updates remain pending after a conflicting user edit',async()=>{
  const f=await fixture();try{
    const run=await f.call('research/consolidate',{chatId:'stale'});assert.equal(run.status,200);
    const changed=await f.call('research/items/update',{id:f.state.target.id,patch:{body:'A newer user revision.',expectedRevision:f.state.target.revision}});assert.equal(changed.status,200);
    const decision=await f.call('research/proposals/decide',{id:run.body.proposalIds[0],accept:true});assert.equal(decision.status,409);assert.equal(decision.body.code,'REVISION_CONFLICT');
    assert.equal((await f.call('research/item?id='+f.state.target.id)).body.item.body,'A newer user revision.');
    assert.ok((await f.call('research/proposals?status=pending')).body.proposals.some(p=>p.id===run.body.proposalIds[0]));
  }finally{await f.close();}
});

test('manual consolidation refuses a concurrently executing Main turn',async()=>{
  const f=await fixture();let release;try{
    f.state.hold=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{f.state.entered=resolve;});
    const turn=f.call('chat',{chatId:'busy-main',projectId:null,model,text:'Hold this Main turn.',userMessageId:'busy-user',assistantMessageId:'busy-answer'});
    let timer;try{await Promise.race([entered,turn.then(value=>{throw new Error('Main returned before entering held runtime: '+JSON.stringify(value));}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Main never entered held runtime')),15000);})]);}finally{clearTimeout(timer);}
    const run=await f.call('research/consolidate',{chatId:'busy-main'});assert.equal(run.status,409);assert.equal(run.body.code,'CHAT_BUSY');
    release();await turn;assert.equal(f.state.requests.length,1);
  }finally{release?.();await f.close();}
});
