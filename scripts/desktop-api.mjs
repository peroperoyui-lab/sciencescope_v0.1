import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { defaultRoot } from './prepare-desktop.mjs';
import { createChatStore, ProfileStore } from './chat-store.mjs';
import { createWorkbenchApi, WorkbenchApiError, openLocalDocument } from './workbench-api.mjs';
import {createDesktopPreferences} from './desktop-preferences.mjs';
import {createSecretaryPreferences} from './secretary-preferences.mjs';
import {createShortcutSettings} from './shortcut-settings.mjs';
import {createAssistantWindowPreferences} from './assistant-window-preferences.mjs';
import {createResearchInput} from './research-input.mjs';
import {createResearchInputStore} from './research-input-store.mjs';
import {createRoleSettings,RoleSettingsError} from './role-settings.mjs';
import {createSkillManager,SkillManagerError} from '../adapters/runtime-dsh/skill-manager.mjs';
import { createVersionOrganizer } from './version-organizer.mjs';
import { createLibraryService } from './library-service.mjs';
import {randomUUID} from 'node:crypto';
import {createExecutionService} from './execution-service.mjs';
import { readFile as readFileBytes } from 'node:fs/promises';
import {createAssistantConversations,AssistantConversationError} from './assistant-conversations.mjs';
import {createAssistantChatService,AssistantChatError} from './assistant-chat-service.mjs';
import {createToolActivityProjection} from './tool-activity.mjs';
import {createChatOutbox} from './chat-outbox.mjs';
import {createChatSearch} from './chat-search.mjs';
import {createChatAttachments} from './chat-attachments.mjs';

function publicRuntimeMessage(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (/401|403|invalid credential|api key|unauthorized|authentication/.test(raw)) return '模型服务认证失败；请检查已保存的服务凭据。';
  if (/429|quota|rate limit|too many requests/.test(raw)) return '模型服务暂时限流或额度不足；请稍后重试或检查服务额度。';
  if (/timed out|timeout|econnrefused|enotfound|fetch failed|network/.test(raw)) return '无法连接模型服务；请检查服务地址和网络连接。';
  if (/model not found|no configured model|unknown model|model_not_found|does not exist|\b404\b/.test(raw)) return '模型服务找不到所选模型；请在模型设置中确认模型 ID 仍然可用。';
  if (/context.?length|maximum context|too many tokens|context_length_exceeded|prompt is too long/.test(raw)) return '请求超过模型上下文上限；请减少附件材料或新建对话。';
  if (/reasoning.?effort/.test(raw)) return '模型不支持所选推理强度；请改用该模型公开支持的 reasoningEffort。';
  return '运行时请求失败；请检查模型配置和网络连接。';
}

