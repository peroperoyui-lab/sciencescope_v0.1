/** Opt-in, offline end-to-end chat persistence/move smoke. Uses real DSH host. */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createDesktopApi } from './desktop-api.mjs';
import {openApplicationDatabase} from './application-database.mjs';

const tempRoot = path.resolve('.sciencescope-local','temp');
await mkdir(tempRoot,{recursive:true});
const root = await mkdtemp(path.join(tempRoot, 'sciencescope-chat-api-'));
const requests = [];
const fixture = createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
  let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const parsed = JSON.parse(body); requests.push(parsed);
    const text = `OFFLINE_REPLY_${requests.length}`;
    response.writeHead(200, {'content-type':'text/event-stream', connection:'keep-alive'});
    response.write(`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\n`);
    response.end(`data: ${JSON.stringify({choices:[{delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
let api; let server;
const model = { providerId: 'sciencescope-offline-fixture', modelId: 'offline-model' };
async function json(url, body) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'content-type':'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  return { response, body: await response.json() };
}
async function stream(url, body) {
  const response = await fetch(url, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(60_000)});
  if (!response.ok) throw new Error(`chat HTTP ${response.status}`);
  const events = [];const decoder=new TextDecoder();let buffer='';
  for await (const chunk of response.body) {buffer+=decoder.decode(chunk,{stream:true});const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines.filter(Boolean))events.push(JSON.parse(line));}
  if (events.some(event => event.type === 'failed')) throw new Error('chat stream failed');
  return events;
}
try {
  await mkdir(path.join(root, '.sciencescope-local'), {recursive:true});
  api = await createDesktopApi({dataRoot:root,onError:error=>console.error('Local fixture failure:',error.message)});
  server = createServer((request,response) => void api.handle(request,response));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixturePort = fixture.address().port;
  await json(`${origin}/api/workspace`, {projects:[{id:'project-1',name:'Offline Project',desc:'Move context',archived:false}],pins:[],projectExpanded:{'project-1':true},lastChatId:null});
  const saved = await json(`${origin}/api/providers/save`, {id:model.providerId,name:'Offline Fixture',baseUrl:`http://127.0.0.1:${fixturePort}/v1`,protocol:'openai-chat-completions',models:[model.modelId],apiKey:'offline-fixture'});
  if (!saved.response.ok) throw new Error(`provider save HTTP ${saved.response.status}`);
  const first = await stream(`${origin}/api/chat`, {projectId:null,chatId:'chat-smoke',userMessageId:'u1',assistantMessageId:'a1',model,text:'FIRST_OFFLINE_PROMPT'});
  if (!first.some(event => event.type === 'completed')) throw new Error('first chat did not complete');
  const inspect=await openApplicationDatabase({stateDir:path.join(root,'.sciencescope-local/state')});
  const originalSession=inspect.db.prepare('SELECT runtime_session_id FROM chats WHERE id=?').get('chat-smoke').runtime_session_id;inspect.close();
  await api.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); api = null;
  api = await createDesktopApi({dataRoot:root}); server = createServer((request,response) => void api.handle(request,response)); await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin2 = `http://127.0.0.1:${server.address().port}`;
  const page = await json(`${origin2}/api/chats/chat-smoke/messages?limit=60`); if (!page.response.ok || page.body.messages.length !== 2) throw new Error('restart did not restore transcript');
  const moved = await json(`${origin2}/api/chats/move`, {chatId:'chat-smoke',projectId:'project-1'}); if (!moved.response.ok) throw new Error(`move failed HTTP ${moved.response.status}`);
  const second = await stream(`${origin2}/api/chat`, {projectId:'project-1',chatId:'chat-smoke',userMessageId:'u2',assistantMessageId:'a2',model,text:'SECOND_OFFLINE_PROMPT'}); if (!second.some(event => event.type === 'completed')) throw new Error('moved chat did not complete');
  const inspectAfter=await openApplicationDatabase({stateDir:path.join(root,'.sciencescope-local/state')});
  const restoredSession=inspectAfter.db.prepare('SELECT runtime_session_id FROM chats WHERE id=?').get('chat-smoke').runtime_session_id;inspectAfter.close();if(restoredSession!==originalSession)throw new Error('runtime binding identity changed');
  const before = (await json(`${origin2}/api/chats`)).body.chats.length;
  await stream(`${origin2}/api/chat`, {projectId:'project-1',chatId:'quick-smoke',temporary:true,model,text:'TEMPORARY_PROMPT',projectName:'Offline Project',projectGoal:'Quick context'});
  const after = (await json(`${origin2}/api/chats`)).body.chats.length; if (before !== after) throw new Error('temporary chat entered persistent list');
  const closed = await json(`${origin2}/api/chats/temporary-close`,{chatId:'quick-smoke'});if(!closed.response.ok||!closed.body.closed)throw new Error('temporary session cleanup failed');
  const prompts = requests.map(request => request.messages?.map(message => message.content).join('\n') || '');
  if(!prompts[1].includes('FIRST_OFFLINE_PROMPT')||!prompts[1].includes('SECOND_OFFLINE_PROMPT'))throw new Error('resumed request lost history');
  if(prompts[2].includes('FIRST_OFFLINE_PROMPT')||prompts[2].includes('SECOND_OFFLINE_PROMPT'))throw new Error('temporary question leaked Main history');
  if (!prompts.some(prompt => prompt.includes('FIRST_OFFLINE_PROMPT'))) throw new Error('fixture did not receive first prompt');
  if (!prompts.some(prompt => prompt.includes('Offline Project') && prompt.includes('SECOND_OFFLINE_PROMPT'))) throw new Error('moved project context missing');
  const automatic=await stream(`${origin2}/api/chat`,{projectId:'project-1',chatId:'chat-auto',userMessageId:'goal-user',model,text:'Continue the local test for two rounds.',executionMode:'auto',goalMaxRounds:2});
  if(!automatic.some(event=>event.type==='goal-started'))throw new Error('desktop goal did not start');
  let goalStatus,goalMessages;
  for(let i=0;i<80;i++){
    goalStatus=(await json(`${origin2}/api/execution?chatId=chat-auto`)).body;
    goalMessages=(await json(`${origin2}/api/chats/chat-auto/messages`)).body.messages;
    if(goalStatus.goal?.phase==='blocked'&&goalMessages.length===3)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(goalStatus.goal?.phase!=='blocked'||goalMessages.length!==3)throw new Error('automatic committed output was not persisted');
  if(goalMessages.filter(m=>m.role==='assistant').length!==2)throw new Error('automatic assistant turns missing or duplicated');
  const stopped=await json(`${origin2}/api/execution/goal`,{chatId:'chat-auto',action:'stop'});
  if(!stopped.response.ok||stopped.body.goal!==null)throw new Error('stopping goal did not clear objective');
  console.log(JSON.stringify({automation:true,rounds:goalStatus.goal.roundsStarted,phase:goalStatus.goal.phase,persistedMessages:goalMessages.length}));
  console.log(JSON.stringify({passed:true, restoredMessages:page.body.messages.length, fixtureRequests:requests.length, preservedSession:true, movedProjectContext:true, temporaryExcluded:true}));
} finally {
  server?.closeAllConnections(); if (server) await new Promise(resolve => server.close(resolve));
  await api?.close(); fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve));
  await rm(root,{recursive:true,force:true});
}
