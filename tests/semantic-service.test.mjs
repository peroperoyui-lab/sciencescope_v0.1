import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {openApplicationDatabaseSync} from '../scripts/application-database.mjs';
import {createResearchStore} from '../scripts/research-base/store.mjs';
import {createSemanticService} from '../scripts/research-base/semantic-service.mjs';
import {recallForTurn} from '../scripts/research-base/recall.mjs';

test('semantic indexing is local, explicitly enabled, pauses for dialogue and resumes durable settings',async()=>{
  const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
  const root=await mkdtemp(path.join(base,'semantic-'));let service;
  const database=openApplicationDatabaseSync({stateDir:root}),store=createResearchStore({db:database.db});
  let busy=false,warmed=0,indexed=0,closed=0;
  const fakeEmbedding={async warmup(){warmed++;},async close(){closed++;}};
  const versions=new Map();
  const dependencies={database,store,dataRoot:root,isBusy:()=>busy,
    hardware:async()=>({supported:true,avx2:true,memoryBytes:16*1024**3,freeBytes:10*1024**3}),verifyFiles:async()=>true,
    embeddingFactory:()=>fakeEmbedding,vectorFactory:()=>({
      async upsertDocuments(docs){for(const doc of docs){versions.set(doc.ref.id,doc.version);indexed++;}},
      async removeMissing(){},async search(){return {rankings:[]};},async close(){closed++;}
    })};
  try{
    store.createItem({type:'memory',subtype:'goal',title:'Research goal',body:'Test content',scope:'personal'});
    service=createSemanticService(dependencies);await service.start();
    assert.equal(service.status().enabled,false);assert.equal(warmed,0);
    assert.equal((await service.search({queries:['q'],candidates:[]})).fallbackReason,'model-missing');
    busy=true;await service.configure('enable');await service.idle();assert.equal(indexed,0);
    busy=false;await service.idle();assert.equal(service.status().state,'ready');assert.equal(indexed,1);assert.equal(warmed,1);
    await service.close();assert.equal(closed,2);
    service=createSemanticService(dependencies);await service.start();await service.idle();assert.equal(service.status().enabled,true);assert.equal(warmed,2);
    await service.configure('disable');assert.equal(service.status().enabled,false);
  }finally{await service?.close();database.close();await rm(root,{recursive:true,force:true});}
});

test('turn recall is bounded, excludes brief entries and never mutates the full user text',async()=>{
  let input;
  const retrieval={async searchHybrid(value){input=value;return {mode:'hybrid',hits:Array.from({length:30},(_,i)=>({ref:{type:'item',id:String(i)},cite:`[@${i}]`,title:`Entry${i}`,snippet:'x'.repeat(170)}))};}};
  const userText='q'.repeat(3000);
  const result=await recallForTurn(retrieval,{text:userText,projectId:'p1',briefRefs:[{type:'item',id:'0'}]});
  assert.ok(result.text.length<=1500);assert.ok(result.refs.length<=8);assert.ok(!result.refs.some(ref=>ref.id==='0'));
  assert.equal(input.query.length,2000);assert.equal(userText.length,3000);assert.equal(input.audience,'agent');
  assert.deepEqual(input.itemTypes,['memory','knowledge','model','claim']);
});
