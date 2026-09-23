import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {mkdir, rm, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createDesktopApi} from '../scripts/desktop-api.mjs';

async function fixture() {
  const base=path.resolve('.sciencescope-local/temp'); await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'main-interrupt-'));
  const state={sessions:new Map(),observers:new Map(),contextReads:0,interrupts:[],sendCount:0,releaseStart:null,startEntered:null,sendEntered:null};
  const host={capabilities:{tokenStreaming:true,reasoningEffort:false},listProviders:async()=>[],getRuntimeConfig:async()=>({}),observeSession:(id,callback)=>{state.observers.set(id,callback);return ()=>state.observers.delete(id);},getContextUsage:async()=>{state.contextReads++;return null;},
    startSession:async({sessionId})=>{const id=sessionId||`session-${state.sessions.size+1}`;if(state.releaseStart){state.startEntered?.();await state.releaseStart;state.releaseStart=null;}state.sessions.set(id,{resolve:null});return id;},
    configureReasoning:async()=>{},configurePolicy:async()=>{},releaseSession:async()=>{},close:async()=>{},
    send:async({sessionId,onEvent})=>{state.sendCount++;state.sendEntered?.();const s=state.sessions.get(sessionId);onEvent({type:'text-delta',delta:'partial'});await new Promise((resolve,reject)=>{s.resolve=()=>{onEvent({type:'text-delta',delta:' after-stop'});reject(new Error('interrupted'));};});},
    interrupt:async id=>{state.interrupts.push(id);state.sessions.get(id)?.resolve?.();}};
  const api=await createDesktopApi({dataRoot:root,runtimeHost:host});const server=createServer((req,res)=>api.handle(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
  const call=(route,body)=>new Promise((resolve,reject)=>{const raw=JSON.stringify(body);const req=httpRequest({hostname:'127.0.0.1',port,path:route,method:'POST',headers:{host:`127.0.0.1:${port}`,'content-type':'application/json','content-length':Buffer.byteLength(raw)}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,text,events:text.trim().split('\n').filter(Boolean).map(JSON.parse)}));});req.on('error',reject);req.end(raw);});
  const get=(route)=>new Promise((resolve,reject)=>{const req=httpRequest({hostname:'127.0.0.1',port,path:route,method:'GET',headers:{host:`127.0.0.1:${port}`}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));});req.on('error',reject);req.end();});
  return {root,state,call,get,close:async()=>{await api.close();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}};
}
const input=(chatId,temporary=false,suffix='1')=>({chatId,temporary,projectId:null,text:'question',model:{providerId:'fixture',modelId:'fixture'},userMessageId:`user-${chatId}-${suffix}`,assistantMessageId:`assistant-${chatId}-${suffix}`});

test('active normal run is interrupted and preserves partial output once',async()=>{const f=await fixture();try{const entered=new Promise(r=>f.state.sendEntered=r);const run=f.call('/api/chat',input('chat-a'));await entered;const stop=await f.call('/api/chat/stop',{chatId:'chat-a'});assert.equal(stop.events[0].stopped,true);const result=await run;assert.equal(result.events.at(-1).type,'cancelled');assert.equal(result.events.at(-1).text,'partial after-stop');assert.equal(f.state.interrupts.length,1);}finally{await f.close();}});
test('existing binding supports a second turn and stores one assistant row per turn',async()=>{const f=await fixture();try{let entered=new Promise(r=>f.state.sendEntered=r);const first=f.call('/api/chat',input('chat-second'));await entered;await f.call('/api/chat/stop',{chatId:'chat-second'});await first;entered=new Promise(r=>f.state.sendEntered=r);const second=f.call('/api/chat',input('chat-second',false,'2'));await entered;await f.call('/api/chat/stop',{chatId:'chat-second'});await second;const page=await f.get('/api/chats/chat-second/messages');assert.equal(page.status,200);assert.equal(page.body.messages.filter(m=>m.role==='assistant').length,2);}finally{await f.close();}});
test('setup cancellation does not send after session creation race',async()=>{const f=await fixture();try{let release;f.state.releaseStart=new Promise(r=>release=r);const entered=new Promise(r=>f.state.startEntered=r);const run=f.call('/api/chat',input('chat-setup'));await entered;const stop=await f.call('/api/chat/stop',{chatId:'chat-setup'});assert.equal(stop.events[0].stopped,true);release();const result=await run;assert.equal(result.status,200,result.text);assert.deepEqual(result.events.at(-1),{type:'cancelled',chatId:'chat-setup',text:''});assert.equal(f.state.sendCount,0);}finally{await f.close();}});
test('temporary stop uses a separate key without affecting Main',async()=>{const f=await fixture();try{const stop=await f.call('/api/chat/stop',{chatId:'temp-a',temporary:true});assert.equal(stop.events[0].stopped,false);assert.equal(f.state.interrupts.length,0);}finally{await f.close();}});

test('background activity reports running, queue and approval without reading context or restoring runtimes',async()=>{
  const f=await fixture();
  try{
    assert.deepEqual((await f.get('/api/chat/activity')).body.activities,[]);
    const entered=new Promise(resolve=>f.state.sendEntered=resolve);
    const run=f.call('/api/chat',input('background-a'));
    await entered;
    const activity=async()=>(await f.get('/api/chat/activity')).body.activities.find(item=>item.chatId==='background-a');
    assert.equal((await activity()).state,'running');
    const queue=await f.call('/api/chat/outbox',{action:'enqueue',chatId:'background-a',input:{...input('background-a',false,'queued'),text:'later'}});
    assert.equal(queue.status,200);
    assert.equal((await activity()).queuedCount,1);
    const observer=[...f.state.observers.values()][0];
    observer({type:'control-event',event:{type:'approval-request',requestId:'ask-1',toolName:'read'}});
    assert.equal((await activity()).state,'waiting-approval');
    observer({type:'control-event',event:{type:'approval-cancelled',requestId:'ask-1'}});
    await f.call('/api/chat/stop',{chatId:'background-a'});await run;
    assert.equal((await activity()).state,'paused');
    const queuedId=queue.events[0].items[0].id;
    await f.call('/api/chat/outbox',{action:'cancel',chatId:'background-a',id:queuedId});
    assert.equal((await activity()).state,'stopped');
    assert.equal(f.state.contextReads,0);
    assert.equal(f.state.sessions.size,1);
  }finally{await f.close();}
});
