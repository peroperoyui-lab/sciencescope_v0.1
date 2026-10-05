// Offline judge draft; never exported to the model as answers or hints.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir, readFile, writeFile, cp} from 'node:fs/promises';
import path from 'node:path';
import {openApplicationDatabaseSync} from '../application-database.mjs';
import {createChatStore} from '../chat-store.mjs';
import {createChatMinutes} from '../chat-minutes.mjs';
import {createSecretaryPreferences} from '../secretary-preferences.mjs';
import {createDesktopApi} from '../desktop-api.mjs';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';
import {createCappedProxy, createLiveHost,renameSnapshotSync} from './hybrid-live-retrieval.mjs';
import {classifyQuestion, terminalRequestEvidence} from './multi-run-report.mjs';
export const MEMORY_MODEL=Object.freeze({providerId:'t10-retrieval-counted',modelId:'deepseek-v4.1-flash'});
export const ANSWER_PREFIX='这是虚构项目的记忆问答评测。只能使用公开的只读上下文/研究查阅工具核实已有记录。返回一个JSON对象且仅含status、values、citations；status为answered或insufficient_evidence；values为完整短事实字符串数组（一个字段一个值，不附说明）；citations为{chatId,messageNumbers,quote}或{itemHandle,quote}数组。引用原文，不猜测未记录信息。不确定就拒答并留空values。不要为读完整来源而机械续读。';
export const MEMORY_LIMITS=Object.freeze({answerSteps:6,stageSteps:2,questionDeadlineMs:180000,answerOutputTokens:4096,rounds:3});
export const sha=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');
export async function saveJson(file,value){
  await mkdir(path.dirname(file),{recursive:true});const snapshot=`${file}.${process.pid}.${randomUUID()}.next`;
  await writeFile(snapshot,JSON.stringify(value,null,2)+'\n');renameSnapshotSync(snapshot,file);
}
export function ownedPath(root){
  const base=path.resolve('.sciencescope-local/temp/t09-validation');
  const resolved=path.resolve(root),relative=path.relative(base,resolved);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'evaluation root must be a child of owned T09 temp');return resolved;
}

/** Isolated fixture import only. Existing public stores seed chats/messages;
 * covered minutes revisions need direct fixture import since user edits retain old coverage. */
export async function seedSources(dataRoot,corpus,{stage=null}={}){
  ownedPath(dataRoot);const stateDir=path.join(dataRoot,'.sciencescope-local/state');await mkdir(stateDir,{recursive:true});
  const store=await createChatStore({stateDir});const database=store.db;
  const preferences=createSecretaryPreferences({db:database.db});
  const minutes=createChatMinutes({db:database.db,chatStore:store,host:null,getPreferences:()=>preferences.get()});
  try{
    await store.updateWorkspace({version:1,projects:corpus.projects.map(({id,name,description})=>({id,name,desc:description})),pins:[],projectExpanded:{},lastChatId:null});
    preferences.save({summary:{afterDiscussion:false,everyMessages:{enabled:false,n:20},everyTokens:{enabled:false,n:30000},onEnterProject:false,onLeaveProject:false,saveMarkdown:false,workbench:{map:'off',versions:'off',plans:'off',log:'off'}}});
    for(const project of corpus.projects)for(const chat of project.chats){
      if(stage&&chat.id!==stage.chatId)continue;
      await store.ensureChat({chatId:chat.id,projectId:project.id,title:chat.title,model:MEMORY_MODEL});
      for(const message of chat.messages.slice(0,stage?.throughMessage??chat.messages.length))await store.appendMessage({...message,chatId:chat.id});
      for(const revision of chat.minutes.filter(row=>row.revision<=(stage?.minutesRevision??Infinity))){
        database.db.prepare('INSERT OR IGNORE INTO chat_minutes(chat_id,revision,text,through_ordinal,author,updated_at) VALUES(?,?,?,?,?,?)').run(chat.id,revision.revision,revision.text,revision.throughOrdinal,revision.author,'2026-10-04T10:00:00.000Z');
      }
    }
    await store.queue;database.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }finally{await minutes.close();store.close();}
  return sourceIdentity(dataRoot);
}
export async function sourceIdentity(dataRoot){
  const database=openApplicationDatabaseSync({stateDir:path.join(dataRoot,'.sciencescope-local/state')});
  try{
    const source={projects:database.db.prepare('SELECT id,name,description FROM projects ORDER BY id').all(),
      chats:database.db.prepare("SELECT id,project_id,title FROM chats WHERE id LIKE 't09-%' ORDER BY id").all(),
      messages:database.db.prepare("SELECT chat_id,ordinal,id,role,text,created,completion_status FROM messages WHERE chat_id LIKE 't09-%' ORDER BY chat_id,ordinal").all(),
      minutes:database.db.prepare("SELECT chat_id,revision,text,through_ordinal,author FROM chat_minutes WHERE chat_id LIKE 't09-%' ORDER BY chat_id,revision").all()};
    return {sha256:sha(source),counts:{projects:source.projects.length,chats:source.chats.length,messages:source.messages.length,minutes:source.minutes.length}};
  }finally{database.close();}
}
export async function clonePreparedDatabase(from,to){
  ownedPath(to);const target=path.join(to,'.sciencescope-local/state');await mkdir(target,{recursive:true});
  await cp(path.join(from,'.sciencescope-local/state/sciencescope.sqlite'),path.join(target,'sciencescope.sqlite'),{errorOnExist:true,force:false});
}
export async function decideRunProposals(call,run){
  assert.ok(typeof run.runId==='string'&&Array.isArray(run.proposalIds),'consolidation must provide run-scoped proposalIds');
  const decisions=[];
  for(const id of run.proposalIds){
    // No gold-based filtering. Invalid proposals and conflicts are retained as failures.
    try{decisions.push({id,status:'accepted',result:await call('/api/research/proposals/decide',{id,accept:true})});}
    catch(error){decisions.push({id,status:'failed',error:{code:error.code??null,status:error.status??null}});}
  }
  return decisions;
}

