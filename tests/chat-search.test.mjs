import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {ChatStore} from '../scripts/chat-store.mjs';
import {createAssistantConversations} from '../scripts/assistant-conversations.mjs';
import {createChatSearch} from '../scripts/chat-search.mjs';

test('persisted search finds old messages, literal wildcards, excludes private conversations and locates a bounded page',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const stateDir=await mkdtemp(path.join(base,'search-test-'));let store;
  try{
    store=await new ChatStore({stateDir}).init();
    await store.ensureChat({chatId:'main',projectId:null,title:'Research'});
    const assistants=createAssistantConversations({chatStore:store});
    const hidden=await assistants.ensure('global','global',{providerId:'p',modelId:'m'});
    await store.appendMessage({chatId:hidden.id,role:'user',text:'needle private 100%'});
    for(let i=0;i<75;i++)await store.appendMessage({chatId:'main',id:'message-'+i,role:'user',text:i===4?'needle 100% exact':'ordinary '+i});
    store.close();store=await new ChatStore({stateDir}).init();
    const search=createChatSearch({chatStore:store});
    assert.equal(search.search('needle').results.length,1);
    assert.equal(search.search('%').results.length,1);
    const page=await search.locate('main','message-4');
    assert.equal(page.messages.length,60);assert.ok(page.messages.some(m=>m.id==='message-4'));
    assert.equal(await search.locate(hidden.id,'missing'),null);
  }finally{store?.close();await rm(stateDir,{recursive:true,force:true});}
});