export async function createDesktopApi({onError, dataRoot = defaultRoot, runtimeHost = null, runtimeWeb = null} = {}) {
  let host = runtimeHost;
  let web = runtimeWeb;
  const bindings = new Map();
  const pending = new Set();
  // Normal Main runs only.  This is deliberately separate from execution's
  // auto-goal state and the temporary-chat bindings.
  const mainRuns = new Map();
  const activityTerminal = new Map();
  const activityLimit = 200;
  const touchActivity = (chatId, patch) => {
    const previous = activityTerminal.get(chatId) || {state:'completed'};
    const next = {...previous, ...patch, updatedAt:new Date().toISOString()};
    activityTerminal.delete(chatId); activityTerminal.set(chatId,next);
    while (activityTerminal.size > activityLimit) activityTerminal.delete(activityTerminal.keys().next().value);
    return next;
  };
  const activityFor = (chatId) => {
    const run = mainRuns.get(chatId);
    const live = run ? {state:run.state || 'running', ...(run.toolName ? {toolName:run.toolName} : {}), updatedAt:run.updatedAt || new Date().toISOString()} : null;
    const executionSnapshot = execution?.snapshot?.(chatId) || {approvalCount:0,goalActive:false};
    return {live, executionSnapshot};
  };
  function chatActivities() {
    const chats = chatStore.listChats().filter(chat=>!chat.deletedAt && !conversations.isAssistant(chat.id));
    const ids = chats.map(chat=>chat.id); const counts = outbox.activityCounts(ids); const result=[];
    for (const chat of chats) {
      const {live,executionSnapshot}=activityFor(chat.id); const queue=counts.get(chat.id)||{queuedCount:0,sendingCount:0};
      const terminal=activityTerminal.get(chat.id); let state; let toolName;
      if (executionSnapshot.approvalCount>0) state='waiting-approval';
      else if (live?.state) { state=live.state; toolName=live.toolName; }
      else if (executionSnapshot.goalActive || queue.sendingCount>0) state='running';
      else if (queue.queuedCount>0) state=queue.paused ? 'paused' : 'queued';
      else if(executionSnapshot.goalPhase==='paused')state='paused';
      else if(executionSnapshot.goalPhase==='blocked')state='waiting-approval';
      else if(executionSnapshot.goalPhase==='complete')state='completed';
      else if (terminal?.state) state=terminal.state;
      if(!state)continue;
      const updatedAt=live?.updatedAt || terminal?.updatedAt || chat.updated || new Date().toISOString();
      result.push({chatId:chat.id,state,queuedCount:queue.queuedCount,...(toolName?{toolName}:{}),updatedAt});
    }
    return {activities:result};
  }
  async function trimIdleSessions() {
    const idle=[...bindings].filter(([id,binding])=>!id.startsWith('temporary:')&&!pending.has(id)&&!binding.goalActive).sort((a,b)=>(a[1].lastUsed||0)-(b[1].lastUsed||0));
    for(const [id,binding] of idle.slice(0,Math.max(0,idle.length-3))) {
      await host.releaseSession(binding.sessionId);bindings.delete(id);
    }
  }
  const home = path.join(dataRoot,'.sciencescope-local','dsh');
  const skills=await createSkillManager({home});
  const projects = path.join(dataRoot,'.sciencescope-local','projects');
  await mkdir(projects,{recursive:true});
  const chatStore = await createChatStore({stateDir:path.join(dataRoot,'.sciencescope-local','state')});
  const workbench = await createWorkbenchApi({
    stateDir:path.join(dataRoot,'.sciencescope-local','state'),
    projectsDir:projects,
    getWorkspace:()=>chatStore.getWorkspace(),
  });
  const profileStore = await new ProfileStore({stateDir:path.join(dataRoot,'.sciencescope-local','state')}).init();
  const database=chatStore.db;
  const preferences=createDesktopPreferences({db:database.db,dataRoot});
  const secretaryPreferences=createSecretaryPreferences({db:database.db});
  const shortcuts=createShortcutSettings({db:database.db});
  const assistantWindowPreferences=createAssistantWindowPreferences({db:database.db});
  const roleSettings=createRoleSettings({db:database.db});
  const settingsPaths={root:{label:'客户端目录',path:path.resolve(dataRoot)},state:{label:'应用数据库与设置',path:path.join(dataRoot,'.sciencescope-local','state')},projects:{label:'默认项目目录',path:projects},library:{label:'资料库原件',path:path.join(dataRoot,'.sciencescope-local','library')},runtime:{label:'DSH 运行历史与配置',path:home},skills:{label:'本地技能目录',path:path.join(home,'skills')}};
  const conversations=createAssistantConversations({chatStore});
  const toolActivity=createToolActivityProjection({chatStore});
  const outbox=createChatOutbox({chatStore});
  const chatSearch=createChatSearch({chatStore});
  const attachments=createChatAttachments({database,root:path.join(dataRoot,'.sciencescope-local','library'),resolveProjectPath:(projectId,relative)=>workbench.store.resolvePath(projectId,relative)});
  const researchInput=createResearchInput({attachments,chatStore,getResource:id=>database.getResource(id)});
  const researchDrafts=createResearchInputStore({db:database.db});
  const library=createLibraryService({database,root:path.join(dataRoot,'.sciencescope-local','library'),workbench,getWorkspace:()=>chatStore.getWorkspace()});
  let sessionHeaders = [];
  try { sessionHeaders = JSON.parse(await readFile(path.join(dataRoot,'.sciencescope-local/state/runtime-client.json'),'utf8')).sessionHeaders || []; } catch {}
  try {
    if (!host) {
    const {createDshHost} = await import('../adapters/runtime-dsh/host.mjs');
    host = await createDshHost({home,cwd:projects,sessionHeaders});
    const {createDshWebHost} = await import('../adapters/runtime-dsh/web-host.mjs');
    const {createProviderService} = await import('../adapters/runtime-dsh/provider-service.mjs');
    web = await createDshWebHost({home,cwd:projects});
    if (typeof web.call === 'function') Object.assign(host,createProviderService(web.call));
    }
  } catch { /* Missing/unavailable runtime is shown as unavailable, never faked. */ }
  const capabilities = {
    available:!!host && typeof host.listProviders==='function',
    saveProvider:typeof host?.saveProvider === 'function',
    discoverModels:typeof host?.discoverModels === 'function',
    tokenStreaming:host?.capabilities?.tokenStreaming === true,
    reasoningEffort:host?.capabilities?.reasoningEffort === true,
  };
  const organizer=host?createVersionOrganizer({host,store:workbench.store,getPreferences:()=>secretaryPreferences.get(),getProject:async id=>{
    const {meta}=await workbench.project(id);return {name:meta.name,goal:meta.desc||''};
  }}):null;
  const execution=host?createExecutionService({host,database,chatStore,bindings}):null;
  const assistants=createAssistantChatService({host,conversations,chatStore,dataRoot,roleSettings});
  async function restoreExecution(chatId){
    if(bindings.has(chatId))return bindings.get(chatId);
    const chat=chatStore.getChat(chatId);if(!chat?.model||!chatStore.getBinding(chatId))throw new Error('CHAT_NOT_FOUND');
    const sessionId=await host.startSession({model:chat.model,workspace:chatStore.getRuntimeWorkspace(chatId),runtimeConfig:await host.getRuntimeConfig?.(),sessionId:chatStore.getBinding(chatId),persona:roleSettings.bind(chatId,'main',{existing:true}).prompt});
    const binding={sessionId,modelKey:JSON.stringify(chat.model),lastUsed:Date.now()};bindings.set(chatId,binding);
    const status=await execution.status(chatId);await execution.configure(chatId,binding,status.mode);return binding;
  }
  const json = (response,status,body) => { response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); };
  const binary = (response,status,body,type) => { response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); response.end(body); };
  async function handle(request,response) {
    const requestUrl = new URL(request.url,'http://127.0.0.1');
    const route = requestUrl.pathname;
    if (!route.startsWith('/api/')) return false;
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}`) { json(response,403,{message:'仅允许本地客户端访问。'}); return true; }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { json(response,403,{message:'请求来源不匹配。'}); return true; }
      if (route === '/api/status' && request.method === 'GET') { json(response,200,capabilities); return true; }
      try {
      const chatMatch = route.match(/^\/api\/chats\/([^/]+)(?:\/messages)?$/u);
      if(route==='/api/chat/search'&&request.method==='GET'){json(response,200,chatSearch.search(requestUrl.searchParams.get('q')));return true;}
      if(route==='/api/chat/outbox'&&request.method==='GET') {
        const id=requestUrl.searchParams.get('chatId');
        if(conversations.isAssistant(id)){json(response,403,{message:'请使用主聊天队列。'});return true;}
        json(response,200,outbox.list(id));return true;
      }
      if(route==='/api/chat/activity'&&request.method==='GET') { json(response,200,chatActivities()); return true; }
      if(route==='/api/assistant'&&request.method==='GET'){
        const scope=requestUrl.searchParams.get('scope'),ownerId=requestUrl.searchParams.get('ownerId');
        json(response,200,{...await assistants.snapshot(scope,ownerId,{before:requestUrl.searchParams.get('before')??undefined,after:requestUrl.searchParams.get('after')??undefined,limit:requestUrl.searchParams.get('limit')||60}),attachments:attachments.listDraft(scope,ownerId)});return true;
      }
      if(route==='/api/execution'&&request.method==='GET'){json(response,200,execution?await execution.status(requestUrl.searchParams.get('chatId')):{mode:'ask',goal:null,approvals:[],unavailable:true});return true;}
      if (route === '/api/chats' && request.method === 'GET') {
        json(response,200,{chats:chatStore.listChats(requestUrl.searchParams.has('projectId') ? requestUrl.searchParams.get('projectId') : undefined).filter(chat=>!conversations.isAssistant(chat.id))}); return true;
      }
      if (chatMatch && request.method === 'GET' && route.endsWith('/messages')) {
        if(conversations.isAssistant(decodeURIComponent(chatMatch[1]))){json(response,404,{message:'请通过独立助手入口读取此会话。'});return true;}
        const page = requestUrl.searchParams.has('around')
          ? await chatSearch.locate(decodeURIComponent(chatMatch[1]),requestUrl.searchParams.get('around'))
          : await chatStore.pageMessages(decodeURIComponent(chatMatch[1]), {before:requestUrl.searchParams.get('before') ?? undefined, after:requestUrl.searchParams.get('after') ?? undefined, limit:requestUrl.searchParams.get('limit') ?? 60});
        if (!page) { json(response,404,{message:'对话不存在。'}); return true; }
        const activity=toolActivity.list({chatId:decodeURIComponent(chatMatch[1]),assistantMessageIds:page.messages.filter(m=>m.role==='assistant').map(m=>m.id),limit:200});
        for(const message of page.messages)if(message.role==='assistant')message.toolActivity=activity.filter(call=>call.assistantMessageId===message.id);
        for(const message of page.messages)if(message.role==='user')message.researchInput=researchDrafts.receipt(decodeURIComponent(chatMatch[1]),message.id);
        json(response,200,page); return true;
      }
      if (route === '/api/workspace' && request.method === 'GET') { json(response,200,await chatStore.getWorkspace()); return true; }
      if(route==='/api/model-info'&&request.method==='GET'){
        if(!host?.getModelInfo){json(response,503,{message:'模型能力查询暂不可用。'});return true;}
        json(response,200,await host.getModelInfo({providerId:requestUrl.searchParams.get('providerId'),modelId:requestUrl.searchParams.get('modelId')}));return true;
      }
      if(route==='/api/library'&&request.method==='GET'){json(response,200,{resources:await library.list({projectId:requestUrl.searchParams.get('projectId')||undefined,query:requestUrl.searchParams.get('query')||''})});return true;}
      if(route==='/api/knowledge'&&request.method==='GET'){const projectId=requestUrl.searchParams.get('projectId')||undefined;if(projectId)await workbench.project(projectId);json(response,200,{knowledge:database.listKnowledge({projectId,namespace:requestUrl.searchParams.get('namespace')||undefined,query:requestUrl.searchParams.get('query')||''})});return true;}
      if (route === '/api/workbench' && request.method === 'GET') { json(response,200,await workbench.call(requestUrl.searchParams.get('projectId'),'get')); return true; }
      if (route === '/api/workbench/files' && request.method === 'GET') { json(response,200,{entries:await workbench.call(requestUrl.searchParams.get('projectId'),'listFiles',requestUrl.searchParams.get('path') || '')}); return true; }
      if (route === '/api/workbench/asset' && request.method === 'GET') {
        const projectId=requestUrl.searchParams.get('projectId');
        await workbench.project(projectId);
        let filename;
        try { filename=await workbench.store.resolvePath(projectId,requestUrl.searchParams.get('path') || ''); } catch { throw new WorkbenchApiError('INVALID_PATH','文件路径无效。'); }
        const ext=path.extname(filename).toLowerCase();
        const types={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif'};
        if (!types[ext]) { json(response,415,{message:'仅支持图片预览。'}); return true; }
        let bytes; try { bytes=await readFileBytes(filename); } catch { throw new WorkbenchApiError('NOT_FOUND','图片不存在。',404); }
        binary(response,200,bytes,types[ext]); return true;
      }
      if (route === '/api/workbench/plans' && request.method === 'GET') { json(response,200,await workbench.store.getPlans()); return true; }
      if (route === '/api/profile' && request.method === 'GET') { json(response,200,profileStore.getProfile()); return true; }
      if(route==='/api/preferences'&&request.method==='GET'){json(response,200,preferences.get());return true;}
      if(route==='/api/secretary/preferences'&&request.method==='GET'){json(response,200,secretaryPreferences.get());return true;}
      if(route==='/api/shortcuts'&&request.method==='GET'){json(response,200,shortcuts.get());return true;}
      if(route==='/api/assistant-window/preferences'&&request.method==='GET'){json(response,200,assistantWindowPreferences.get());return true;}
      if(route==='/api/research-input/draft'&&request.method==='GET'){const value=researchDrafts.get(requestUrl.searchParams.get('scope'),requestUrl.searchParams.get('ownerId'));value.labels={};for(const id of value.attachmentIds){const resource=await database.getResource(id);if(resource)value.labels[id]=resource.title;}json(response,200,value);return true;}
      if(route==='/api/skills'&&request.method==='GET'){json(response,200,await skills.list());return true;}
      if(route==='/api/skills/read'&&request.method==='GET'){json(response,200,await skills.read({name:requestUrl.searchParams.get('name')}));return true;}
      if(route==='/api/plugins/inventory'&&request.method==='GET'){
        if(!web?.call){json(response,200,{available:false,entries:[],agentPresets:[]});return true;}
        try{json(response,200,{...await web.call('pluginInventory','list',{}),available:true});}catch{json(response,200,{available:false,entries:[],agentPresets:[]});}return true;
      }
      if(route==='/api/roles'&&request.method==='GET'){json(response,200,{roles:['main','secretary','global'].map(role=>roleSettings.get(role)),binding:requestUrl.searchParams.has('chatId')?roleSettings.getBinding(requestUrl.searchParams.get('chatId')):null});return true;}
      if(route==='/api/roles/history'&&request.method==='GET'){const role=requestUrl.searchParams.get('role');roleSettings.get(role);const owner=requestUrl.searchParams.get('chatId');const chatId=role==='main'?owner:conversations.get(role,role==='global'?'global':owner)?.id;json(response,200,{receipts:chatId?roleSettings.listReceipts(chatId):[]});return true;}
      if(route==='/api/settings/info'&&request.method==='GET'){json(response,200,{paths:settingsPaths,node:process.versions.node,platform:process.platform,arch:process.arch,runtimeAvailable:capabilities.available});return true;}
      if (route === '/api/providers' && request.method === 'GET') {
        if (!host) { json(response,503,{message:'DSH 宿主尚未就绪。'}); return true; }
        json(response,200,{providers:host.listProviders ? await host.listProviders() : []}); return true;
      }
      if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) { json(response,405,{message:'请求方式无效。'}); return true; }
      const chunks = []; let length = 0;
      const uploadRoute = ['/api/workbench/import','/api/workbench/asset','/api/library/import'].includes(route);
      for await (const chunk of request) { length += chunk.length; if(length > (uploadRoute ? 20*1024*1024 : 1024*1024)) throw new WorkbenchApiError('REQUEST_TOO_LARGE', uploadRoute ? '上传文件不能超过 20MiB。' : '请求内容过大。', 413); chunks.push(chunk); }
      let input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!input||typeof input!=='object'||Array.isArray(input)){json(response,400,{message:'请求格式无效。'});return true;}
      if(input.researchInput!==undefined&&(!input.researchInput||typeof input.researchInput!=='object'||Array.isArray(input.researchInput))){json(response,400,{code:'INVALID_RESEARCH_INPUT',message:'研究输入格式无效，未发送。'});return true;}
      if(route==='/api/skills/save'){json(response,200,await skills.save(input));return true;}
      if(route==='/api/skills/enabled'){json(response,200,await skills.setEnabled(input));return true;}
      if(route==='/api/skills/remove'){json(response,200,await skills.remove(input));return true;}
      if(route==='/api/roles/save'){
        if(input.config?.model&&host?.getModelInfo){const info=await host.getModelInfo(input.config.model);const effort=input.config.reasoningEffort;if(effort&&!(info.reasoning?.efforts||[]).some(item=>item.id===effort)){json(response,400,{message:'此模型未声明所选思考强度，配置未保存。'});return true;}}
        json(response,200,roleSettings.save(input.role,input.config));return true;
      }
      if(route==='/api/roles/apply'){
        if(input.role!=='main'){roleSettings.get(input.role);json(response,200,await assistants.applyPersona(input.role,input.role==='global'?'global':input.chatId));return true;}
        const chat=chatStore.getChat(input.chatId);if(!chat||chat.deletedAt||conversations.isAssistant(chat.id)){json(response,404,{message:'请先选择主对话。'});return true;}
        if(pending.has(chat.id)||execution?.busy(chat.id)){json(response,409,{message:'请等待当前运行结束后再应用提示词。'});return true;}
        const config=roleSettings.get('main');pending.add(chat.id);
        try{const binding=bindings.get(chat.id);if(binding)await host.configurePersona({sessionId:binding.sessionId,persona:config.prompt});json(response,200,roleSettings.applyPrompt(chat.id,'main',config));}
        finally{pending.delete(chat.id);}return true;
      }
      if(route==='/api/preferences/reset'){json(response,200,preferences.reset());return true;}
      if(route==='/api/research-input/draft'){json(response,200,researchDrafts.save(input.scope,input.ownerId,input.snapshot));return true;}
      if(route==='/api/shortcuts/reset'){json(response,200,shortcuts.reset());return true;}
      if(route==='/api/assistant-window/preferences'){try{json(response,200,assistantWindowPreferences.save(input));}catch(error){if(error.code==='INVALID_ASSISTANT_WINDOW_PREFERENCES')json(response,400,{code:error.code,message:'启动设置无效，未保存。'});else throw error;}return true;}
      if(route==='/api/shortcuts'){try{json(response,200,shortcuts.save(input));}catch(error){if(error.code==='INVALID_SHORTCUTS')json(response,400,{code:error.code,message:'快捷键重复或不可用；请使用 Ctrl 加字母，可附加 Alt、Shift，避开系统与编辑快捷键。'});else throw error;}return true;}
      if(route==='/api/secretary/preferences'){try{json(response,200,secretaryPreferences.save(input));}catch(error){if(error.code==='INVALID_SECRETARY_PREFERENCES')json(response,400,{code:error.code,message:'版本说明模板须为 1–16000 字符。'});else throw error;}return true;}
      if(route==='/api/preferences'){try{json(response,200,preferences.save(input));}catch(error){if(error.code==='INVALID_PREFERENCES')json(response,400,{code:error.code,message:'设置值无效，未保存。'});else throw error;}return true;}
      if(route==='/api/settings/open-folder'){if(typeof input.id!=='string'||!Object.hasOwn(settingsPaths,input.id)){json(response,400,{message:'目录标识无效。'});return true;}const folder=settingsPaths[input.id].path;await mkdir(folder,{recursive:true});json(response,200,await openLocalDocument(folder));return true;}
      if(route==='/api/assistant/draft'){await conversations.saveDraft(input.scope,input.ownerId,input.text);if(input.attachmentIds!==undefined)attachments.saveDraft(input.scope,input.ownerId,input.attachmentIds);json(response,200,{saved:true});return true;}
      if(route==='/api/assistant/model'){json(response,200,await assistants.changeModel(input.scope,input.ownerId,input.model,input.reasoningEffort));return true;}
      if(route==='/api/assistant/proposal/resolve'){json(response,200,assistants.resolveProposal(input.scope,input.ownerId,input.id));return true;}
      if(route==='/api/assistant/approval'){json(response,200,await assistants.approve(input.scope,input.ownerId,input.requestId,input.allowed===true));return true;}
      if(route==='/api/assistant/stop'){json(response,200,await assistants.stop(input.scope,input.ownerId));return true;}
      if(route==='/api/chat/stop'){
        if(typeof input.chatId !== 'string' || !input.chatId.trim()) { json(response,400,{message:'对话标识无效。'}); return true; }
        const key=input.temporary === true ? `temporary:${input.chatId}` : input.chatId;
        const run=mainRuns.get(key);
        if(!input.temporary)await outbox.pause(input.chatId);
        if(!run) { json(response,200,{stopped:false,chatId:input.chatId}); return true; }
        run.cancelled=true;
        if(run.sending) {
          try {
            if(typeof host?.interrupt!=='function')throw new Error('INTERRUPT_UNAVAILABLE');
            await host.interrupt(run.sessionId);
          }catch(error){run.cancelled=false;throw error;}
        }
        json(response,200,{stopped:true,chatId:input.chatId,temporary:input.temporary === true}); return true;
      }
      if(route==='/api/assistant/chat'){
        const compiled=await researchInput.compile({...input,...input.researchInput,text:input.text,attachmentIds:[...new Set([...(input.attachmentIds||[]),...(input.researchInput?.attachmentIds||[])])]});
        input.researchContext=compiled.text;
        await assistants.send(input,{
          accept:()=>{response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});},
          emit:event=>{if(event.type==='accepted')researchDrafts.accepted(input.scope,input.ownerId,event.chatId,event.userMessageId,compiled.snapshot);if(!response.destroyed)response.write(JSON.stringify(event)+'\n');}
        });attachments.clearCaptured(input.scope,input.ownerId,input.attachmentIds);response.end();return true;
      }
      if(typeof input.chatId==='string'&&conversations.isAssistant(input.chatId)){
        json(response,403,{message:'助手私聊不可通过主专家操作接口调用。'});return true;
      }
      if(route==='/api/chat/outbox') {
        try {
          const chat=chatStore.getChat(input.chatId);
          if(!chat||chat.deletedAt){json(response,404,{message:'请等待对话建立后再加入队列。'});return true;}
          if(input.action==='enqueue') {
            if((input.input?.projectId??null)!==chat.projectId){json(response,409,{message:'对话所属项目已改变，请重新编辑消息。'});return true;}
            await outbox.enqueue({chatId:input.chatId,input:input.input});
          }else if(input.action==='pause')await outbox.pause(input.chatId);
          else if(input.action==='resume')await outbox.resume(input.chatId);
          else if(input.action==='cancel') {
            if(!await outbox.cancel({chatId:input.chatId,id:input.id})){json(response,409,{message:'消息已在发送，请使用停止按钮。'});return true;}
          }else {json(response,400,{message:'队列操作无效。'});return true;}
          json(response,200,outbox.list(input.chatId));
        }catch{json(response,400,{message:'无法保存队列；请检查文本、模型与策略，队列最多 20 条。'});}
        return true;
      }
      if(route==='/api/execution/goal'){if(!execution)throw new Error('RUNTIME_UNAVAILABLE');const binding=await restoreExecution(input.chatId);json(response,200,await execution.action(input.chatId,binding,input.action));return true;}
      if(route==='/api/execution/approval'){if(!execution)throw new Error('RUNTIME_UNAVAILABLE');await execution.approve(input.chatId,input.requestId,input.allowed===true);json(response,200,{answered:true});return true;}
      if(route==='/api/library/import'){json(response,200,await library.importFile(input));return true;}
      if(route==='/api/library/open'){json(response,200,await library.open(input.id));return true;}
      if(route==='/api/knowledge/propose'){if(input.projectId)await workbench.project(input.projectId);json(response,200,database.proposeKnowledge({...input,id:randomUUID(),projectId:input.projectId||null}));return true;}
      if(route==='/api/knowledge/accept'){json(response,200,database.acceptKnowledge(input.id));return true;}
      if (route === '/api/profile') {
        try { json(response,200,await profileStore.updateProfile(input)); }
        catch (error) { if (error instanceof TypeError && error.message === 'Invalid profile') json(response,400,{message:'个人资料格式无效。'}); else throw error; }
        return true;
      }
      if(route==='/api/chats/temporary-close') {
        const key='temporary:'+input.chatId,binding=bindings.get(key);
        if(binding) {await host?.releaseSession(binding.sessionId);bindings.delete(key);}
        json(response,200,{closed:true});return true;
      }
      if (route === '/api/chats/mode') {
        const modeLabels = { work: '工作模式', free: '自由讨论', ordered: '有序讨论' };
        if (typeof input.chatId !== 'string' || !Object.hasOwn(modeLabels, input.mode) || typeof input.messageId !== 'string') {
          json(response,400,{message:'对话工作方式参数无效。'}); return true;
        }
        if (!chatStore.getChat(input.chatId)) { json(response,404,{message:'对话不存在。'}); return true; }
        if (pending.has(input.chatId) || execution?.busy(input.chatId)) {
          json(response,409,{message:'这个对话仍在运行，请等待当前请求结束后再切换工作方式。'}); return true;
        }
        const suffix = input.mode === 'work' ? '。' : '（当前仍由主专家执行，尚未接入多专家调度）。';
        const message = await chatStore.appendMessage({
          chatId: input.chatId,
          id: input.messageId,
          role: 'system',
          text: `工作方式已切换为${modeLabels[input.mode]}${suffix}`,
        });
        json(response,200,{mode:input.mode,message}); return true;
      }
      if (route === '/api/workspace') {
        if (request.method !== 'POST') { json(response,405,{message:'请求方式无效。'}); return true; }
        json(response,200,await chatStore.updateWorkspace(input)); return true;
      }
      if (route === '/api/workbench/save') { json(response,200,await workbench.call(input.projectId,'save',{revision:input.revision,map:input.map,logs:input.logs,autoOrganize:input.autoOrganize})); return true; }
      if (route === '/api/workbench/bind') { json(response,200,await workbench.call(input.projectId,'bind',input.folder)); return true; }
      if (route === '/api/workbench/import') {
        if (typeof input.base64 !== 'string' || Buffer.byteLength(input.base64,'base64') > workbench.MAX_UPLOAD) throw new WorkbenchApiError('REQUEST_TOO_LARGE','上传文件不能超过 20MiB。',413);
        json(response,200,await workbench.call(input.projectId,'importFile',{name:input.name,base64:input.base64,group:input.group})); return true;
      }
      if (route === '/api/workbench/asset') {
        if (typeof input.base64 !== 'string' || Buffer.byteLength(input.base64,'base64') > workbench.MAX_UPLOAD) throw new WorkbenchApiError('REQUEST_TOO_LARGE','上传文件不能超过 20MiB。',413);
        json(response,200,await workbench.call(input.projectId,'addAsset',{name:input.name,base64:input.base64})); return true;
      }
      if (route === '/api/workbench/version') { json(response,200,await workbench.call(input.projectId,'updateVersion',input.id,input.patch || {})); return true; }
      if (route === '/api/workbench/plans') { json(response,200,await workbench.store.savePlans(input.plans)); return true; }
      if (route === '/api/workbench/open') { json(response,200,await workbench.open(input.projectId,input.path)); return true; }
      if (route === '/api/workbench/organize') {
        await workbench.project(input.projectId);
        if(!organizer||!input.model?.providerId||!input.model?.modelId){json(response,409,{message:'请选择一个已配置模型后整理；原件已保存。'});return true;}
        json(response,200,await organizer.organize({projectId:input.projectId,versionId:input.versionId,model:input.model}));return true;
      }
      if (chatMatch && request.method === 'POST' && !route.endsWith('/messages') && !['/api/chats/update','/api/chats/move','/api/chats/delete'].includes(route)) {
        json(response,400,{message:'请使用明确的对话操作接口。'}); return true;
      }
      // Stable action endpoints are convenient for clients that do not put an
      // operation name in the body. They share the same strict store methods.
      if (request.method === 'POST' && ['/api/chats/update','/api/chats/move','/api/chats/delete'].includes(route)) {
        const chatId = input.chatId;
        if (pending.has(chatId)||execution?.busy(chatId)||assistants.busyOwner(chatId)) { json(response,409,{message:'这个任务或秘书仍在运行，请先停止。'}); return true; }
        let result;
        if (route.endsWith('/update')) result = await chatStore.updateMetadata(chatId,input);
        else if (route.endsWith('/move')) {
          const target = input.projectId ?? null;
          if (target !== null && !(await chatStore.getWorkspace()).projects.some(project => project.id === target && !project.archived)) { json(response,404,{message:'目标项目不存在或已归档。'}); return true; }
          const binding = chatStore.getBinding(chatId);
          if (binding) {
            if (typeof host?.releaseSession !== 'function') { json(response,409,{message:'当前运行时不支持安全迁移；对话工作目录未改变。'}); return true; }
            await host.releaseSession(binding);
            bindings.delete(chatId);
          }
          result = await chatStore.move(chatId,target,{allowBound:true});
        }
        else {
          result = await chatStore.remove(chatId);
          // A removed chat is idle (checked above); do not keep its DSH child alive.
          const live = bindings.get(chatId);
          if (live) { bindings.delete(chatId); await host?.releaseSession(live.sessionId).catch(()=>{}); }
        }
        json(response,200,result); return true;
      }
      if (!host) { json(response,503,{message:'DSH 宿主尚未就绪。'}); return true; }
      if (route === '/api/providers/save' && capabilities.saveProvider) {
        await host.saveProvider(input); json(response,200,{saved:true}); return true;
      }
      if (route === '/api/providers/discover' && capabilities.discoverModels) {
        json(response,200,{models:await host.discoverModels(input)}); return true;
      }
      if (route === '/api/providers/remove' && typeof host.removeProvider === 'function') {
        await host.removeProvider(input); json(response,200,{removed:true}); return true;
      }
      if (route !== '/api/chat') { json(response,501,{message:'当前 DSH 接口尚未开放此操作。'}); return true; }
      if(input.outboxId) {
        const saved=outbox.list(input.chatId).items.find(item=>item.id===input.outboxId);
        if(!saved||saved.status!=='queued'){json(response,409,{message:'队列消息不可发送，请先检查当前状态。'});return true;}
        input={...saved.input,chatId:input.chatId,outboxId:input.outboxId};
      }
      input.assistantMessageId ??= 'msg-'+randomUUID();
      input.userMessageId ??= 'msg-'+randomUUID();
      if (!input || typeof input.text !== 'string' || !input.text.trim() || (input.projectId !== null && typeof input.projectId !== 'string') || typeof input.chatId !== 'string' || !input.model?.providerId || !input.model?.modelId) { json(response,400,{message:'请选择模型并输入消息。'}); return true; }
      const workspaceState = await chatStore.getWorkspace();
      const currentProject = input.projectId === null ? null : workspaceState.projects.find(project => project.id === input.projectId && !project.archived);
      if ((input.projectId !== null && !currentProject) || (input.temporary && !currentProject)) {json(response,400,{message:'请先选择有效的项目。'});return true;}
      const workbenchSnapshot = currentProject ? await workbench.call(currentProject.id,'get') : null;
      const projectFolder = workbenchSnapshot?.folder;
      const key = input.temporary ? 'temporary:'+input.chatId : input.chatId;
      if (pending.has(key)||execution?.busy(key)) { json(response,409,{message:'这个对话仍在运行；自动化任务请先暂停后再发送。'}); return true; }
      const executionMode=input.executionMode||'ask';
      if(!['ask','full','auto'].includes(executionMode)){json(response,400,{message:'执行策略无效。'});return true;}
      if(input.temporary&&executionMode==='auto'){json(response,400,{message:'临时窗口不启动持久自动化目标。'});return true;}
      const reasoningEffort = input.reasoningEffort ?? input.model.reasoningEffort;
      if (reasoningEffort !== undefined && (typeof reasoningEffort !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/u.test(reasoningEffort))) {
        json(response,400,{message:'推理强度参数无效；请使用 DSH 支持的 reasoningEffort 标识。'}); return true;
      }
      // Reasoning effort is a runtime option, not model identity. Keep the
      // persisted/binding route stable as provider+model; DSH receives the
      // selected effort when the session is first created.
      const modelRoute = {providerId:input.model.providerId,modelId:input.model.modelId};
      const modelKey = JSON.stringify(modelRoute);
      const existingChat = input.temporary ? null : chatStore.getChat(input.chatId);
      if(existingChat?.deletedAt) {json(response,404,{message:'这条对话已移除。'});return true;}
      if(existingChat&&database.db.prepare('SELECT 1 FROM messages WHERE chat_id=? AND id=?').get(input.chatId,input.userMessageId)){json(response,409,{code:'DUPLICATE_MESSAGE',message:'这条消息已被接收，不会重复发送材料。'});return true;}
      if (existingChat?.model && JSON.stringify({providerId:existingChat.model.providerId,modelId:existingChat.model.modelId}) !== modelKey) { json(response,409,{message:'此对话已绑定模型；更换模型请新建聊天，避免隐式丢失历史。'}); return true; }
      if (existingChat && existingChat.projectId !== (input.projectId ?? null)) { json(response,409,{message:'此对话属于其他工作区；请先使用移动接口。'}); return true; }
      if (bindings.has(key) && bindings.get(key).modelKey !== modelKey) { json(response,409,{message:'此对话已绑定模型；更换模型请新建聊天，避免隐式丢失历史。'}); return true; }
      pending.add(key);
      const run = executionMode === 'auto' ? null : {cancelled:false,sessionId:null,currentText:'',persisted:false,accepted:false,state:'running',updatedAt:new Date().toISOString(),toolCalls:new Map()};
      let claimed=false,successful=false;
      if(run) mainRuns.set(key,run);
      try {
        const compiled=await researchInput.compile({...input.researchInput,text:input.text});
        if(input.outboxId) {
          claimed=!!await outbox.claim({chatId:input.chatId,id:input.outboxId});
          if(!claimed){json(response,409,{message:'队列已暂停或另一条消息仍在执行。'});return true;}
        }
        if (!bindings.has(key)) {
          const originalWorkspace = chatStore.getRuntimeWorkspace(input.chatId);
          const workspace = input.temporary ? path.join(dataRoot,'.sciencescope-local','temp','quick',input.chatId) : (originalWorkspace || projectFolder || path.join(projects,'independent'));
          await mkdir(workspace,{recursive:true});
          const persona=input.temporary?roleSettings.get('main').prompt:roleSettings.bind(input.chatId,'main',{existing:!!chatStore.getBinding(input.chatId)}).prompt;
          const session = await host.startSession({model:{...modelRoute,...(reasoningEffort === undefined ? {} : {reasoningEffort})},workspace,runtimeConfig:host.getRuntimeConfig ? await host.getRuntimeConfig() : undefined,sessionId:input.temporary ? undefined : chatStore.getBinding(input.chatId) ?? undefined,persona});
          bindings.set(key,{sessionId:typeof session === 'string' ? session : session.sessionId,modelKey,lastUsed:Date.now()});
          if(run) run.sessionId=bindings.get(key).sessionId;
          if (!input.temporary) {
            await chatStore.ensureChat({chatId:input.chatId,projectId:input.projectId ?? null,title:input.title || input.text,model:input.model});
            await chatStore.markRuntimeBinding(input.chatId,bindings.get(key).sessionId,workspace);
          }
        }
        if(run)run.sessionId=bindings.get(key).sessionId;
        await execution.configure(key,bindings.get(key),executionMode);
        await host.configureReasoning({sessionId:bindings.get(key).sessionId,reasoningEffort});
        if(run?.cancelled) {
          response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
          response.write(JSON.stringify({type:'cancelled',chatId:input.chatId,text:''})+'\n');
          return true;
        }
        response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
        const emit = event => { if (!response.destroyed) response.write(JSON.stringify(event)+'\n'); };
        if (!input.temporary) await chatStore.appendMessage({chatId:input.chatId,id:input.userMessageId,role:'user',text:input.text});
        let finalEvent;let receipts=Promise.resolve();
        const persistPartial = async text => {
          if(!run || input.temporary || run.persisted || !run.accepted) return;
          run.persisted=true;
          await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:text || ''});
        };
        const onEvent = event => {
          if(run) {
            run.updatedAt=new Date().toISOString();
            if(event.type==='tool-call' && event.callId) { run.toolCalls.set(event.callId,String(event.name||'tool').slice(0,200)); run.toolName=run.toolCalls.get(event.callId); }
            else if(event.type==='tool-result' && event.callId && run.toolCalls.has(event.callId)) run.toolName=run.toolCalls.get(event.callId);
          }
          if(run) {
            if(event.type==='text-delta'||event.type==='delta') run.currentText += typeof event.delta==='string' ? event.delta : '';
            else if(event.type==='text-reset'||event.type==='reset'||event.type==='text-replace'||event.type==='replace') run.currentText = typeof event.text==='string' ? event.text : '';
          }
          if(!input.temporary&&(event.type==='tool-call'||event.type==='tool-result')){
            receipts=receipts.then(()=>toolActivity.record({chatId:input.chatId,assistantMessageId:input.assistantMessageId,...event}));
            // Attach an error observer immediately; persistence is awaited below.
            receipts.catch(()=>{});
          }
          if (event.type === 'completed') finalEvent = event; else emit(event);
        };
        if(!input.temporary)researchDrafts.accepted('main',input.chatId,input.chatId,input.userMessageId,compiled.snapshot);
        emit({type:'accepted',chatId:input.chatId,researchInput:compiled.snapshot});
        if(run) run.accepted=true;
        if(run?.cancelled) {
          await persistPartial('');
          response.write(JSON.stringify({type:'cancelled',chatId:input.chatId,text:''})+'\n');
          return true;
        }
        const contextPrefix = currentProject ? `[ScienceScope ${input.temporary?'temporary ':''}project context]\nProject: ${currentProject.name}\nResearch goal: ${currentProject.desc || ''}\nProject ID: ${currentProject.id}\nProject directory: ${projectFolder}\nSession working directory: ${input.temporary?path.join(dataRoot,'.sciencescope-local','temp','quick',input.chatId):chatStore.getRuntimeWorkspace(input.chatId)}\n${input.temporary?'This is a separate temporary question, not the Main conversation.':''}\n\n` : '';
        if(executionMode==='auto'){
          const goal=await execution.start(key,bindings.get(key),contextPrefix+compiled.text,input.goalMaxRounds);
          emit({type:'goal-started',goal});emit({type:'completed',text:'',background:true});response.end();return true;
        }
        try {
          if(run)run.sending=true;
          await host.send({sessionId:bindings.get(key).sessionId,text:contextPrefix + compiled.text,onEvent});
          await receipts;
        } catch (error) {
          await receipts;
          if(run?.cancelled) {
            await persistPartial(run.currentText);
            emit({type:'cancelled',chatId:input.chatId,text:run.currentText}); return true;
          }
          if(!input.temporary)researchDrafts.restore('main',input.chatId,compiled.snapshot);
          if (!input.temporary) await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:'请求失败，未生成完整回答。'});
          throw error;
        }
          if(run?.cancelled) {
          if(finalEvent && typeof finalEvent.text==='string' && !run.currentText) run.currentText=finalEvent.text;
          await persistPartial(run.currentText);
          emit({type:'cancelled',chatId:input.chatId,text:run.currentText}); return true;
        }
        if (!input.temporary && finalEvent && typeof finalEvent.text === 'string') { if(run) run.persisted=true; await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:finalEvent.text}); }
        successful=!!finalEvent;
        if(run) run.state='completed';
        if(run&&!input.temporary&&successful) touchActivity(input.chatId,{state:'completed',toolName:undefined});
        if(claimed&&successful){await outbox.finish({chatId:input.chatId,id:input.outboxId});claimed=false;}
        if (finalEvent) emit(finalEvent);
      } finally {
        try {
          if(!input.temporary)await toolActivity.settle({chatId:input.chatId,assistantMessageId:input.assistantMessageId});
          if(claimed)await (successful?outbox.finish({chatId:input.chatId,id:input.outboxId}):outbox.fail({chatId:input.chatId,id:input.outboxId}));
          else if(run&&!successful&&(run.accepted||run.cancelled)&&!input.temporary)await outbox.pause(input.chatId);
        }finally{
          if(bindings.has(key))bindings.get(key).lastUsed=Date.now();
          pending.delete(key);
          if(run) { if(!input.temporary){if(run.cancelled) touchActivity(input.chatId,{state:'stopped'}); else if(!successful && run.accepted) touchActivity(input.chatId,{state:'failed'});} mainRuns.delete(key); }
        }
        if(successful||run?.cancelled)response.end();
        await trimIdleSessions();
      }
    } catch (error) {
      onError?.(error);
      if(!response.headersSent&&(error.code==='INVALID_RESEARCH_INPUT'||['INVALID_RESEARCH_DRAFT','ATTACHMENT_UNAVAILABLE','INVALID_ATTACHMENTS','INVALID_ATTACHMENT_PATH'].includes(error.message))){json(response,400,{code:error.code||error.message,message:'研究材料或引用不可用，请检查来源；草稿和原件保留。'});return true;}
      if(!response.headersSent&&(error instanceof AssistantChatError||error instanceof AssistantConversationError)){json(response,Number.isInteger(error.status)?error.status:400,{code:error.code,message:error.message});return true;}
      if (error instanceof WorkbenchApiError||error instanceof RoleSettingsError||error instanceof SkillManagerError) { json(response,error.status,{code:error.code,message:error.message}); return true; }
      // Raw runtime errors can contain credentials or provider payloads.
      const message = publicRuntimeMessage(error);
      if (response.headersSent) response.end(JSON.stringify({type:'failed',message})+'\n');
      else json(response,500,{message});
    }
    return true;
  }
  return {handle,close:async()=>{await assistants.close();await Promise.allSettled([host?.close(),web?.close(),skills.close()]);await execution?.close();await chatStore.queue;await profileStore.queue;chatStore.close?.();profileStore.close?.();}};
}
