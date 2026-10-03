import path from 'node:path';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { defaultRoot } from './prepare-desktop.mjs';
import { createChatStore, ProfileStore } from './chat-store.mjs';
import { createWorkbenchApi, WorkbenchApiError, openLocalDocument, openExternalUrl, externalUrl } from './workbench-api.mjs';
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
import {randomUUID, timingSafeEqual} from 'node:crypto';
import {createExecutionService} from './execution-service.mjs';
import { readFile as readFileBytes } from 'node:fs/promises';
import { createDocumentPreview } from './document-preview.mjs';
import {createAssistantConversations,AssistantConversationError} from './assistant-conversations.mjs';
import {createAssistantChatService,AssistantChatError} from './assistant-chat-service.mjs';
import {createToolActivityProjection} from './tool-activity.mjs';
import {createChatBranching,ChatBranchError} from './chat-branching.mjs';
import {createChatOutbox} from './chat-outbox.mjs';
import {createChatSearch} from './chat-search.mjs';
import {createChatAttachments} from './chat-attachments.mjs';
import {createExpertRoster,ExpertRosterError} from './expert-roster.mjs';
import {createDiscussionService,DiscussionError} from './discussion-service.mjs';
import {createResearchBase,ResearchBaseError} from './research-base/index.mjs';
import {validateWorkFolder,WorkFolderError} from './workspace-folders.mjs';
import {listSystemFonts} from './system-fonts.mjs';
import {createDeliverables,DeliverableError} from './deliverables.mjs';
import {createChatMinutes,MinutesError} from './chat-minutes.mjs';
import {createHostEvents} from './host-events.mjs';
import {subscribeHostBackground} from './host-background.mjs';
import {createSummaryPolicy} from './summary-policy.mjs';
import {createSummaryWorkbench,SummaryWorkbenchError} from './summary-workbench.mjs';
import {buildContextTools,contextRules,CONTEXT_API_VERSION} from './context/tools.mjs';
import {createContextAccess} from './context/registry.mjs';
import {ContextAccessError} from './context/policy.mjs';
import {createScopedResearchTools} from './context/research-tools.mjs';
import {createSemanticService,messageVectorVersion} from './research-base/semantic-service.mjs';
import {recallForTurn} from './research-base/recall.mjs';
import {ensureMainChat} from './context/sources/_shared.mjs';
import {createPythonEnvironmentService,PythonEnvironmentError} from './python-env/environments.mjs';

function publicRuntimeMessage(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (/\b401\b|\b403\b|invalid credential|api key|unauthorized|authentication/.test(raw)) return '模型服务认证失败；请检查已保存的服务凭据。';
  if (/\b429\b|quota|rate limit|too many requests/.test(raw)) return '模型服务暂时限流或额度不足；请稍后重试或检查服务额度。';
  if (/timed out|timeout|econnrefused|enotfound|fetch failed|network/.test(raw)) return '无法连接模型服务；请检查服务地址和网络连接。';
  if (/model not found|no configured model|unknown model|model_not_found|model is unavailable|model.{0,20}not (?:available|supported)|does not exist|\b404\b/.test(raw)) return '模型服务找不到所选模型；请在模型设置中确认模型 ID 仍然可用。';
  if (/context.?length|maximum context|too many tokens|context_length_exceeded|prompt is too long/.test(raw)) return '请求超过模型上下文上限；请减少附件材料或新建对话。';
  if (/reasoning.?effort/.test(raw)) return '模型不支持所选推理强度；请改用该模型公开支持的 reasoningEffort。';
  return '运行时请求失败；请检查模型配置和网络连接。';
}

