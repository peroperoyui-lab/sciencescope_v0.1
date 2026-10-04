import { randomUUID } from 'node:crypto';
import { validateProviderDraft } from '../../desktop/provider-draft.mjs';

const namespace = 'llm-pi-ai';
const protocols = {'openai-chat-completions':'openai-completions','openai-responses':'openai-responses','anthropic-messages':'anthropic-messages'};
const prefix = 'sciencescope-';
const keyRef = id => id.toUpperCase().replaceAll('-','_')+'_API_KEY';

// Calls existing DSH Remote settings/credentials/llm services. No provider HTTP
// or parallel configuration store is implemented here.
export function createProviderService(call) {
  async function view() {
    const result = await call('settings','describe',{});
    const section = result.namespaces.find(item => item.ns === namespace);
    if (!section) throw new Error('DSH pi-ai settings are unavailable');
    return section;
  }
  async function listProviders() {
    const section = await view();
    const entries = Object.entries(section.value?.providers || {}).filter(([id])=>id.startsWith(prefix));
    const references = entries.map(([id,p])=>p.apiKeyEnv || keyRef(id));
    const credentials = references.length ? await call('credentials','describe',{refs:references}) : {};
    return entries.map(([id,p])=>({
      id, name:p.displayName || id, baseUrl:p.baseURL || '',
      protocol:Object.keys(protocols).find(key=>protocols[key]===p.api) || '',
      models:(p.models || []).map(m=>typeof m === 'string' ? m : m.id),
      modelSettings:Object.fromEntries((p.models || []).map(m=>{
        const value=typeof m==='string'?{id:m}:m;
        return [value.id,Object.fromEntries(['name','maxTokens','contextWindow'].filter(key=>value[key]!==undefined).map(key=>[key,value[key]]))];
      })),
      modelDefaults:{maxTokens:p.defaultMaxTokens??32768,contextWindow:p.defaultContextWindow??262144},
      configured:credentials[p.apiKeyEnv || keyRef(id)]?.configured === true,
      saved:true,
    }));
  }
  async function saveProvider(input) {
    const validated = validateProviderDraft(input);
    if (!validated.ok) throw new Error('Provider configuration is invalid');
    const data = validated.value;
    const id = input.id || prefix+randomUUID();
    if (!/^sciencescope-[a-zA-Z0-9-]+$/.test(id)) throw new Error('Provider identity is invalid');
    const section = await view();
    const previous = section.value?.providers?.[id] || {};
    const credentialRef = previous.apiKeyEnv || keyRef(id);
    const next = {
      ...previous,
      displayName:data.name, baseURL:data.baseUrl, api:protocols[data.protocol],
      apiKeyEnv:credentialRef,
      models:data.models.map(id=>{
        const old=previous.models?.find(m=>(typeof m==='string'?m:m.id)===id);
        const profile={...(typeof old==='object'?old:{}),id};
        for(const [field,value] of Object.entries(data.modelSettings?.[id]??{})){if(value===null)delete profile[field];else profile[field]=value;}
        return profile;
      }),
    };
    await call('settings','mutate',{ns:namespace,ops:[{op:'set',path:['providers',id],value:next}],expectedRevision:section.revision});
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) await call('credentials','set',{ref:credentialRef,value:input.apiKey.trim()});
    return {id};
  }
  async function discoverModels(input) {
    const checked = validateProviderDraft({...input,models:['endpoint-interrogation']});
    if (!checked.ok) throw new Error('Discovery endpoint is invalid');
    return call('llm','discoverModels',{settingsNs:namespace,request:{
      baseURL:checked.value.baseUrl,api:protocols[checked.value.protocol],
      ...(input.apiKey ? {apiKey:input.apiKey} : {}),
      ...(input.id ? {provider:input.id} : {}),
    }});
  }
  async function removeProvider({id}) {
    if (!/^sciencescope-[a-zA-Z0-9-]+$/.test(id)) throw new Error('Provider identity is invalid');
    const section = await view();
    if (!section.value?.providers?.[id]) return;
    // Only remove the credential reference created by this UI, never an imported one.
    if (section.value.providers[id].apiKeyEnv === keyRef(id)) await call('credentials','unset',{ref:keyRef(id)});
    await call('settings','mutate',{ns:namespace,ops:[{op:'unset',path:['providers',id]}],expectedRevision:section.revision});
  }
  async function getModelInfo({providerId,modelId}) {
    const section=await view();
    const catalog=await call('session','modelCatalog',{});
    const info=catalog.groups?.find(group=>group.id===providerId)?.models.find(model=>model.id===modelId);
    if(!info)throw new Error('The selected model is not available in the DSH catalog');
    const provider=section.value?.providers?.[providerId];
    const profile=provider?.models?.find(model=>(typeof model==='string'?model:model.id)===modelId);
    const settings={...(typeof profile==='object'?profile:{}),...provider?.modelOverrides?.[modelId]};
    return {reasoning:info.reasoning || null,limits:{
      contextWindow:settings.contextWindow??provider?.defaultContextWindow??262144,
      maxOutputTokens:settings.maxTokens??provider?.defaultMaxTokens??32768,
      source:settings.maxTokens!==undefined||provider?.defaultMaxTokens!==undefined?'configured':'runtime-default',
      contextSource:settings.contextWindow!==undefined||provider?.defaultContextWindow!==undefined?'configured':'runtime-default',
    }};
  }
  return {listProviders,saveProvider,discoverModels,removeProvider,getModelInfo,getRuntimeConfig:async()=> (await view()).value};
}
