import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviderService} from '../adapters/runtime-dsh/provider-service.mjs';
import {validateProviderDraft} from '../desktop/provider-draft.mjs';

const draft={id:'sciencescope-fixture',name:'Fixture',baseUrl:'http://127.0.0.1:9/v1',protocol:'openai-chat-completions',models:['unknown-model']};
function fixture(){
  const state={value:{providers:{}},revision:0},calls=[];
  const service=createProviderService(async(ns,method,args)=>{
    calls.push({ns,method,args});
    if(ns==='settings'&&method==='describe')return {namespaces:[{ns:'llm-pi-ai',...state}]};
    if(ns==='settings'&&method==='mutate'){for(const op of args.ops)state.value.providers[op.path[1]]=op.value;state.revision++;return {};}
    if(ns==='credentials')return {};
    if(ns==='session')return {groups:[{id:draft.id,models:[{id:'unknown-model',reasoning:{supported:false}}]}]};
    throw new Error('Unexpected RPC');
  });
  return {state,calls,service};
}
test('discovered output/context survive save, later edits and reasoning lookup',async()=>{
  const f=fixture();
  await f.service.saveProvider({...draft,modelSettings:{'unknown-model':{name:'Discovered',maxTokens:65536,contextWindow:1048576}}});
  const saved=f.state.value.providers[draft.id].models[0];
  assert.equal(saved.maxTokens,65536);assert.equal(saved.contextWindow,1048576);
  saved.compat={supportsStore:false};
  await f.service.saveProvider({...draft,name:'Edited name'});
  assert.equal(f.state.value.providers[draft.id].models[0].maxTokens,65536);
  assert.deepEqual(f.state.value.providers[draft.id].models[0].compat,{supportsStore:false});
  assert.deepEqual((await f.service.getModelInfo({providerId:draft.id,modelId:'unknown-model'})).limits,{contextWindow:1048576,maxOutputTokens:65536,source:'configured',contextSource:'configured'});
  const provider=(await f.service.listProviders())[0];assert.deepEqual(provider.models,['unknown-model']);assert.equal(provider.modelSettings['unknown-model'].maxTokens,65536);
  await f.service.saveProvider({...draft,modelSettings:{'unknown-model':{maxTokens:98304}}});
  assert.equal(f.state.value.providers[draft.id].models[0].contextWindow,1048576);
  assert.equal((await f.service.getModelInfo({providerId:draft.id,modelId:'unknown-model'})).limits.maxOutputTokens,98304);
  await f.service.saveProvider({...draft,modelSettings:{'unknown-model':{maxTokens:''}}});
  assert.equal((await f.service.getModelInfo({providerId:draft.id,modelId:'unknown-model'})).limits.maxOutputTokens,32768,'blank removes a saved override and restores the stated default');
  assert.equal(f.state.value.providers[draft.id].models[0].contextWindow,1048576);
});
test('unknown capacities retain stated runtime defaults and invalid override never mutates settings',async()=>{
  const f=fixture();await f.service.saveProvider(draft);
  assert.deepEqual((await f.service.getModelInfo({providerId:draft.id,modelId:'unknown-model'})).limits,{contextWindow:262144,maxOutputTokens:32768,source:'runtime-default',contextSource:'runtime-default'});
  const before=JSON.stringify(f.state);await assert.rejects(f.service.saveProvider({...draft,modelSettings:{'unknown-model':{maxTokens:0}}}));assert.equal(JSON.stringify(f.state),before);
  for(const value of [0,-1,1.5,'bad',Number.MAX_SAFE_INTEGER+1])assert.equal(validateProviderDraft({...draft,modelSettings:{'unknown-model':{maxTokens:value}}}).ok,false);
  const clean=validateProviderDraft({...draft,apiKey:'dummy-secret',modelSettings:{'unknown-model':{maxTokens:65536,apiKey:'dummy-secret'}}});
  assert.equal(clean.ok,true);assert.ok(!JSON.stringify(clean).includes('dummy-secret'));
});