export async function createDesktopApi({onError, dataRoot = defaultRoot, runtimeHost = null, runtimeWeb = null, apiToken = null, openUrl = openExternalUrl, listFonts = listSystemFonts, pythonOptions = {}, pythonBootstrap = runtimeHost === null && dataRoot === defaultRoot} = {}) {
  const events = createHostEvents({onError,isBusy:chatId=>pending.has(chatId)||mainRuns.has(chatId)||discussions?.busy(chatId)||execution?.snapshot(chatId).goalActive});
  let host = runtimeHost;
  let web = runtimeWeb;
  const bindings = new Map();
  const startingContexts = new Map();
  const openedAssistants = new Set();
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
  const python=createPythonEnvironmentService({database,dataRoot,getChat:id=>chatStore.getChat(id),...pythonOptions});
  const sessionPython=new Map();
  const pythonKey=value=>JSON.stringify({envId:value.envId,kind:value.kind,pathPrepend:value.pathPrepend,env:value.env});
  async function needsPythonRefresh(sessionId,chatId,projectId){return sessionPython.get(sessionId)?.key!==pythonKey(await python.resolve({chatId,projectId}));}
  async function pythonContextBrief(chatId,projectId){
    const resolved=await python.resolve({chatId,projectId});
    if(resolved.kind==='managed')return `Current Python environment: ${resolved.name} (managed). Use python_env_install with package names and a reason to request additional packages. Do not install with pip or use shell commands to bypass approval.`;
    return 'Current Python environment: system Python. Package installation is unavailable in this unmanaged environment; ask the user to select a managed environment if packages are needed.';
  }
  const preferences=createDesktopPreferences({db:database.db,dataRoot});
  const deliverables=createDeliverables({db:database.db,openLocal:openLocalDocument});
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
  const researchInput=createResearchInput({attachments,chatStore,getResource:id=>database.getResource(id),getResearchItem:id=>research.store.getItem(id)});
  const researchDrafts=createResearchInputStore({db:database.db});
  const library=createLibraryService({database,root:path.join(dataRoot,'.sciencescope-local','library'),workbench,getWorkspace:()=>chatStore.getWorkspace()});
  const experts=createExpertRoster({db:database.db});
  // Research Base (docs/design/RESEARCH_BASE.md): literature, knowledge,
  // models, claims and long-term memory, retrievable by people and agents.
  const libraryRoot=path.join(dataRoot,'.sciencescope-local','library');
  const resolveResourcePath=async resource=>{
    if(resource.metadata?.storage==='project')return workbench.store.resolvePath(resource.projectId,resource.path);
    await mkdir(libraryRoot,{recursive:true});const base=await realpath(libraryRoot),file=await realpath(path.resolve(base,resource.path));
    if(!file.startsWith(base+path.sep))throw new Error('INVALID_RESOURCE_PATH');
    return file;
  };
  let semantic;
  let assistantRequests=0;
  const research=createResearchBase({database,resolveResourcePath,onProgress:()=>semantic?.rebuild()});
  await research.registerResources();
  semantic=createSemanticService({database,store:research.store,dataRoot,onError,
    isBusy:()=>pending.size>0||mainRuns.size>0||assistantRequests>0||[...bindings.values()].some(binding=>binding.goalActive)});
  research.retrieval.setVectorRetriever(semantic);
  const documentPreview=createDocumentPreview({database,resolveResourcePath,research});
  // Which assistant message a session is producing now (for usage receipts).
  const turnMessages=new Map();
  const expertTurnMessages=new Map();
  const expertTurnKey=(sessionId,expertId)=>JSON.stringify([sessionId,expertId]);
  function recordInputUsage(chatId,messageId,snapshot){
    const refs=(snapshot?.contextRefs||[]).flatMap(ref=>{if(ref.itemId)return [{type:'item',id:ref.itemId}];const source=research.store.sourceByResource(ref.resourceId);return source?[{type:'source',id:source.id}]:[];});
    if(refs.length)research.store.recordUsage({chatId,messageId,refs,how:'context'});
  }
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
    // Optional features: the desktop shows an entry point only when its feature
    // is true (desktop/features.mjs). Each task that implements one turns it on
    // here; docs/tasks/FEATURE_FLAGS.md lists owner tasks and interfaces.
    features:{
      pythonEnvs:typeof python?.list==='function', // T11 persisted environment API
      folderPicker:(process.env.SCIENCESCOPE_NATIVE_FEATURES||'').split(',').includes('pickFolder'), // T11 Tauri pick_folder
      inAppBrowser:false,      // T08
      branch:typeof host?.forkSession==='function'&&typeof host?.sessionTurns==='function', // T12 browser/native acceptance passed
      usage:false,             // T13 usage analytics
      materialsPanel:typeof research.store.listSources==='function', // T05 real research material selection
      mapHistory:false,        // T14 map history, version notes, diff
      changeLog:false,         // T14 per-chat change log
      pluginManagement:false,  // T15 DSH plugin install/update/enable
      dataRelocation:false,    // T16 change data folders and migrate
    },
  };
  const organizer=host?createVersionOrganizer({host,store:workbench.store,getPreferences:()=>secretaryPreferences.get({language:preferences.get().language}),getProject:async id=>{
    const {meta}=await workbench.project(id);return {name:meta.name,goal:meta.desc||''};
  }}):null;
  const execution=host?createExecutionService({host,database,chatStore,bindings,onTurnPersisted:payload=>{void events.emit('chat.turn.persisted',payload);},onPythonEnvironmentRefreshReady:payload=>schedulePythonEnvironmentRefresh(payload)}):null;
  // The secretary's running minutes of each conversation, and read-only
  // history tools for the Main expert and every expert (2026-09-26).
  const summaryPreferences=()=>secretaryPreferences.get({language:preferences.get().language});
  const secretaryModel=chatId=>roleSettings.get('secretary').model||chatStore.getChat(chatId)?.model||null;
  // Diagnostics deliberately exclude prompts, output, paths and provider errors.
  const summaryDiagnostic=({type,code,reason,chatId,revision}={})=>console.info('[summary]',JSON.stringify({type:type||code,reason,chatId,revision}));
  const summaryWorkbench=createSummaryWorkbench({db:database.db,host,chatStore,workbench:workbench.store,getPreferences:summaryPreferences,modelFor:secretaryModel,events,onError,onDiagnostic:summaryDiagnostic});
  const minutes=createChatMinutes({db:database.db,host,chatStore,onError,modelFor:secretaryModel,getPreferences:summaryPreferences,onUpdated:value=>summaryWorkbench.onMinutesUpdated(value),onDiagnostic:summaryDiagnostic});
  const summaryPolicy=createSummaryPolicy({db:database.db,events,minutes,chatStore,getPreferences:summaryPreferences,onError,onDiagnostic:summaryDiagnostic});
  subscribeHostBackground({events,organizer,workbench:{get:projectId=>workbench.call(projectId,'get')},modelFor:()=>roleSettings.get('secretary').model});
  semantic.setMessageProvider(()=>chatStore.listChats().filter(chat=>ensureMainChat(database.db,chat.id,{required:false})).flatMap(chat=>
    minutes.messagesAfter(chat.id,0).map(message=>({ref:{type:'message',id:JSON.stringify([chat.id,message.id])},version:messageVectorVersion(message.text),text:message.text,group:'chat:'+chat.id}))));
  events.on('chat.turn.persisted',()=>semantic.rebuild());
  events.on('discussion.finished',()=>semantic.rebuild());
  void semantic.start();
  const contextAccess=createContextAccess({db:database.db,chatStore,minutes,vectorRetriever:semantic,workbench:{
    get:async projectId=>{const project=(await chatStore.getWorkspace()).projects.find(project=>project.id===projectId);return {...await workbench.store.get(projectId,project?.name),projectName:project?.name,folder:await workbench.store.resolvePath(projectId,'')};},
    plans:()=>workbench.store.getPlans(),
  }});
  const researchToolCall=createScopedResearchTools({research,projectIds:async()=> (await chatStore.getWorkspace()).projects.map(project=>project.id)});
  async function startContextSession(options,ctx){
    const sessionId=options.sessionId||'session-'+randomUUID().replaceAll('-','');
    const resolved=await python.resolve({chatId:ctx.chatId,projectId:ctx.projectId,envId:options.pythonEnvId});
    startingContexts.set(sessionId,ctx);
    try{
      const {pythonEnvId,...runtimeOptions}=options;
      const result=await host.startSession({...runtimeOptions,sessionId,sessionEnv:{pathPrepend:resolved.pathPrepend||[],env:resolved.env||{}}});
      sessionPython.set(sessionId,{key:pythonKey(resolved),resolved});
      while(sessionPython.size>200)sessionPython.delete(sessionPython.keys().next().value);
      return result;
    }finally{startingContexts.delete(sessionId);}
  }
  const discussions=host?.runExperts?createDiscussionService({host,chatStore,db:database.db,toolActivity,minutes,memoryGuide:contextRules('expert')}):null;
  const branching=createChatBranching({chatStore,database,host,execution,bindings,roleSettings,startContextSession,conversations,researchDrafts,restoreExecution});
  const assistants=createAssistantChatService({host,conversations,chatStore,dataRoot,roleSettings,contextAccess,startContextSession,needsPythonRefresh,bindPython:input=>python.bind(input),pythonContextBrief});
  // Agent tools answered by the Research Base. The session decides the chat,
  // project and role; nothing in the model's arguments can widen that scope.
  function toolContext(sessionId,expertId){
    const starting=startingContexts.get(sessionId);
    if(starting)return {...starting,...(expertId?{role:'expert',expertId}:{})};
    const chatId=database.db.prepare('SELECT chat_id FROM runtime_bindings WHERE session_id=?').get(sessionId)?.chat_id
      ?? [...bindings].find(([key,binding])=>binding.sessionId===sessionId&&!key.startsWith('temporary:'))?.[0];
    if(!chatId)return {role:'temporary',projectId:null};
    const assistant=database.db.prepare('SELECT scope,owner_id FROM assistant_conversations WHERE chat_id=?').get(chatId);
    const projectChat=assistant?.scope==='secretary'?assistant.owner_id:assistant?null:chatId;
    return {chatId,mainChatId:projectChat||null,projectId:projectChat?chatStore.getChat(projectChat)?.projectId??null:null,role:expertId?'expert':assistant?assistant.scope:'main',...(expertId?{expertId}:{}),messageId:expertId?expertTurnMessages.get(expertTurnKey(sessionId,expertId))?.messageId:turnMessages.get(sessionId)};
  }
  host?.setToolHandler?.(async({sessionId,name,args,callId,expertId,signal})=>{
    const ctx={...toolContext(sessionId,expertId),callId};
    const tools=buildContextTools(ctx.role);
    if(name==='__manifest')return {contextApi:CONTEXT_API_VERSION,tools};
    if(!tools.some(tool=>tool.name===name))throw new ContextAccessError('TOOL_NOT_ALLOWED','This tool is not available in this session.');
    if(name==='python_env_install'){
      const resolved=sessionPython.get(sessionId)?.resolved;
      if(!resolved||resolved.kind!=='managed')throw new PythonEnvironmentError('MANAGED_ENVIRONMENT_REQUIRED','请先选择受管 Python 环境，不能安装到系统 Python。');
      const settings=await python.getSettings();
      const assistant=database.db.prepare('SELECT scope,owner_id FROM assistant_conversations WHERE chat_id=?').get(ctx.chatId);
      const mode=assistant?conversations.getSettings(assistant.scope,assistant.owner_id).executionMode:(await execution.status(ctx.chatId)).mode;
      // Validate before asking; the command is never assembled from raw model input.
      const packages=await python.validatePackages(args?.packages);
      if(typeof args?.reason!=='string'||!args.reason.trim())throw new PythonEnvironmentError('INVALID_REASON','请说明安装软件包的原因。');
      let allowed=mode==='full'&&settings.autoApproveFull===true;
      if(!allowed){
        if(typeof host.requestApplicationApproval!=='function')throw new PythonEnvironmentError('APPROVAL_UNAVAILABLE','当前运行时不支持软件包安装审批；没有执行安装。',503);
        allowed=await host.requestApplicationApproval({sessionId,toolName:name,reason:args.reason,packages,targetEnvironment:resolved.name||resolved.envId,expertId,signal});
      }
      if(!allowed)return {installed:false,envId:resolved.envId,requestedPackages:packages,reason:'用户拒绝或取消了安装。'};
      const result=await python.packages({envId:resolved.envId,action:'add',packages,actor:ctx.role,reason:args.reason});
      return {installed:true,envId:resolved.envId,requestedPackages:packages,environmentPackages:result.packages};
    }
    return name.startsWith('research_')?researchToolCall(name,args??{},ctx):contextAccess.call(name,args??{},ctx);
  });
  // The project brief (confirmed long-term memory) is a system-prompt section
  // of the Main session, refreshed before a turn when it changed.
  async function refreshBrief(binding,projectId,chatId,messageId){
    if(!host?.configureBrief)return;
    const brief=research.retrieval.brief({projectId:projectId??null});
    const pythonBrief=await pythonContextBrief(chatId,projectId);
    // The history lookup rules are a stable part of the Main expert's system prompt.
    const text=`${brief.text?`${brief.text}\n\n`:''}${contextRules('main')}\n\n${pythonBrief}`;
    if(binding.briefText!==text){await host.configureBrief({sessionId:binding.sessionId,text});binding.briefText=text;}
    if(brief.refs.length&&messageId)research.store.recordUsage({chatId,messageId,refs:brief.refs,how:'brief'});
  }
  async function restoreExecution(chatId,{refreshEnvironment=false}={}){
    const chat=chatStore.getChat(chatId);if(!chat?.model||!chatStore.getBinding(chatId))throw new Error('CHAT_NOT_FOUND');
    let binding=bindings.get(chatId);
    if(binding&&refreshEnvironment&&!execution.busy(chatId)&&await needsPythonRefresh(binding.sessionId,chatId,chat.projectId??null)){
      await host.waitForSessionIdle?.(binding.sessionId);
      await execution.waitForTurnWrites(chatId);
      if(!bindings.has(chatId)||bindings.get(chatId)!==binding)return restoreExecution(chatId,{refreshEnvironment});
    }
    if(binding&&refreshEnvironment&&!execution.busy(chatId)&&await needsPythonRefresh(binding.sessionId,chatId,chat.projectId??null)){
      await host.releaseSession(binding.sessionId);bindings.delete(chatId);binding=null;
    }
    if(!binding){
      const sessionId=await startContextSession({model:{...chat.model,...(chat.reasoningEffort?{reasoningEffort:chat.reasoningEffort}:{})},workspace:chatStore.getRuntimeWorkspace(chatId),runtimeConfig:await host.getRuntimeConfig?.(),sessionId:chatStore.getBinding(chatId),persona:roleSettings.bind(chatId,'main',{existing:true}).prompt},{role:'main',chatId,mainChatId:chatId,projectId:chat.projectId??null});
      binding={sessionId,modelKey:JSON.stringify(chat.model),lastUsed:Date.now()};bindings.set(chatId,binding);
    }
    await refreshBrief(binding,chat.projectId??null,chatId);
    const status=await execution.status(chatId);await execution.configure(chatId,binding,status.mode);return binding;
  }
  const pythonEnvironmentRefreshes=new Set();
  async function performPythonEnvironmentRefresh({chatId,sessionId,goal}){
    const key=JSON.stringify([chatId,sessionId]);
    if(pythonEnvironmentRefreshes.has(key))return;
    pythonEnvironmentRefreshes.add(key);
    try{
      const binding=bindings.get(chatId),chat=chatStore.getChat(chatId);
      if(!binding||binding.sessionId!==sessionId||!chat||chat.deletedAt)return;
      await host.waitForSessionIdle?.(sessionId);
      await execution.waitForTurnWrites(chatId);
      const currentGoal=await host.getGoal(sessionId);
      if(!currentGoal||currentGoal.id!==goal?.id||currentGoal.revision!==goal?.revision||currentGoal.phase!=='paused')return;
      const resolved=await python.resolve({chatId,projectId:chat.projectId??null});
      const previous=sessionPython.get(sessionId);
      if(previous?.key!==pythonKey(resolved)){
        bindings.delete(chatId);
        await host.releaseSession(sessionId);
        const resumedId=await startContextSession({
          model:chat.model,workspace:chatStore.getRuntimeWorkspace(chatId),runtimeConfig:await host.getRuntimeConfig?.(),
          sessionId,persona:roleSettings.bind(chatId,'main',{existing:true}).prompt,
        },{role:'main',chatId,mainChatId:chatId,projectId:chat.projectId??null});
        const nextBinding={sessionId:typeof resumedId==='string'?resumedId:resumedId.sessionId,modelKey:JSON.stringify(chat.model),lastUsed:Date.now()};
        bindings.set(chatId,nextBinding);
        await refreshBrief(nextBinding,chat.projectId??null,chatId);
        const status=await execution.status(chatId);
        await execution.configure(chatId,nextBinding,status.mode);
        const currentAfterRestart=await host.getGoal(nextBinding.sessionId);
        if(!currentAfterRestart||currentAfterRestart.id!==goal.id||currentAfterRestart.revision!==goal.revision||currentAfterRestart.phase!=='paused')return;
        await execution.resumeAfterPythonEnvironmentRefresh(chatId,nextBinding,{id:goal.id,revision:goal.revision});
      }else{
        await execution.resumeAfterPythonEnvironmentRefresh(chatId,binding,{id:goal.id,revision:goal.revision});
      }
    }catch(error){
      execution.failPythonEnvironmentRefresh(chatId);
      onError?.(error);
    }finally{pythonEnvironmentRefreshes.delete(key);}
  }
  function schedulePythonEnvironmentRefresh(request){
    // The child must acknowledge the event before its harness is closed.
    setImmediate(()=>{void performPythonEnvironmentRefresh(request);});
  }
  async function automaticChatIdsForBinding(scope,targetId){
    const result=[];
    for(const [chatId,binding] of bindings){
      if(!execution?.busy(chatId))continue;
      const chat=chatStore.getChat(chatId);
      if(!chat||chat.deletedAt)continue;
      if(scope==='chat'&&chatId!==targetId)continue;
      if(scope==='project'&&chat.projectId!==targetId)continue;
      result.push({chatId,binding,chat});
    }
    return result;
  }
  async function scheduleBoundPythonRefresh(scope,targetId){
    const automatic=await automaticChatIdsForBinding(scope,targetId);
    for(const entry of automatic){
      if(!await needsPythonRefresh(entry.binding.sessionId,entry.chatId,entry.chat.projectId??null))continue;
      if(typeof host.scheduleSessionEnvRefresh!=='function')throw new PythonEnvironmentError('ENVIRONMENT_REFRESH_UNAVAILABLE','运行时无法在自动化轮次间安全切换环境；未继续更改当前会话。',503);
      await host.scheduleSessionEnvRefresh(entry.binding.sessionId);
    }
    return automatic.length;
  }
  async function scheduleDefaultPythonRefresh(){
    const automatic=await automaticChatIdsForBinding();
    for(const entry of automatic){
      if(!await needsPythonRefresh(entry.binding.sessionId,entry.chatId,entry.chat.projectId??null))continue;
      if(typeof host.scheduleSessionEnvRefresh!=='function')throw new PythonEnvironmentError('ENVIRONMENT_REFRESH_UNAVAILABLE','运行时无法在自动化轮次间安全切换环境；未继续更改当前会话。',503);
      await host.scheduleSessionEnvRefresh(entry.binding.sessionId);
    }
    return automatic.length;
  }
  // Shared by Main turns and expert discussions: start (or resume) the chat's
  // DSH session and persist its binding exactly once.
  async function ensureMainBinding({key,input,projectFolder,modelRoute,modelKey,reasoningEffort}) {
    if(bindings.has(key)&&await needsPythonRefresh(bindings.get(key).sessionId,input.chatId,input.projectId)){
      await host.releaseSession(bindings.get(key).sessionId);bindings.delete(key);
    }
    if (bindings.has(key)) return bindings.get(key);
    const originalWorkspace = chatStore.getRuntimeWorkspace(input.chatId);
    const firstAcceptedMessage = !chatStore.getChat(input.chatId);
    // An independent chat's working folder is chosen once, in the creation
    // dialog, and applies when the chat is first created.
    const chosen = !input.temporary && !originalWorkspace && !input.projectId ? await independentFolder(input.chatId, input.workspaceChoice) : null;
    const workspace = input.temporary ? path.join(dataRoot,'.sciencescope-local','temp','quick',input.chatId) : (originalWorkspace || projectFolder || chosen || path.join(projects,'independent'));
    await mkdir(workspace,{recursive:true});
    const persona=input.temporary?roleSettings.get('main').prompt:roleSettings.bind(input.chatId,'main',{existing:!!chatStore.getBinding(input.chatId)}).prompt;
    const session = await startContextSession({model:{...modelRoute,...(reasoningEffort === undefined ? {} : {reasoningEffort})},workspace,runtimeConfig:host.getRuntimeConfig ? await host.getRuntimeConfig() : undefined,sessionId:input.temporary ? undefined : chatStore.getBinding(input.chatId) ?? undefined,persona,pythonEnvId:firstAcceptedMessage?input.pythonEnvId:undefined},{role:input.temporary?'temporary':'main',chatId:input.chatId,mainChatId:input.temporary?null:input.chatId,projectId:input.projectId??null});
    bindings.set(key,{sessionId:typeof session === 'string' ? session : session.sessionId,modelKey,lastUsed:Date.now()});
    if (!input.temporary) {
      await chatStore.ensureChat({chatId:input.chatId,projectId:input.projectId ?? null,title:input.title || input.text,model:input.model});
      if(firstAcceptedMessage&&input.pythonEnvId!==undefined)await python.bind({scope:'chat',targetId:input.chatId,envId:input.pythonEnvId});
      await chatStore.markRuntimeBinding(input.chatId,bindings.get(key).sessionId,workspace);
    }
    return bindings.get(key);
  }
  async function independentFolder(chatId, choice) {
    if (!choice || typeof choice !== 'object') return null;
    if (choice.mode === 'new') return path.join(projects,'independent',chatId);
    if (choice.mode === 'shared') return path.join(projects,'independent');
    if (choice.mode === 'existing') return (await validateWorkFolder(choice.folder,{dataRoot})).folder;
    throw new WorkFolderError('工作文件夹选项无效。');
  }
  // Expert discussion turn. Same chat, project and session rules as Main; the
  // experts run as DSH subagents of this chat's session.
  async function handleDiscussion(input,response){
    if(!discussions)throw new DiscussionError('RUNTIME_UNAVAILABLE','当前运行时不支持专家讨论。',503);
    // 'independent' is the pre-2026-09-24 name of an ordered panel round.
    const kind=input.kind==='invited'?'invited':'ordered';
    const text=typeof input.text==='string'?input.text:'';
    if(typeof input.chatId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/u.test(input.chatId))throw new DiscussionError('INVALID_CHAT','对话标识无效。');
    if(!text.trim())throw new DiscussionError('TEXT_REQUIRED','请输入要讨论的问题。');
    if(text.length>64000)throw new DiscussionError('TEXT_TOO_LONG','问题不能超过 64000 个字符。');
    if(!input.model?.providerId||!input.model?.modelId)throw new DiscussionError('MODEL_REQUIRED','请选择模型。');
    const userMessageId=input.userMessageId??'msg-'+randomUUID();
    if(typeof userMessageId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/u.test(userMessageId))throw new DiscussionError('INVALID_MESSAGE_ID','消息标识无效。');
    let panel=experts.resolveParticipants(input.expertIds);
    let reviewer=kind==='ordered'&&typeof input.reviewerId==='string'&&input.reviewerId?experts.resolveReviewer(input.reviewerId):null;
    if(!panel.some(expert=>expert.id!==reviewer?.id))throw new DiscussionError('NO_EXPERTS','请至少选择一位作答专家（审核专家不单独作答）。');
    // Snapshot only explicitly bound, currently enabled skills before any
    // runtime/session or transcript side effect. Role prompts stay untouched.
    const enabledSkills=new Set((await skills.list()).skills.filter(skill=>skill.enabled&&skill.valid!==false).map(skill=>skill.name));
    const bindSkills=async expert=>{
      const boundSkills=[];
      for(const name of expert.skills || []){
        if(!enabledSkills.has(name))throw new DiscussionError('SKILL_UNAVAILABLE','绑定的技能不存在或未启用，请更新专家配置。');
        const record=await skills.read({name});
        if(!record.enabled)throw new DiscussionError('SKILL_UNAVAILABLE','绑定的技能不存在或未启用，请更新专家配置。');
        boundSkills.push({name,markdown:record.markdown});
      }
      return {...expert,boundSkills};
    };
    panel=await Promise.all(panel.map(bindSkills));if(reviewer)reviewer=await bindSkills(reviewer);
    const executionMode=input.executionMode==='full'?'full':'ask';
    const workspaceState=await chatStore.getWorkspace();
    const projectId=input.projectId??null;
    const currentProject=projectId===null?null:workspaceState.projects.find(project=>project.id===projectId&&!project.archived);
    if(projectId!==null&&!currentProject)throw new DiscussionError('INVALID_PROJECT','请先选择有效的项目。');
    const existingChat=chatStore.getChat(input.chatId);
    if(existingChat?.deletedAt)throw new DiscussionError('CHAT_REMOVED','这条对话已移除。',404);
    if(existingChat&&existingChat.projectId!==projectId)throw new DiscussionError('PROJECT_MISMATCH','此对话属于其他工作区；请先使用移动接口。',409);
    const modelRoute={providerId:input.model.providerId,modelId:input.model.modelId};const modelKey=JSON.stringify(modelRoute);
    if((existingChat?.model&&JSON.stringify({providerId:existingChat.model.providerId,modelId:existingChat.model.modelId})!==modelKey)||(bindings.has(input.chatId)&&bindings.get(input.chatId).modelKey!==modelKey))throw new DiscussionError('MODEL_MISMATCH','此对话已绑定模型；更换模型请新建聊天，避免隐式丢失历史。',409);
    if(existingChat&&database.db.prepare('SELECT 1 FROM messages WHERE chat_id=? AND id=?').get(input.chatId,userMessageId))throw new DiscussionError('DUPLICATE_MESSAGE','这条消息已被接收，不会重复发送。',409);
    if(pending.has(input.chatId)||execution?.busy(input.chatId)||discussions.busy(input.chatId))throw new DiscussionError('CHAT_BUSY','这个对话仍在运行，请等待或停止后再讨论。',409);
    pending.add(input.chatId);
    try{
      const projectFolder=currentProject?(await workbench.call(currentProject.id,'get')).folder:undefined;
      const compiled=await researchInput.compile({...input.researchInput,text,projectId});
      const binding=await ensureMainBinding({key:input.chatId,input:{...input,projectId,text:text||'专家讨论'},projectFolder,modelRoute,modelKey,reasoningEffort:undefined});
      await execution.configure(input.chatId,binding,executionMode);
      const context=currentProject?`[ScienceScope project context]\nProject: ${currentProject.name}\nResearch goal: ${currentProject.desc||''}\nProject directory: ${projectFolder}\n\n`:'';
      const brief=research.retrieval.brief({projectId});
      const recalled=await recallForTurn(research.retrieval,{text,projectId,briefRefs:brief.refs});
      const expertContext=context+(brief.text?`${brief.text}\n\n`:'')+(recalled.text?`${recalled.text}\n\n`:'');
      response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
      const emit=event=>{if(!response.destroyed)response.write(JSON.stringify(event)+'\n');};
      const discussionResult=await discussions.run({chatId:input.chatId,sessionId:binding.sessionId,experts:panel,reviewer,kind,context:expertContext,requestText:compiled.text,chatModel:modelRoute,
        userMessage:{id:userMessageId,text},
        onEvent:event=>{
          if(event.type==='accepted'){
            if(compiled.snapshot)researchDrafts.accepted('main',input.chatId,input.chatId,userMessageId,compiled.snapshot);
            for(const expert of event.experts||[]){
              expertTurnMessages.set(expertTurnKey(binding.sessionId,expert.id),{chatId:input.chatId,messageId:expert.messageId});
              recordInputUsage(input.chatId,expert.messageId,compiled.snapshot);
              if(brief.refs.length)research.store.recordUsage({chatId:input.chatId,messageId:expert.messageId,refs:brief.refs,how:'brief'});
              if(recalled.refs.length)research.store.recordUsage({chatId:input.chatId,messageId:expert.messageId,refs:recalled.refs,how:'recall'});
            }
          }
          emit(event);
        }});
      binding.lastUsed=Date.now();
      void events.emit('discussion.finished',{chatId:input.chatId});
      await chatStore.setMessageReceipt(input.chatId,userMessageId,{completionStatus:discussionResult.failed?'failed':'completed'});
      response.end();
    }finally{pending.delete(input.chatId);for(const [key,value] of expertTurnMessages)if(value.chatId===input.chatId)expertTurnMessages.delete(key);}
  }
  const json = (response,status,body) => { response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(body)); };
  const binary = (response,status,body,type) => { response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); response.end(body); };
  async function handle(request,response) {
    const requestUrl = new URL(request.url,'http://127.0.0.1');
    const route = requestUrl.pathname;
    if (!route.startsWith('/api/')) return false;
    if (request.headers.host !== `127.0.0.1:${request.socket.localPort}`) { json(response,403,{message:'仅允许本地客户端访问。'}); return true; }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { json(response,403,{message:'请求来源不匹配。'}); return true; }
    if (apiToken !== null) {
      const supplied = request.headers.authorization?.startsWith('Bearer ')
        ? request.headers.authorization.slice('Bearer '.length)
        : '';
      const expected = Buffer.from(String(apiToken));
      const actual = Buffer.from(supplied);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        json(response,401,{message:'本地 API 口令无效。'}); return true;
      }
    }
      if (route === '/api/status' && request.method === 'GET') { json(response,200,capabilities); return true; }
      try {
      if(route==='/api/python/envs'&&request.method==='GET'){json(response,200,await python.list());return true;}
      if(route==='/api/python/settings'&&request.method==='GET'){json(response,200,await python.getSettings());return true;}
      if(route==='/api/python/system'&&request.method==='GET'){json(response,200,await python.detectSystem());return true;}
      if(route==='/api/python/logs'&&request.method==='GET'){json(response,200,{logs:await python.getLogs(requestUrl.searchParams.get('envId'))});return true;}
      if(route==='/api/python/resolve'&&request.method==='GET'){
        const chatId=requestUrl.searchParams.get('chatId');
        const projectId=chatId?chatStore.getChat(chatId)?.projectId:requestUrl.searchParams.get('projectId');
        const resolved=await python.resolve({chatId,projectId});
        json(response,200,{...resolved,applicationTiming:'next-turn'});return true;
      }
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
        const snapshot=await assistants.snapshot(scope,ownerId,{before:requestUrl.searchParams.get('before')??undefined,after:requestUrl.searchParams.get('after')??undefined,limit:requestUrl.searchParams.get('limit')||60});
        const openedKey=JSON.stringify([scope,ownerId]);if(!openedAssistants.has(openedKey)){openedAssistants.add(openedKey);void events.emit('assistant.opened',{scope,ownerId});}
        json(response,200,{...snapshot,attachments:attachments.listDraft(scope,ownerId)});return true;
      }
      if(route==='/api/execution'&&request.method==='GET'){const chatId=requestUrl.searchParams.get('chatId');const status=execution?await execution.status(chatId):{mode:'ask',goal:null,approvals:[],unavailable:true};json(response,200,{...status,expertContexts:discussions&&chatId?discussions.contexts(chatId):[]});return true;}
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
        page.chat.draftText=chatStore.getBranchDraft(decodeURIComponent(chatMatch[1]));
        for(const message of page.messages)message.branchMode=branching.modeFor(page.chat.id,message);
        if(discussions){const authors=discussions.entriesFor(decodeURIComponent(chatMatch[1]),page.messages.filter(m=>m.role==='assistant').map(m=>m.id));for(const message of page.messages)if(authors.has(message.id))message.expert=authors.get(message.id);
          // Answers are stored in completion order; a round is always shown in roster order.
          for(let start=0;start<page.messages.length;){const run=page.messages[start].expert?.runId;let end=start+1;if(run)while(end<page.messages.length&&page.messages[end].expert?.runId===run)end++;if(end-start>1)page.messages.splice(start,end-start,...page.messages.slice(start,end).sort((a,b)=>a.expert.position-b.expert.position));start=end;}}
        json(response,200,page); return true;
      }
      if (route === '/api/workspace' && request.method === 'GET') { json(response,200,await chatStore.getWorkspace()); return true; }
      if(route==='/api/model-info'&&request.method==='GET'){
        if(!host?.getModelInfo){json(response,503,{message:'模型能力查询暂不可用。'});return true;}
        json(response,200,await host.getModelInfo({providerId:requestUrl.searchParams.get('providerId'),modelId:requestUrl.searchParams.get('modelId')}));return true;
      }
      if(route==='/api/library'&&request.method==='GET'){json(response,200,{resources:await library.list({projectId:requestUrl.searchParams.get('projectId')||undefined,query:requestUrl.searchParams.get('query')||''})});return true;}
      // Preview shows exactly what the research-input compiler would extract (same path and 64000-char budget).
      if(route==='/api/library/preview'&&request.method==='GET'){const id=requestUrl.searchParams.get('id')||'',resource=id?await database.getResource(id):null;if(!resource)throw new WorkbenchApiError('NOT_FOUND','资料不存在。',404);const [item]=await attachments.compile([id],{structured:true});json(response,200,{id,title:resource.title,kind:resource.kind,text:typeof item.text==='string'?item.text:null,truncated:!!item.truncated,note:item.note||''});return true;}
      if(route==='/api/library/document'&&request.method==='GET'){json(response,200,await documentPreview.document(requestUrl.searchParams.get('id')));return true;}
      if(route==='/api/library/content'&&request.method==='GET'){const value=await documentPreview.content(requestUrl.searchParams.get('id'));binary(response,200,value.bytes,value.type);return true;}
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
      if(route==='/api/chats/minutes'&&request.method==='GET'){const chatId=requestUrl.searchParams.get('chatId')||'';json(response,200,{minutes:minutes.get(chatId),history:minutes.history(chatId),updating:minutes.updating(chatId),latestMessage:minutes.messagesAfter(chatId,0).at(-1)?.ordinal??0,summaryStatus:await minutes.summaryStatus(chatId),exportStatus:minutes.exportStatus(chatId)});return true;}
      if(route==='/api/summary/proposals'&&request.method==='GET'){json(response,200,{proposals:summaryWorkbench.listProposals(requestUrl.searchParams.get('chatId')||'')});return true;}
      if(route==='/api/summary/writes'&&request.method==='GET'){json(response,200,{writes:summaryWorkbench.listWrites(requestUrl.searchParams.get('chatId')||'')});return true;}
      if(route==='/api/chats/deliverable'&&request.method==='GET'){const image=await deliverables.image(requestUrl.searchParams.get('chatId')||'',requestUrl.searchParams.get('path')||'');binary(response,200,image.bytes,image.type);return true;}
      if(route==='/api/fonts'&&request.method==='GET'){json(response,200,await listFonts({refresh:requestUrl.searchParams.get('refresh')==='1'}));return true;}
      if(route==='/api/secretary/preferences'&&request.method==='GET'){json(response,200,secretaryPreferences.get({language:preferences.get().language}));return true;}
      if(route==='/api/shortcuts'&&request.method==='GET'){json(response,200,shortcuts.get());return true;}
      if(route==='/api/assistant-window/preferences'&&request.method==='GET'){json(response,200,assistantWindowPreferences.get());return true;}
      if(route==='/api/research-input/draft'&&request.method==='GET'){const value=researchDrafts.get(requestUrl.searchParams.get('scope'),requestUrl.searchParams.get('ownerId'));value.labels={};for(const id of [...value.attachmentIds,...value.contextRefs.flatMap(ref=>ref.resourceId?[ref.resourceId]:[])]){const resource=await database.getResource(id);if(resource)value.labels[id]=resource.title;}for(const ref of value.contextRefs){if(ref.itemId){const item=research.store.getItem(ref.itemId);if(item)value.labels[ref.itemId]=item.title;}}json(response,200,value);return true;}
      if(route==='/api/experts'&&request.method==='GET'){json(response,200,{experts:experts.list(),available:!!discussions});return true;}
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
      if(route==='/api/research/embedding'&&request.method==='GET'){json(response,200,semantic.status());return true;}
      if(route.startsWith('/api/research/')&&request.method==='GET'){const body=await research.handleGet(route,requestUrl);if(body!==undefined){json(response,200,body);return true;}}
      if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) { json(response,405,{message:'请求方式无效。'}); return true; }
      const chunks = []; let length = 0;
      const uploadRoute = ['/api/workbench/import','/api/workbench/asset','/api/library/import'].includes(route);
      for await (const chunk of request) { length += chunk.length; if(length > (uploadRoute ? 20*1024*1024 : 1024*1024)) throw new WorkbenchApiError('REQUEST_TOO_LARGE', uploadRoute ? '上传文件不能超过 20MiB。' : '请求内容过大。', 413); chunks.push(chunk); }
      let input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!input||typeof input!=='object'||Array.isArray(input)){json(response,400,{message:'请求格式无效。'});return true;}
      if(route==='/api/chats/draft'){
        if(typeof input.chatId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/u.test(input.chatId)||typeof input.text!=='string'||input.text.length>64000){json(response,400,{message:'草稿格式无效。'});return true;}
        const chat=chatStore.getChat(input.chatId);if(!chat?.branchedFrom||chat.deletedAt||conversations.isAssistant(chat.id)){json(response,404,{message:'对话不存在。'});return true;}
        await chatStore.setBranchDraft(input.chatId,input.text);json(response,200,{saved:true});return true;
      }
      if(route==='/api/chats/branch'){
        if(typeof input.chatId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/u.test(input.chatId)||typeof input.messageId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/u.test(input.messageId)||!['reply','reask'].includes(input.mode)){json(response,400,{message:'分支请求无效。'});return true;}
        const key=input.chatId,source=chatStore.getChat(key);
        if(!source||source.deletedAt||conversations.isAssistant(key)){json(response,404,{message:'主对话不存在。'});return true;}
        if(pending.has(key)||mainRuns.has(key)||discussions?.busy(key)||execution?.busy(key)||outbox.list(key).items.some(item=>['queued','sending'].includes(item.status))){json(response,409,{code:'CHAT_BUSY',message:'这个对话仍在运行，请等待当前任务结束。'});return true;}
        if(typeof host?.forkSession!=='function'||typeof host?.sessionTurns!=='function'||!chatStore.getBinding(key)){json(response,503,{message:'当前运行时暂不支持对话分支。'});return true;}
        pending.add(key);
        try{const result=await branching.branch({sourceId:key,messageId:input.messageId,mode:input.mode});json(response,200,{chatId:result.chat.id,title:result.chat.title,branchedFrom:result.chat.branchedFrom,draftText:result.draftText});}
        catch(error){if(error instanceof ChatBranchError)json(response,error.status,{code:error.code,message:error.message});else throw error;}
        finally{pending.delete(key);await trimIdleSessions();}
        return true;
      }
      if (route === '/api/chats/minutes') { if(!chatStore.getChat(String(input.chatId||'')))throw new MinutesError('CHAT_NOT_FOUND','对话不存在。',404); json(response,200,{minutes:minutes.edit(String(input.chatId),input.text,Number(input.expectedRevision)||0)}); return true; }
      if (route === '/api/chats/minutes/refresh') { if(!chatStore.getChat(String(input.chatId||'')))throw new MinutesError('CHAT_NOT_FOUND','对话不存在。',404); json(response,200,{minutes:await minutes.refresh(String(input.chatId))}); return true; }
      if (route === '/api/chats/deliverable/open') { json(response,200,await deliverables.open(String(input.chatId||''),String(input.path||''))); return true; }
      if (route === '/api/open-url') { const href=externalUrl(input?.url); if(!href)throw new WorkbenchApiError('INVALID_URL','只能打开 http 或 https 网址。'); json(response,200,await openUrl(href)); return true; }
      if(!input||typeof input!=='object'||Array.isArray(input)){json(response,400,{message:'请求格式无效。'});return true;}
      if(route==='/api/projects/focus'){
        if(input.projectId!==null&&(typeof input.projectId!=='string'||!(await chatStore.getWorkspace()).projects.some(project=>project.id===input.projectId&&!project.archived)))throw new WorkbenchApiError('PROJECT_NOT_FOUND','项目不存在或已归档。',404);
        json(response,200,await summaryPolicy.focus(input.projectId));return true;
      }
      if(route==='/api/summary/proposals/decide'){json(response,200,await summaryWorkbench.decide(input));return true;}
      if(route==='/api/summary/writes/undo'){json(response,200,await summaryWorkbench.undo(input));return true;}
      if(input.researchInput!==undefined&&(!input.researchInput||typeof input.researchInput!=='object'||Array.isArray(input.researchInput))){json(response,400,{code:'INVALID_RESEARCH_INPUT',message:'研究输入格式无效，未发送。'});return true;}
      if(route==='/api/research/embedding'){json(response,200,await semantic.configure(input.action));return true;}
      if(route.startsWith('/api/research/')){const body=await research.handlePost(route,input);if(body!==undefined){semantic.rebuild();json(response,200,body);return true;}}
      if(route==='/api/experts'){const enabledSkillIds=(await skills.list()).skills.filter(skill=>skill.enabled&&skill.valid!==false).map(skill=>skill.name);json(response,200,{experts:experts.save(input.experts,{enabledSkillIds}),available:!!discussions});return true;}
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
      if(route==='/api/secretary/preferences'){try{json(response,200,secretaryPreferences.save(input));}catch(error){if(error.code==='INVALID_SECRETARY_PREFERENCES')json(response,400,{code:error.code,message:input.summary!==undefined?'自动总结设置无效：消息间隔须为 4–500，token 间隔须为 2000–500000；更新方式须为关闭、提议或直接更新。':'版本说明模板须为 1–16000 字符。'});else throw error;}return true;}
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
        if(!input.temporary&&discussions?.busy(input.chatId)){json(response,200,{...await discussions.cancel(input.chatId),chatId:input.chatId});return true;}
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
        const compiled=await researchInput.compile({...input,...input.researchInput,text:input.text,projectId:input.scope==='secretary'?chatStore.getChat(input.ownerId)?.projectId??null:null,attachmentIds:[...new Set([...(input.attachmentIds||[]),...(input.researchInput?.attachmentIds||[])])]});
        input.researchContext=compiled.text;
        assistantRequests++;
        try{await assistants.send(input,{
          accept:()=>{response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});},
          emit:event=>{if(event.type==='accepted')researchDrafts.accepted(input.scope,input.ownerId,event.chatId,event.userMessageId,compiled.snapshot);if(!response.destroyed)response.write(JSON.stringify(event)+'\n');}
        });}finally{assistantRequests--;}
        attachments.clearCaptured(input.scope,input.ownerId,input.attachmentIds);response.end();return true;
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
      if(route==='/api/execution/goal'){if(!execution)throw new Error('RUNTIME_UNAVAILABLE');const binding=await restoreExecution(input.chatId,{refreshEnvironment:input.action==='resume'});json(response,200,await execution.action(input.chatId,binding,input.action));return true;}
      if(route==='/api/execution/approval'){if(!execution)throw new Error('RUNTIME_UNAVAILABLE');await execution.approve(input.chatId,input.requestId,input.allowed===true);json(response,200,{answered:true});return true;}
      if(route==='/api/library/import'){
        const resource=await library.importFile(input);
        const source=await research.ingest.ensureSource(resource.id);
        void research.ingest.enqueue(source.id).catch(error=>research.store.markContent(source.id,'failed',{parseError:String(error?.message??error).slice(0,1000)}));
        json(response,200,resource);return true;
      }
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
        const modeLabels = { work: '工作模式', ordered: '有序讨论' };
        if (typeof input.chatId !== 'string' || !Object.hasOwn(modeLabels, input.mode) || typeof input.messageId !== 'string') {
          json(response,400,{message:'对话工作方式参数无效。'}); return true;
        }
        if (!chatStore.getChat(input.chatId)) { json(response,404,{message:'对话不存在。'}); return true; }
        if (pending.has(input.chatId) || execution?.busy(input.chatId)) {
          json(response,409,{message:'这个对话仍在运行，请等待当前请求结束后再切换工作方式。'}); return true;
        }
        const suffix = input.mode === 'work' ? '；可用 @专家名 邀请专家回答。' : '：所选专家将读取同一份前文并行独立作答。';
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
      if (route === '/api/workbench/save') { const saved=await workbench.call(input.projectId,'save',{revision:input.revision,map:input.map,logs:input.logs,autoOrganize:input.autoOrganize}); void events.emit('workbench.changed',{projectId:input.projectId}); json(response,200,saved); return true; }
      if (route === '/api/workbench/bind') { const {folder}=await validateWorkFolder(input.folder,{dataRoot}); json(response,200,await workbench.call(input.projectId,'bind',folder)); return true; }
      if (route === '/api/folders/check') { json(response,200,await validateWorkFolder(input.folder,{dataRoot})); return true; }
      if(route==='/api/python/settings'){
        const previous=await python.getSettings(),updated=await python.updateSettings(input);
        try{await scheduleDefaultPythonRefresh();}catch(error){
          await python.updateSettings({defaultEnvId:previous.defaultEnvId,indexUrl:previous.indexUrl,autoApproveFull:previous.autoApproveFull});
          throw error;
        }
        json(response,200,updated);return true;
      }
      if(route==='/api/python/envs'){json(response,200,input.action==='builtin'?await python.ensureBuiltin():await python.operate(input));return true;}
      if(route==='/api/python/envs/packages'){json(response,200,await python.packages({...input,actor:'user'}));return true;}
      if(route==='/api/python/cache/prune'){json(response,200,await python.cachePrune());return true;}
      if(route==='/api/python/bind'){
        const exists=input.scope==='project'?(await chatStore.getWorkspace()).projects.some(project=>project.id===input.targetId):input.scope==='chat'&&!!chatStore.getChat(input.targetId);
        if(!exists)throw new PythonEnvironmentError('BINDING_TARGET_NOT_FOUND','找不到环境绑定目标。',404);
        const previous=database.db.prepare('SELECT env_id FROM python_env_bindings WHERE scope=? AND target_id=?').get(input.scope,input.targetId);
        const result=await python.bind(input);
        try{await scheduleBoundPythonRefresh(input.scope,input.targetId);}catch(error){
          await python.bind({scope:input.scope,targetId:input.targetId,envId:previous?.env_id??null});
          throw error;
        }
        json(response,200,{...result,applicationTiming:'next-turn'});return true;
      }
      if(route==='/api/python/export'){
        const text=await python.exportManifest(input.envId);
        const output=path.join(dataRoot,'.sciencescope-local','exports','python',String(input.envId),'requirements.txt');
        await mkdir(path.dirname(output),{recursive:true});
        await writeFile(output,text,{encoding:'utf8'});
        json(response,200,{text,path:output});return true;
      }
      if (route === '/api/workbench/import') {
        if (typeof input.base64 !== 'string' || Buffer.byteLength(input.base64,'base64') > workbench.MAX_UPLOAD) throw new WorkbenchApiError('REQUEST_TOO_LARGE','上传文件不能超过 20MiB。',413);
        const version=await workbench.call(input.projectId,'importFile',{name:input.name,base64:input.base64,group:input.group});
        void events.emit('version.stored',{projectId:input.projectId,versionId:version.id,model:input.model});
        void events.emit('workbench.changed',{projectId:input.projectId});
        json(response,200,version); return true;
      }
      if (route === '/api/workbench/asset') {
        if (typeof input.base64 !== 'string' || Buffer.byteLength(input.base64,'base64') > workbench.MAX_UPLOAD) throw new WorkbenchApiError('REQUEST_TOO_LARGE','上传文件不能超过 20MiB。',413);
        json(response,200,await workbench.call(input.projectId,'addAsset',{name:input.name,base64:input.base64})); return true;
      }
      if (route === '/api/workbench/version') { const saved=await workbench.call(input.projectId,'updateVersion',input.id,input.patch || {}); void events.emit('workbench.changed',{projectId:input.projectId}); json(response,200,saved); return true; }
      if (route === '/api/workbench/plans') { const saved=await workbench.store.savePlans(input.plans); for(const project of (await chatStore.getWorkspace()).projects??[])void events.emit('workbench.changed',{projectId:project.id}); json(response,200,saved); return true; }
      if (route === '/api/workbench/open') { json(response,200,await workbench.open(input.projectId,input.path)); return true; }
      if (route === '/api/workbench/organize') {
        await workbench.project(input.projectId);
        if(!organizer||!input.model?.providerId||!input.model?.modelId){json(response,409,{message:'请选择一个已配置模型后整理；原件已保存。'});return true;}
        const result=await organizer.organize({projectId:input.projectId,versionId:input.versionId,model:input.model});void events.emit('workbench.changed',{projectId:input.projectId});json(response,200,result);return true;
      }
      if (chatMatch && request.method === 'POST' && !route.endsWith('/messages') && !['/api/chats/update','/api/chats/move','/api/chats/delete'].includes(route)) {
        json(response,400,{message:'请使用明确的对话操作接口。'}); return true;
      }
      // Stable action endpoints are convenient for clients that do not put an
      // operation name in the body. They share the same strict store methods.
      if (request.method === 'POST' && ['/api/chats/update','/api/chats/move','/api/chats/delete'].includes(route)) {
        const chatId = input.chatId;
        if (pending.has(chatId)||execution?.busy(chatId)||assistants.busyOwner(chatId)||discussions?.busy(chatId)) { json(response,409,{message:'这个任务或秘书仍在运行，请先停止。'}); return true; }
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
      if (route === '/api/discussion/adopt') { if(!discussions)throw new DiscussionError('RUNTIME_UNAVAILABLE','当前运行时不支持专家讨论。',503); json(response,200,{entry:discussions.adopt(String(input.chatId||''),String(input.messageId||''),input.adopted===true)}); return true; }
      if (route === '/api/discussion/cancel') { json(response,200,discussions?await discussions.cancel(input.chatId):{stopped:false}); return true; }
      if (route === '/api/discussion') { await handleDiscussion(input,response); return true; }
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
        const compiled=await researchInput.compile({...input.researchInput,text:input.text,projectId:existingChat?.projectId??input.projectId??null});
        if(input.outboxId) {
          claimed=!!await outbox.claim({chatId:input.chatId,id:input.outboxId});
          if(!claimed){json(response,409,{message:'队列已暂停或另一条消息仍在执行。'});return true;}
        }
        await ensureMainBinding({key,input,projectFolder,modelRoute,modelKey,reasoningEffort});
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
        if (!input.temporary) {
          await chatStore.appendMessage({chatId:input.chatId,id:input.userMessageId,role:'user',text:input.text,completionStatus:'pending'});
          if(chatStore.getBranchDraft(input.chatId)===input.text)await chatStore.setBranchDraft(input.chatId,'');
          await chatStore.setReasoningEffort(input.chatId,reasoningEffort ?? null);
        }
        let finalEvent;let receipts=Promise.resolve();
        const persistPartial = async text => {
          if(!run || input.temporary || run.persisted || !run.accepted) return;
          run.persisted=true;
          await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:text || '',completionStatus:run?.cancelled?'cancelled':'failed'});
          await chatStore.setMessageReceipt(input.chatId,input.userMessageId,{completionStatus:run?.cancelled?'cancelled':'failed'});
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
        if(!input.temporary)recordInputUsage(input.chatId,input.assistantMessageId,compiled.snapshot);
        emit({type:'accepted',chatId:input.chatId,researchInput:compiled.snapshot});
        if(run) run.accepted=true;
        if(run?.cancelled) {
          await persistPartial('');
          response.write(JSON.stringify({type:'cancelled',chatId:input.chatId,text:''})+'\n');
          return true;
        }
        const contextPrefix = currentProject ? `[ScienceScope ${input.temporary?'temporary ':''}project context]\nProject: ${currentProject.name}\nResearch goal: ${currentProject.desc || ''}\nProject ID: ${currentProject.id}\nProject directory: ${projectFolder}\nSession working directory: ${input.temporary?path.join(dataRoot,'.sciencescope-local','temp','quick',input.chatId):chatStore.getRuntimeWorkspace(input.chatId)}\n${input.temporary?'This is a separate temporary question, not the Main conversation.':''}\n\n` : '';
        // Expert answers the Main expert has not read yet travel with this turn.
        const panelNews=!input.temporary&&discussions?discussions.pendingForMain(input.chatId):{text:'',commit(){}};
        const recall=!input.temporary?await recallForTurn(research.retrieval,{text:input.text,projectId:currentProject?.id??null,briefRefs:research.retrieval.brief({projectId:currentProject?.id??null}).refs}):{text:'',refs:[]};
        if(recall.refs.length)research.store.recordUsage({chatId:input.chatId,messageId:input.assistantMessageId,refs:recall.refs,how:'recall'});
        const recallText=recall.text?recall.text+'\n\n':'';
        if(!input.temporary)await refreshBrief(bindings.get(key),currentProject?.id??null,input.chatId,input.assistantMessageId);
        if(executionMode==='auto'){
          const goal=await execution.start(key,bindings.get(key),contextPrefix+panelNews.text+recallText+compiled.text,input.goalMaxRounds,input.userMessageId);panelNews.commit();
          emit({type:'goal-started',goal});emit({type:'completed',text:'',background:true});response.end();return true;
        }
        try {
          if(run)run.sending=true;
          turnMessages.set(bindings.get(key).sessionId,input.assistantMessageId);
          try{await host.send({sessionId:bindings.get(key).sessionId,text:contextPrefix + panelNews.text + recallText + compiled.text,onEvent});}
          finally{turnMessages.delete(bindings.get(key)?.sessionId);}
          panelNews.commit();
          await receipts;
        } catch (error) {
          await receipts;
          if(run?.cancelled) {
            await persistPartial(run.currentText);
            emit({type:'cancelled',chatId:input.chatId,text:run.currentText}); return true;
          }
          if(!input.temporary)researchDrafts.restore('main',input.chatId,compiled.snapshot);
          if (!input.temporary) {
            await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:'请求失败，未生成完整回答。',completionStatus:'failed'});
            await chatStore.setMessageReceipt(input.chatId,input.userMessageId,{completionStatus:'failed'});
          }
          throw error;
        }
          if(run?.cancelled) {
          if(finalEvent && typeof finalEvent.text==='string' && !run.currentText) run.currentText=finalEvent.text;
          await persistPartial(run.currentText);
          emit({type:'cancelled',chatId:input.chatId,text:run.currentText}); return true;
        }
        if (!input.temporary && finalEvent && typeof finalEvent.text === 'string') {
          let endSeq=null;
          if(typeof host.sessionTurns==='function')try{const turns=await host.sessionTurns({sessionId:bindings.get(key).sessionId});endSeq=turns.turns?.at(-1)?.endSeq??null;}catch{}
          if(run)run.persisted=true;
          await chatStore.setMessageReceipt(input.chatId,input.userMessageId,{runtimeSeq:Number.isSafeInteger(endSeq)?endSeq:null,completionStatus:'completed'});
          await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:finalEvent.text,runtimeSeq:Number.isSafeInteger(endSeq)?endSeq:null,completionStatus:'completed'});
          void events.emit('chat.turn.persisted',{chatId:input.chatId});
        }
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
      if(!response.headersSent&&error instanceof WorkFolderError){json(response,400,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&error instanceof DeliverableError){json(response,error.status,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&error instanceof MinutesError){json(response,error.status,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&error instanceof SummaryWorkbenchError){json(response,error.status,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&error instanceof ContextAccessError){json(response,error.status,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&error instanceof ResearchBaseError){json(response,error.status,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&error instanceof PythonEnvironmentError){json(response,error.status,{code:error.code,message:error.message});return true;}
      if(!response.headersSent&&(error instanceof ExpertRosterError||error instanceof DiscussionError)){json(response,error.status,{code:error.code,message:error.message});return true;}
      if (error instanceof WorkbenchApiError||error instanceof RoleSettingsError||error instanceof SkillManagerError) { json(response,error.status,{code:error.code,message:error.message}); return true; }
      // Raw runtime errors can contain credentials or provider payloads.
      const message = publicRuntimeMessage(error);
      if (response.headersSent) response.end(JSON.stringify({type:'failed',message})+'\n');
      else json(response,500,{message});
    }
    return true;
  }
  void events.emit('app.started',{});
  if(pythonBootstrap)void python.ensureBuiltin().catch(error=>onError?.(error));
  return {handle,close:async()=>{
    await summaryPolicy.shutdown();await summaryPolicy.close();
    const draining=events.close();
    await Promise.all([summaryWorkbench.close(),minutes.close()]);await draining;
    await assistants.close();await Promise.allSettled([host?.close(),web?.close(),skills.close(),python.close()]);await execution?.close();await chatStore.queue;await profileStore.queue;await research.ingest.idle();await semantic.close();chatStore.close?.();profileStore.close?.();
  }};
}
