import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { defaultRoot } from './prepare-desktop.mjs';
import { createChatStore, ProfileStore } from './chat-store.mjs';
import { createWorkbenchApi, WorkbenchApiError } from './workbench-api.mjs';
import { createVersionOrganizer } from './version-organizer.mjs';
import { createLibraryService } from './library-service.mjs';
import {randomUUID} from 'node:crypto';
import {createExecutionService} from './execution-service.mjs';
import { readFile as readFileBytes } from 'node:fs/promises';

function publicRuntimeMessage(error) {
  const raw = String(error?.message || '').toLowerCase();
  if (/401|403|invalid credential|api key|unauthorized|authentication/.test(raw)) return '模型服务认证失败；请检查已保存的服务凭据。';
  if (/429|quota|rate limit|too many requests/.test(raw)) return '模型服务暂时限流或额度不足；请稍后重试或检查服务额度。';
  if (/timed out|timeout|econnrefused|enotfound|fetch failed|network/.test(raw)) return '无法连接模型服务；请检查服务地址和网络连接。';
  if (/reasoning.?effort/.test(raw)) return '模型不支持所选推理强度；请改用该模型公开支持的 reasoningEffort。';
  return '运行时请求失败；请检查模型配置和网络连接。';
}

export async function createDesktopApi({onError, dataRoot = defaultRoot} = {}) {
  let host;
  let web;
  const bindings = new Map();
  const pending = new Set();
  async function trimIdleSessions() {
    const idle=[...bindings].filter(([id,binding])=>!id.startsWith('temporary:')&&!pending.has(id)&&!binding.goalActive).sort((a,b)=>(a[1].lastUsed||0)-(b[1].lastUsed||0));
    for(const [id,binding] of idle.slice(0,Math.max(0,idle.length-3))) {
      await host.releaseSession(binding.sessionId);bindings.delete(id);
    }
  }
  const home = path.join(dataRoot,'.sciencescope-local','dsh');
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
  const library=createLibraryService({database,root:path.join(dataRoot,'.sciencescope-local','library'),workbench,getWorkspace:()=>chatStore.getWorkspace()});
  let sessionHeaders = [];
  try { sessionHeaders = JSON.parse(await readFile(path.join(dataRoot,'.sciencescope-local/state/runtime-client.json'),'utf8')).sessionHeaders || []; } catch {}
  try {
    const {createDshHost} = await import('../adapters/runtime-dsh/host.mjs');
    host = await createDshHost({home,cwd:projects,sessionHeaders});
    const {createDshWebHost} = await import('../adapters/runtime-dsh/web-host.mjs');
    const {createProviderService} = await import('../adapters/runtime-dsh/provider-service.mjs');
    web = await createDshWebHost({home,cwd:projects});
    if (typeof web.call === 'function') Object.assign(host,createProviderService(web.call));
  } catch { /* Missing/unavailable runtime is shown as unavailable, never faked. */ }
  const capabilities = {
    available:!!host && typeof host.listProviders==='function',
    saveProvider:typeof host?.saveProvider === 'function',
    discoverModels:typeof host?.discoverModels === 'function',
    tokenStreaming:host?.capabilities?.tokenStreaming === true,
    reasoningEffort:host?.capabilities?.reasoningEffort === true,
  };
  const organizer=host?createVersionOrganizer({host,store:workbench.store,getProject:async id=>{
    const {meta}=await workbench.project(id);return {name:meta.name,goal:meta.desc||''};
  }}):null;
  const execution=host?createExecutionService({host,database,chatStore,bindings}):null;
  async function restoreExecution(chatId){
    if(bindings.has(chatId))return bindings.get(chatId);
    const chat=chatStore.getChat(chatId);if(!chat?.model||!chatStore.getBinding(chatId))throw new Error('CHAT_NOT_FOUND');
    const sessionId=await host.startSession({model:chat.model,workspace:chatStore.getRuntimeWorkspace(chatId),runtimeConfig:await host.getRuntimeConfig?.(),sessionId:chatStore.getBinding(chatId)});
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
      if(route==='/api/execution'&&request.method==='GET'){json(response,200,execution?await execution.status(requestUrl.searchParams.get('chatId')):{mode:'ask',goal:null,approvals:[],unavailable:true});return true;}
      if (route === '/api/chats' && request.method === 'GET') {
        json(response,200,{chats:chatStore.listChats(requestUrl.searchParams.has('projectId') ? requestUrl.searchParams.get('projectId') : undefined)}); return true;
      }
      if (chatMatch && request.method === 'GET' && route.endsWith('/messages')) {
        const page = await chatStore.pageMessages(decodeURIComponent(chatMatch[1]), {before:requestUrl.searchParams.get('before') ?? undefined, after:requestUrl.searchParams.get('after') ?? undefined, limit:requestUrl.searchParams.get('limit') ?? 60});
        if (!page) { json(response,404,{message:'对话不存在。'}); return true; }
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
      if (route === '/api/providers' && request.method === 'GET') {
        if (!host) { json(response,503,{message:'DSH 宿主尚未就绪。'}); return true; }
        json(response,200,{providers:host.listProviders ? await host.listProviders() : []}); return true;
      }
      if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) { json(response,405,{message:'请求方式无效。'}); return true; }
      const chunks = []; let length = 0;
      const uploadRoute = ['/api/workbench/import','/api/workbench/asset','/api/library/import'].includes(route);
      for await (const chunk of request) { length += chunk.length; if(length > (uploadRoute ? 20*1024*1024 : 1024*1024)) throw new WorkbenchApiError('REQUEST_TOO_LARGE', uploadRoute ? '上传文件不能超过 20MiB。' : '请求内容过大。', 413); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
        if (pending.has(chatId)||execution?.busy(chatId)) { json(response,409,{message:'这个对话仍在运行，请先暂停自动化。'}); return true; }
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
        else result = await chatStore.remove(chatId);
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
      if (existingChat?.model && JSON.stringify({providerId:existingChat.model.providerId,modelId:existingChat.model.modelId}) !== modelKey) { json(response,409,{message:'此对话已绑定模型；更换模型请新建聊天，避免隐式丢失历史。'}); return true; }
      if (existingChat && existingChat.projectId !== (input.projectId ?? null)) { json(response,409,{message:'此对话属于其他工作区；请先使用移动接口。'}); return true; }
      if (bindings.has(key) && bindings.get(key).modelKey !== modelKey) { json(response,409,{message:'此对话已绑定模型；更换模型请新建聊天，避免隐式丢失历史。'}); return true; }
      pending.add(key);
      try {
        if (!bindings.has(key)) {
          const originalWorkspace = chatStore.getRuntimeWorkspace(input.chatId);
          const workspace = input.temporary ? path.join(dataRoot,'.sciencescope-local','temp','quick',input.chatId) : (originalWorkspace || projectFolder || path.join(projects,'independent'));
          await mkdir(workspace,{recursive:true});
          const session = await host.startSession({model:{...modelRoute,...(reasoningEffort === undefined ? {} : {reasoningEffort})},workspace,runtimeConfig:host.getRuntimeConfig ? await host.getRuntimeConfig() : undefined,sessionId:input.temporary ? undefined : chatStore.getBinding(input.chatId) ?? undefined});
          bindings.set(key,{sessionId:typeof session === 'string' ? session : session.sessionId,modelKey,lastUsed:Date.now()});
          if (!input.temporary) {
            await chatStore.ensureChat({chatId:input.chatId,projectId:input.projectId ?? null,title:input.title || input.text,model:input.model});
            await chatStore.markRuntimeBinding(input.chatId,bindings.get(key).sessionId,workspace);
          }
        }
        await execution.configure(key,bindings.get(key),executionMode);
        await host.configureReasoning({sessionId:bindings.get(key).sessionId,reasoningEffort});
        response.writeHead(200,{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'});
        const emit = event => { if (!response.destroyed) response.write(JSON.stringify(event)+'\n'); };
        if (!input.temporary) await chatStore.appendMessage({chatId:input.chatId,id:input.userMessageId,role:'user',text:input.text});
        let finalEvent;let receipts=Promise.resolve();const toolNames=new Map();
        const onEvent = event => {
          if(event.type==='tool-call')toolNames.set(event.callId,event.name);
          if(!input.temporary&&(event.type==='tool-call'||event.type==='tool-result')){
            const text=event.type==='tool-call'?`工具调用：${event.name}`:`工具${event.isError?'失败':'完成'}：${toolNames.get(event.callId)||'调用'}`;
            receipts=receipts.then(()=>chatStore.appendMessage({chatId:input.chatId,id:'tool-'+randomUUID(),role:'system',text}));
          }
          if (event.type === 'completed') finalEvent = event; else emit(event);
        };
        emit({type:'accepted',chatId:input.chatId});
        const contextPrefix = currentProject ? `[ScienceScope ${input.temporary?'temporary ':''}project context]\nProject: ${currentProject.name}\nResearch goal: ${currentProject.desc || ''}\nProject ID: ${currentProject.id}\nProject directory: ${projectFolder}\nSession working directory: ${input.temporary?path.join(dataRoot,'.sciencescope-local','temp','quick',input.chatId):chatStore.getRuntimeWorkspace(input.chatId)}\n${input.temporary?'This is a separate temporary question, not the Main conversation.':''}\n\n` : '';
        if(executionMode==='auto'){
          const goal=await execution.start(key,bindings.get(key),contextPrefix+input.text,input.goalMaxRounds);
          emit({type:'goal-started',goal});emit({type:'completed',text:'',background:true});response.end();return true;
        }
        try {
          await host.send({sessionId:bindings.get(key).sessionId,text:contextPrefix + input.text,onEvent});
          await receipts;
        } catch (error) {
          await receipts;
          if (!input.temporary) await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:'请求失败，未生成完整回答。'});
          throw error;
        }
        if (!input.temporary && finalEvent && typeof finalEvent.text === 'string') await chatStore.appendMessage({chatId:input.chatId,id:input.assistantMessageId,role:'assistant',text:finalEvent.text});
        if (finalEvent) emit(finalEvent);
        response.end();
      } finally {
        if(bindings.has(key))bindings.get(key).lastUsed=Date.now();
        pending.delete(key);
        await trimIdleSessions();
      }
    } catch (error) {
      onError?.(error);
      if (error instanceof WorkbenchApiError) { json(response,error.status,{message:error.message}); return true; }
      // Raw runtime errors can contain credentials or provider payloads.
      const message = publicRuntimeMessage(error);
      if (response.headersSent) response.end(JSON.stringify({type:'failed',message})+'\n');
      else json(response,500,{message});
    }
    return true;
  }
  return {handle,close:async()=>{await Promise.allSettled([host?.close(),web?.close()]);await execution?.close();await chatStore.queue;await profileStore.queue;chatStore.close?.();profileStore.close?.();}};
}
