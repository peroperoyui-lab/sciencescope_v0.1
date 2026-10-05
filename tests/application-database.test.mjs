import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {ChatStore,ProfileStore} from '../scripts/chat-store.mjs';
import {openApplicationDatabase} from '../scripts/application-database.mjs';

async function fixture(t){
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'sqlite-acceptance-'));const handles=[];
  t.after(async()=>{for(const h of handles)h.close();await rm(root,{recursive:true,force:true});});
  return {root,handles};
}
test('legacy records migrate once, preserve files and reopen with exact history/binding',async t=>{
  const {root,handles}=await fixture(t);
  const legacy={version:1,chats:{'chat-old':{id:'chat-old',projectId:'p1',title:'Old',updated:'2026-01-01',messageCount:2,runtimeSessionId:'session-old',runtimeWorkspace:root}}};
  const raw=JSON.stringify(legacy);await writeFile(path.join(root,'chats.json'),raw);
  await writeFile(path.join(root,'profile.json'),JSON.stringify({displayName:'旧名字',bio:'private'}));
  await writeFile(path.join(root,'workspace.json'),JSON.stringify({version:1,projects:[{id:'p1',name:'项目',desc:'',archived:false}],pins:[],projectExpanded:{},lastChatId:'chat-old'}));
  await mkdir(path.join(root,'chat-pages/chat-old'),{recursive:true});
  await writeFile(path.join(root,'chat-pages/chat-old/00000000.json'),JSON.stringify([{id:'m1',role:'user',text:'原文',created:'2026-01-01'},{id:'m2',role:'assistant',text:'回复',created:'2026-01-01'}]));
  const store=await new ChatStore({stateDir:root}).init();handles.push(store);
  assert.equal(store.getBinding('chat-old'),'session-old');assert.equal((await store.pageMessages('chat-old')).total,2);
  // Replay the unchanged legacy import against the additive T12 schema.
  // Named INSERT columns keep the import compatible with the extra fields.
  store.db.db.prepare('DELETE FROM schema_migrations WHERE version=1').run();
  const upgraded=await new ChatStore({stateDir:root}).init();handles.push(upgraded);
  assert.equal((await upgraded.pageMessages('chat-old')).total,2);
  await store.appendMessage({chatId:'chat-old',id:'m3',role:'user',text:'新消息'});
  await store.appendMessage({chatId:'chat-old',id:'m1',role:'user',text:'重复不覆盖'});
  assert.equal((await store.pageMessages('chat-old')).total,3);
  const profile=await new ProfileStore({stateDir:root}).init();handles.push(profile);
  await profile.updateProfile({displayName:'新名字',bio:'private'});
  const reopened=await new ChatStore({stateDir:root}).init();handles.push(reopened);
  assert.equal((await reopened.pageMessages('chat-old')).messages[0].text,'原文');
  assert.equal((await reopened.pageMessages('chat-old')).total,3);
  assert.equal(await readFile(path.join(root,'chats.json'),'utf8'),raw);
  assert.equal(JSON.parse(await readFile(path.join(root,'profile.json'),'utf8')).displayName,'旧名字');
});
test('SQLite keyset history supports latest 60 and bidirectional 30-message slices',async t=>{
  const {root,handles}=await fixture(t);const store=await new ChatStore({stateDir:root}).init();handles.push(store);
  await store.ensureChat({chatId:'long'});
  for(let i=0;i<160;i++)await store.appendMessage({chatId:'long',id:'m-'+i,role:'user',text:String(i)});
  const latest=await store.pageMessages('long');assert.equal(latest.messages[0].id,'m-100');
  const older=await store.pageMessages('long',{before:latest.before,limit:30});assert.equal(older.messages[0].id,'m-70');assert.equal(older.messages.length,30);
  const newer=await store.pageMessages('long',{after:'130',limit:30});assert.equal(newer.messages.at(-1).id,'m-159');
});
test('resources persist, knowledge retains provenance, private entries require explicit namespace',async t=>{
  const {root,handles}=await fixture(t);const db=await openApplicationDatabase({stateDir:root});handles.push(db);
  db.addResource({id:'source',title:'Paper',kind:'pdf',path:'originals/paper.pdf'});
  db.proposeKnowledge({id:'candidate',namespace:'canonical',title:'Claim',content:'Requires review',sourceIds:['source']});
  assert.equal(db.getKnowledge('candidate').status,'candidate');db.acceptKnowledge('candidate');
  db.proposeKnowledge({id:'private',namespace:'private',title:'Preference',content:'Private',sourceIds:['source']});
  assert.deepEqual(db.listKnowledge().map(x=>x.id),['candidate']);
  assert.equal(db.listKnowledge({namespace:'private'}).length,1);
  assert.throws(()=>db.proposeKnowledge({id:'bad',title:'bad',content:'bad',sourceIds:['absent']}));
  const reopened=await openApplicationDatabase({stateDir:root});handles.push(reopened);
  assert.deepEqual(reopened.getKnowledge('candidate').sourceIds,['source']);
  assert.equal(reopened.getKnowledge('candidate').status,'accepted');
});