export async function createMemoryHarness({dataRoot,evidenceRoot,id,stage=false,credential,upstreamOrigin,upstreamProxy,allowTestLoopbackUpstream=false,dshFactory=createDshHost}){
  ownedPath(dataRoot);ownedPath(evidenceRoot);await mkdir(evidenceRoot,{recursive:true});
  const active={id,chatId:id,prohibitedTools:[],providerFailures:[],hostErrors:[],sessions:[],toolSequence:[],toolCalls:[],researchModes:[],lookupReceipts:[],status:'RUNNING'};
  let origin,api,server,host,stopped=false;
  const proxy=await createCappedProxy({evidencePath:path.join(evidenceRoot,'request-ledger.json'),maxCompletionRequests:stage?2:6,maxPerQuestion:stage?2:6,upstreamCredential:credential, ...(upstreamProxy?{upstreamProxy}:{}), ...(upstreamOrigin?{upstreamOrigin,allowTestLoopbackUpstream}: {})});
  const activeRef={current:active,persist:()=>saveJson(path.join(evidenceRoot,'active.json'),active),shuttingDown:false,
    stopQuestion:async reason=>{if(stopped)return;stopped=true;active.stopReason=reason;proxy.sealQuestion(id,reason);await activeRef.persist();
      if(origin&&!stage)await call('/api/assistant/stop',{scope:'global',ownerId:'global'}).catch(()=>{});
      await Promise.allSettled(active.sessions.map(session=>host.releaseSession(session.sessionId)));}};
  const instrumentedFactory=async options=>{
    const dsh=await dshFactory(options);
    const original=dsh.setToolHandler;
    const originalSend=dsh.send,originalStart=dsh.startSession;
    const failure=(error,operation)=>{active.runtimeError={operation,name:error.name,code:error.code??null};throw error;};
    return Object.assign(Object.create(null),dsh,{startSession:async options=>{try{return await originalStart(options);}catch(error){return failure(error,'startSession');}},send:async options=>{try{return await originalSend(options);}catch(error){return failure(error,'send');}},setToolHandler(handler){return original(async invocation=>{
      const result=await handler(invocation);
      if(invocation.name!=='__manifest')active.lookupReceipts.push({name:invocation.name,args:invocation.args,result});
      return result;
    });}});
  };
  const paths={dataRoot,projects:path.join(dataRoot,'.sciencescope-local/projects'),home:path.join(dataRoot,'.sciencescope-local/dsh')};
  await mkdir(paths.projects,{recursive:true});
  host=await createLiveHost({paths,proxy,activeRef,credential:`local-memory-${randomUUID()}`,dshFactory:instrumentedFactory,
    allowedTools:['research_search','research_read','project_memory','chat_recall','workspace_overview']});
  const underlyingStart=host.startSession;
  host.startSession=async options=>{
    const workspace=options.workspace??path.join(paths.projects,'independent',id);await mkdir(workspace,{recursive:true});
    return underlyingStart({...options,workspace,...(!stage?{maxTokens:MEMORY_LIMITS.answerOutputTokens}:{})});
  };
  api=await createDesktopApi({dataRoot,runtimeHost:host,onError:error=>active.hostErrors.push({code:error.code??null,name:error.name})});
  server=createServer((request,response)=>{void api.handle(request,response);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  async function call(route,body,{timeoutMs=190000}={}){
    const response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)});
    const raw=await response.text();let values;try{values=raw.trim()?raw.trim().split('\n').map(line=>JSON.parse(line)):[];}catch{throw Object.assign(new Error('invalid local JSON'),{code:'INVALID_LOCAL_JSON'});}
    if(!response.ok)throw Object.assign(new Error('local API rejected request'),{status:response.status,code:values[0]?.code??null});
    return values.length===1&&!values[0].type?values[0]:values;
  }
  async function close(){
    proxy.sealQuestion(id,active.stopReason??'finished');active.requestCount=structuredClone(proxy.state.questions[id]??{});
    const shutdown=await Promise.allSettled([api.close()]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await proxy.close();
    active.cleanup={appClosed:shutdown[0].status==='fulfilled',proxyClosed:true};await activeRef.persist();
    return {active,requests:structuredClone(proxy.state)};
  }
  return {active,proxy,host,call,close,stop:activeRef.stopQuestion};
}
export async function runMemoryQuestion({question,gold,corpus,...options}){
  const harness=await createMemoryHarness({...options,id:question.id});
  harness.active.category=question.category;
  const timer=setTimeout(()=>void harness.stop('QUESTION_DEADLINE_180S'),MEMORY_LIMITS.questionDeadlineMs);
  try{
    const events=await harness.call('/api/assistant/chat',{scope:'global',ownerId:'global',model:MEMORY_MODEL,text:`${ANSWER_PREFIX}\n${question.prompt}`,executionMode:'ask'});
    const terminal=events.findLast(event=>['completed','cancelled','failed'].includes(event.type));
    Object.assign(harness.active,{terminal:terminal?.type??'NO_TERMINAL_EVENT',answer:terminal?.text??'',status:terminal?.type==='completed'?'COMPLETED_AUDIT_PENDING':'FAILED'});
    harness.active.grade=judgeAnswer(harness.active.answer,gold);
    harness.active.citationAudit=harness.active.grade.parsed?auditCitationPointers(harness.active.grade.parsed,corpus,gold):null;
    harness.active.briefHitCount=0; // Global production path has no RB brief injection; raw system receipt retained.
    harness.active.retrievalHitReceipts=harness.active.lookupReceipts.filter(row=>row.name==='research_search').map(row=>({args:row.args,hits:row.result?.hits??[],mode:row.result?.mode??null}));
    harness.active.contextLookupReceipts=harness.active.lookupReceipts.filter(row=>['chat_recall','project_memory','workspace_overview'].includes(row.name));
  }catch(error){harness.active.status='FAILED';harness.active.runnerError={code:error.code??null,name:error.name};await harness.stop('RUNNER_FAILURE');}
  finally{clearTimeout(timer);}
  const result=await harness.close();
  result.active.outcome=memoryOutcome(result.active,result.requests.events.filter(row=>row.questionId===question.id));
  result.active.terminalRequestEvidence=terminalRequestEvidence(result.requests.events);
  await saveJson(path.join(options.evidenceRoot,'result.json'),result);return result;
}
export function memoryOutcome(row,events=[]){
  if(row.runtimeError?.operation==='startSession')return 'infrastructure';
  return classifyQuestion(row,events);
}
const own=(object,key)=>Object.hasOwn(object,key);
export function normalizeValue(value){
  if(typeof value!=='string')return null;
  let text=value.trim().replace(/\s+/gu,'').toLocaleLowerCase('en-US');
  const date=/^(\d{4})年(\d{1,2})月(\d{1,2})日$/u.exec(text)??/^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(text);
  if(date){
    const year=Number(date[1]),month=Number(date[2]),day=Number(date[3]);
    const instant=new Date(Date.UTC(year,month-1,day));
    if(instant.getUTCFullYear()===year&&instant.getUTCMonth()===month-1&&instant.getUTCDate()===day)text=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;
  }
  return text;
}
export function parseAnswer(text){
  if(typeof text!=='string')return {valid:false,reason:'not-string'};
  const raw=text.trim();
  // A whole JSON fence is display syntax; no surrounding prose is repaired.
  const match=/^```(?:json)?\s*\n([\s\S]*?)\n```$/iu.exec(raw);
  let value;try{value=JSON.parse(match?.[1]??raw);}catch{return {valid:false,reason:'invalid-json'};}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['status','values','citations'].includes(key))
    ||!['answered','insufficient_evidence'].includes(value.status)||!Array.isArray(value.values)||value.values.some(item=>typeof item!=='string'||!item.trim())
    ||!Array.isArray(value.citations))return {valid:false,reason:'invalid-answer-schema'};
  for(const citation of value.citations){
    if(!citation||typeof citation!=='object'||Array.isArray(citation)||Object.keys(citation).some(key=>!['chatId','messageNumbers','itemHandle','quote'].includes(key))
      ||typeof citation.quote!=='string'||!citation.quote.trim()
      ||(!citation.itemHandle&&(typeof citation.chatId!=='string'||!Array.isArray(citation.messageNumbers)||!citation.messageNumbers.length))
      ||(own(citation,'messageNumbers')&&(!Array.isArray(citation.messageNumbers)||citation.messageNumbers.some(n=>!Number.isSafeInteger(n)||n<1)))
      ||(own(citation,'itemHandle')&&(typeof citation.itemHandle!=='string'||!/^\[?@[0-9a-f]{6,20}\]?$/u.test(citation.itemHandle))))return {valid:false,reason:'invalid-citation-schema'};
  }
  return {valid:true,value};
}
export function judgeAnswer(text,gold){
  const parsed=parseAnswer(text);
  if(!parsed.valid)return {coreGrade:'format_fail',correct:false,reason:parsed.reason,parsed:null};
  const answer=parsed.value;
  const actual=answer.values.map(normalizeValue);
  const remaining=[...actual];
  const missing=[];
  for(const expected of gold.expectedValues){
    const accepted=[expected,...(gold.aliases?.[expected]??[])].map(normalizeValue);
    const index=remaining.findIndex(value=>accepted.includes(value));
    if(index<0)missing.push(expected);else remaining.splice(index,1);
  }
  const statusCorrect=answer.status===gold.expectedStatus;
  const correct=statusCorrect&&missing.length===0&&remaining.length===0;
  return {coreGrade:correct?(gold.category==='unanswerable'?'correct_refusal':'full'):'wrong',correct,statusCorrect,missingValues:missing,extraValues:remaining,parsed:answer};
}
export function auditCitationPointers(answer,corpus,gold){
  const chats=new Map(corpus.projects.flatMap(project=>project.chats.map(chat=>[chat.id,{...chat,projectId:project.id}])));
  const rows=answer.citations.map(citation=>{
    if(citation.itemHandle)return {...citation,status:'item-lineage-review-required',sourceSupport:'unverified'};
    const chat=chats.get(citation.chatId);
    const numbers=citation.messageNumbers??[];
    const messages=numbers.map(n=>chat?.messages[n-1]);
    const quoteLocated=messages.some(message=>message?.text.includes(citation.quote));
    const expectedPointer=gold.evidence.some(ref=>ref.chatId===citation.chatId&&ref.messageNumbers.some(n=>numbers.includes(n)));
    const inScope=chat?.projectId===gold.sourceScope.projectId;
    return {...citation,inScope,quoteLocated,expectedPointer,status:inScope&&quoteLocated?'located':'unresolved',sourceSupport:'requires-source-audit'};
  });
  return {rows,locatedCount:rows.filter(row=>row.status==='located').length,
    unresolvedCount:rows.filter(row=>row.status==='unresolved').length,
    expectedEvidencePointersCovered:gold.evidence.filter(ref=>rows.some(row=>row.status==='located'&&row.chatId===ref.chatId&&ref.messageNumbers.some(n=>row.messageNumbers.includes(n)))).length,
    sourceAuditStatus:'PENDING',note:'A located quote or gold message pointer is not itself proof that all answer claims are supported.'};
}
