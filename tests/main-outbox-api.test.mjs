import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {createDesktopApi} from '../scripts/desktop-api.mjs';

test('API preserves FIFO snapshots, projects tools, pauses after stop and never replays a finished item', {timeout:15000}, async () => {
  const base=path.resolve('.sciencescope-local/temp');
  await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'outbox-api-'));
  const sent=[];
  const host={
    capabilities:{tokenStreaming:true},listProviders:async()=>[],
    getRuntimeConfig:async()=>({}),observeSession:()=>()=>{},
    startSession:async({sessionId})=>sessionId||'outbox-session',
    configureReasoning:async()=>{},configurePolicy:async()=>{},
    releaseSession:async()=>{},close:async()=>{},
    async send({text,onEvent}) {
      sent.push(text);
      onEvent({type:'tool-call',callId:'call:1',name:'read',argumentsPreview:'fixture.txt'});
      onEvent({type:'tool-result',callId:'call:1',isError:false,resultPreview:'fixture body'});
      onEvent({type:'completed',text:'done'});
    },
  };
  const api=await createDesktopApi({dataRoot:root,runtimeHost:host});
  const server=createServer((req,res)=>void api.handle(req,res));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(route,body) {
    const response=await fetch(origin+route,{
      method:body===undefined?'GET':'POST',
      headers:body===undefined?{}:{'content-type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
      signal:AbortSignal.timeout(7000),
    });
    const text=await response.text();
    return {status:response.status,body:response.headers.get('content-type')?.includes('ndjson')
      ?text.trim().split('\n').filter(Boolean).map(JSON.parse):JSON.parse(text)};
  }
  try {
    const seed={chatId:'outbox-chat',projectId:null,text:'seed',model:{providerId:'fixture',modelId:'fixture'},userMessageId:'seed-user',assistantMessageId:'seed-assistant'};
    assert.equal((await request('/api/chat',seed)).status,200);
    const enqueue=async(n)=>request('/api/chat/outbox',{action:'enqueue',chatId:seed.chatId,input:{...seed,text:`stored-${n}`,userMessageId:`queued-user-${n}`,assistantMessageId:`queued-assistant-${n}`}});
    const first=(await enqueue(1)).body.items[0];
    const second=(await enqueue(2)).body.items[1];
    assert.equal((await request('/api/chat',{chatId:seed.chatId,outboxId:second.id})).status,409);
    assert.equal(sent.length,1);
    const result=await request('/api/chat',{chatId:seed.chatId,outboxId:first.id,text:'tampered',model:{providerId:'bad',modelId:'bad'}});
    assert.equal(result.status,200);
    assert.equal(result.body.at(-1).type,'completed');
    assert.equal(sent.at(-1),'stored-1');
    assert.equal((await request('/api/chat',{chatId:seed.chatId,outboxId:first.id})).status,409);
    assert.equal(sent.length,2);
    const history=(await request('/api/chats/outbox-chat/messages')).body;
    assert.equal(history.total,4);
    assert.equal(history.messages.filter(message=>message.role==='system').length,0);
    const answer=history.messages.find(message=>message.id==='queued-assistant-1');
    assert.equal(answer.toolActivity[0].name,'read');
    assert.equal(answer.toolActivity[0].argumentsPreview,'fixture.txt');
    assert.equal(answer.toolActivity[0].resultPreview,'fixture body');
    assert.equal(answer.toolActivity[0].status,'completed');
    await request('/api/chat/stop',{chatId:seed.chatId});
    assert.equal((await request('/api/chat/outbox?chatId=outbox-chat')).body.paused,true);
    assert.equal((await request('/api/chat',{chatId:seed.chatId,outboxId:second.id})).status,409);
    await request('/api/chat/outbox',{action:'resume',chatId:seed.chatId});
    assert.equal((await request('/api/chat',{chatId:seed.chatId,outboxId:second.id})).status,200);
    assert.equal((await request('/api/chat/outbox?chatId=outbox-chat')).body.items.length,0);
  } finally {
    await api.close();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});
