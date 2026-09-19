// Explicit opt-in against the running desktop host. Does not change providers,
// read/export keys, or claim a nonexistent project. Never part of npm test.
import assert from 'node:assert/strict';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
const origin=new URL(process.argv[2]||'');
if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1')throw new Error('Pass the local desktop host URL');
const request=async(route,body)=>{
  const response=await fetch(new URL('/api/'+route,origin),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  if(!response.ok)throw new Error('Application '+route+': HTTP '+response.status);
  return response;
};
const {providers}=await(await request('providers')).json();
const provider=providers.find(p=>p.name==='OpenCode Go'&&p.configured);
assert.ok(provider,'The saved OpenCode Go provider must already exist');
const modelId=provider.models.find(id=>id==='deepseek-v4.1-flash');
assert.ok(modelId,'The explicitly selected model must already be configured');
const chatId='agent-acceptance-'+Date.now();let completed=false;
const fixture=path.resolve('.sciencescope-local/projects/independent/sciencescope-communication-smoke.txt');
await writeFile(fixture,'SCIENCESCOPE_COMMUNICATION_OK\n',{flag:'wx'});
try{
  const response=await request('chat',{chatId,projectId:null,model:{providerId:provider.id,modelId},executionMode:'ask',title:'客户端工具连通验收',text:'Use a filesystem tool to read only sciencescope-communication-smoke.txt in your current working directory. Do not modify any file or read anything else. Reply with the exact sentinel found in that file.'});
  const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(!events.some(e=>e.type==='failed'),'Runtime failed');
  completed=events.some(e=>e.type==='completed');
  const text=events.filter(e=>e.type==='text-delta').map(e=>e.delta).join('');
  const calls=events.filter(e=>e.type==='tool-call');const results=events.filter(e=>e.type==='tool-result');
  assert.ok(completed);assert.ok(text.includes('SCIENCESCOPE_COMMUNICATION_OK'));
  assert.ok(calls.length>0);assert.ok(calls.every(call=>results.some(result=>result.callId===call.callId&&!result.isError)));
  const page=await(await request('chats/'+chatId+'/messages?limit=60')).json();
  assert.ok(page.messages.some(m=>m.role==='assistant'&&m.text.includes('SCIENCESCOPE_COMMUNICATION_OK')));
  console.log(JSON.stringify({provider:provider.name,model:modelId,applicationTurns:1,textDelta:true,toolCalls:calls.length,matchingToolResults:results.length,completed,persisted:true}));
}finally{
  await unlink(fixture);
  // Soft-delete only this test's presentation entry; runtime evidence remains local.
  if(completed)await request('chats/delete',{chatId});
}
