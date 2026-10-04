import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {memoryFixture,writeMemoryFixture} from '../scripts/evals/memory-eval-fixture.mjs';
import {normalizeValue,parseAnswer,judgeAnswer,auditCitationPointers,seedSources,clonePreparedDatabase,sourceIdentity,decideRunProposals,runMemoryQuestion,memoryOutcome} from '../scripts/evals/memory-eval-core.mjs';
import {parseMemoryArgs,runConsolidationStage,summarizeMemoryLedger} from '../scripts/evals/memory-eval.mjs';
import {createLiveHost} from '../scripts/evals/hybrid-live-retrieval.mjs';

async function temp(t,{retain=false}={}){const base=path.resolve('.sciencescope-local/temp/t09-validation/tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'memory-eval-'));if(!retain)t.after(()=>rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100}));return root;}
const fixture=memoryFixture();
const answer=row=>JSON.stringify({status:row.expectedStatus,values:row.expectedValues,citations:row.evidence});
test('memory fixture is reproducible, balanced and contains exact independent source evidence',async t=>{
  const root=await temp(t);const first=await writeMemoryFixture(root);const corpus=await readFile(path.join(root,'corpus.json'));
  const second=await writeMemoryFixture(root);assert.deepEqual(first,second);assert.deepEqual(await readFile(path.join(root,'corpus.json')),corpus);
  for(const category of ['single','update','temporal','cross_session','unanswerable'])assert.equal(fixture.questions.questions.filter(row=>row.category===category).length,6);
  assert.ok(fixture.questions.questions.every(row=>!Object.hasOwn(row,'expectedValues')));
  for(const row of fixture.gold.questions)for(const ref of row.evidence)assert.ok(fixture.corpus.projects.flatMap(p=>p.chats).find(chat=>chat.id===ref.chatId).messages[ref.messageNumbers[0]-1].text===ref.quote);
});
test('rule judge matches whole literal values with only approved case whitespace and date normalization',()=>{
  for(const row of fixture.gold.questions)assert.equal(judgeAnswer(answer(row),row).correct,true);
  assert.equal(normalizeValue('  PAR QUET '),'parquet');assert.equal(normalizeValue('2026年11月14日'),'2026-11-14');
  assert.notEqual(normalizeValue('0.920'),normalizeValue('0.92'));
  const current=fixture.gold.questions.find(row=>row.questionId==='cedar-update'),historical=fixture.gold.questions.find(row=>row.questionId==='cedar-temporal');
  assert.equal(judgeAnswer(JSON.stringify({status:'answered',values:['CSV'],citations:[]}),current).correct,false);
  assert.equal(judgeAnswer(JSON.stringify({status:'answered',values:['Parquet'],citations:[]}),historical).correct,false);
  assert.equal(judgeAnswer(JSON.stringify({status:'answered',values:['The current value is Parquet'],citations:[]}),current).correct,false);
  assert.equal(judgeAnswer(JSON.stringify({status:'answered',values:['Parquet','unsupported'],citations:[]}),current).correct,false);
  assert.equal(judgeAnswer(JSON.stringify({status:'answered',values:['invented-ID'],citations:[]}),fixture.gold.questions.find(row=>row.category==='unanswerable')).correct,false);
  assert.equal(parseAnswer('{"status":"answered","values":[],"citations":[],"prose":"extra"}').valid,false);
});
test('located citation quotes remain source-audit pending and cross-project pointers are rejected',()=>{
  const row=fixture.gold.questions[0];const audit=auditCitationPointers(JSON.parse(answer(row)),fixture.corpus,row);
  assert.equal(audit.locatedCount,1);assert.equal(audit.sourceAuditStatus,'PENDING');
  const other=fixture.gold.questions.find(gold=>gold.questionId==='tide-single');
  assert.equal(auditCitationPointers(JSON.parse(answer(other)),fixture.corpus,row).unresolvedCount,1);
});
test('fixture-only acceptance uses the exact run proposal IDs and keeps invalid proposals',async()=>{
  const calls=[];const results=await decideRunProposals(async(route,body)=>{calls.push({route,body});if(body.id==='invalid')throw Object.assign(new Error('invalid'),{code:'INVALID'});return {accepted:true};},{runId:'run1',proposalIds:['valid','invalid']});
  assert.deepEqual(calls.map(call=>call.body.id),['valid','invalid']);assert.deepEqual(results.map(row=>row.status),['accepted','failed']);
  assert.throws(()=>parseMemoryArgs(['--live']),/authorization/u);
  assert.equal(parseMemoryArgs(['--upstream-proxy','http://127.0.0.1:10808']).upstreamProxy,'http://127.0.0.1:10808');
  assert.throws(()=>parseMemoryArgs(['--upstream-proxy','http://public.example:10808']),/loopback/u);
});
test('both arms retain identical public source tables including old minutes revisions',async t=>{
  const root=await temp(t),left=path.join(root,'left'),right=path.join(root,'right');
  const original=await seedSources(left,fixture.corpus);await clonePreparedDatabase(left,right);assert.deepEqual(await sourceIdentity(right),original);
  assert.deepEqual(original.counts,{projects:6,chats:12,messages:60,minutes:18});
  const staged=path.join(root,'staged');for(const project of fixture.corpus.projects)for(const stage of project.consolidationStages)await seedSources(staged,fixture.corpus,{stage});
  assert.deepEqual(await sourceIdentity(staged),original,'incremental stage fixture equals the baseline final public history');
  assert.deepEqual(await seedSources(staged,fixture.corpus),original,'repeated import is idempotent');
});
test('zero-request session initialization failure is infrastructure rather than incorrect memory',()=>{
  assert.equal(memoryOutcome({status:'FAILED',runtimeError:{operation:'startSession',name:'TransportClosedError'},answer:'',terminal:'failed'},[]),'infrastructure');
  assert.equal(memoryOutcome({status:'FAILED',answer:'',terminal:'failed'},[]),'empty_response');
});
test('memory report keeps transport accounting, retrieval exposure and source support distinct',()=>{
  const active={id:'q',category:'single',outcome:'completed',grade:{correct:true,coreGrade:'full'},retrievalHitReceipts:[{hits:[{ref:{type:'item',id:'i'}}]},{hits:[]}]};
  const report=summarizeMemoryLedger({arm:'consolidated',round:1,status:'FINISHED',selectedQuestionIds:['q'],consolidation:[],questions:[{active,requests:{events:[{routeKind:'completion',forwarded:true,sequence:1,questionId:'q',isRetry:false,usage:{total_tokens:10}},{routeKind:'completion',forwarded:true,sequence:2,questionId:'q',isRetry:true},{routeKind:'other',forwarded:true,sequence:3}]}}]});
  assert.equal(report.physicalRequests,2);assert.equal(report.retries,1);assert.equal(report.knownUsage.total_tokens,10);assert.equal(report.unknownUsageRequests.length,1);
  assert.equal(report.retrievalCallCount,2);assert.equal(report.retrievalNonemptyCalls,1);assert.equal(report.retrievalHitCount,1);assert.equal(report.expectedSupportedRetrievalHitCount,null);assert.equal(report.sourceAuditStatus,'PENDING');
  const pending=summarizeMemoryLedger({arm:'baseline',round:1,status:'STOPPED',selectedQuestionIds:['q','missing'],consolidation:[],questions:[]});assert.equal(pending.accuracy,null);assert.equal(pending.pendingQuestions,2);
});
test('shared evaluation host defaults reject workspace lookup; explicit memory lookup allowance preserves application IDs',async t=>{
  const root=await temp(t);
  for(const expanded of [false,true]){
    let handler,observer;const active={id:'question',chatId:'source',sessions:[],prohibitedTools:[],providerFailures:[],toolSequence:[],toolCalls:[],researchModes:[]};
    const registrations=[];
    const host=await createLiveHost({paths:{dataRoot:root,projects:root,home:root},proxy:{port:1,registerSession:(id,owner)=>registrations.push({id,owner}),sealQuestion(){}},activeRef:{current:active,persist:async()=>{},stopQuestion:async()=>{}},credential:'local-only',dshFactory:async()=>({startSession:async options=>options.sessionId,observeSession:(_id,callback)=>{observer=callback;},setToolHandler:callback=>{handler=callback;},close:async()=>{}}),...(expanded?{allowedTools:['workspace_overview'],sessionKind:()=> 'main'}:{})});
    host.setToolHandler(async()=>({projects:[]}));await host.startSession({sessionId:'session-app-bound',workspace:path.join(root,'workspace')});
    assert.equal(registrations[0].id,'session-app-bound');observer({type:'tool-call',name:'workspace_overview'});
    const call=()=>handler({sessionId:'session-app-bound',name:'workspace_overview',args:{},callId:'c'});
    if(expanded){assert.deepEqual(await call(),{projects:[]});assert.equal(active.prohibitedTools.length,0);}
    else{await assert.rejects(call(),/only allows/u);assert.equal(active.prohibitedTools.length,2);}
    await host.close();
  }
});
test('real DSH global manifest and T17 source lookup answer through the production Assistant API',async t=>{
  const root=await temp(t),app=path.join(root,'app');await seedSources(app,fixture.corpus);
  const payloads=[];
  const provider=createServer(async(request,response)=>{
    let raw='';for await(const part of request)raw+=part;const payload=JSON.parse(raw);payloads.push(payload);
    response.writeHead(200,{'content-type':'text/event-stream'});
    const tools=payload.messages.filter(row=>row.role==='tool');
    if(tools.length<2){const name=tools.length===0?'workspace_overview':'chat_recall';const args=tools.length===0?{}:{chatId:'t09-cedar-planning',projectId:'t09-cedar',from:1,to:1};
      response.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:`call-${tools.length}`,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]})}\n\n`);
      response.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
    }else response.write(`data: ${JSON.stringify({choices:[{delta:{content:answer(fixture.gold.questions[0])},finish_reason:'stop'}]})}\n\n`);
    response.end('data: [DONE]\n\n');
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));});
  const result=await runMemoryQuestion({dataRoot:app,evidenceRoot:path.join(root,'evidence'),question:fixture.questions.questions[0],gold:fixture.gold.questions[0],corpus:fixture.corpus,credential:'fake-parent-key',upstreamOrigin:`http://127.0.0.1:${provider.address().port}`,allowTestLoopbackUpstream:true});
  assert.equal(result.active.terminal,'completed');assert.equal(result.active.grade.correct,true);assert.equal(result.active.outcome,'completed');
  assert.equal(result.requests.forwardedCompletions,3);assert.equal(result.requests.effectiveModelSteps,3);assert.equal(result.requests.retryAttempts,0);
  assert.ok(payloads[0].tools.some(tool=>tool.function.name==='workspace_overview'));
  assert.ok(payloads[0].tools.find(tool=>tool.function.name==='chat_recall').function.parameters.properties.chatId);
  assert.ok(result.active.lookupReceipts.some(row=>row.name==='chat_recall'&&row.result.messages.includes('湖泊藻类')));
  assert.equal(result.active.briefHitCount,0);assert.ok(payloads.every(row=>(row.max_completion_tokens??row.max_tokens)===4096),JSON.stringify(payloads.map(row=>({max_tokens:row.max_tokens,max_completion_tokens:row.max_completion_tokens}))));
});
test('real backend consolidation stages keep old history, propose and confirm only their own run',async t=>{
  const root=await temp(t,{retain:true}),app=path.join(root,'app'),project=fixture.corpus.projects[0];
  const providerCalls=[];t.diagnostic(`stage fixture retained: ${root}`);
  const provider=createServer(async(request,response)=>{
    try {
    let raw='';for await(const part of request)raw+=part;const payload=JSON.parse(raw);providerCalls.push(payload);
    const prompt=payload.messages.find(row=>typeof row.content==='string'&&(row.content.startsWith('Extract research memory')||row.content.startsWith('Compare each proposed')))?.content??'';
    let value;
    if(prompt.includes('Extract research memory candidates')){
      const revised=prompt.includes('cedar-u3');
      value={candidates:[{type:'memory',subtype:'decision',title:'保存格式',body:revised?'保存格式采用Parquet。':'保存格式采用CSV。',payload:{},evidence:[{messageId:revised?'cedar-u3':'cedar-u2',quote:revised?project.chats[0].messages[4].text:project.chats[0].messages[2].text}]}]};
    }else{
      const comparisons=JSON.parse(prompt.slice(prompt.indexOf('Comparisons:')+'Comparisons:'.length));
      const existing=comparisons[0].items[0];value={decisions:[{candidateIndex:0,op:existing?'supersede':'create',targetId:existing?.id??null,rationale:'Explicit source decision'}]};
    }
    response.writeHead(200,{'content-type':'text/event-stream'});response.end(`data: ${JSON.stringify({choices:[{delta:{content:JSON.stringify(value)},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);
    } catch(error) {t.diagnostic(`scripted provider error: ${error.message}`);response.writeHead(400,{'content-type':'application/json'});response.end('{"error":"invalid fixture handler"}');}
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(async()=>{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));});
  for(const stage of project.consolidationStages.slice(0,2)){
    await seedSources(app,fixture.corpus,{stage});
    const result=await runConsolidationStage({dataRoot:app,evidenceRoot:path.join(root,stage.id),stage,credential:'fake-parent-key',upstreamOrigin:`http://127.0.0.1:${provider.address().port}`,allowTestLoopbackUpstream:true});
    assert.equal(result.active.consolidation?.state,'completed',JSON.stringify(result.active));
    assert.equal(result.active.consolidation.proposalIds.length,1);assert.equal(result.active.decisions[0].status,'accepted');
    assert.equal(result.requests.effectiveModelSteps,2);assert.equal(result.requests.forwardedCompletions,2);
  }
  assert.deepEqual(providerCalls.map(row=>row.max_completion_tokens??row.max_tokens),[32768,32768,32768,32768],'unknown model capacity uses the runtime default, without the former consolidation output cap');
  const db=(await import('../scripts/application-database.mjs')).openApplicationDatabaseSync({stateDir:path.join(app,'.sciencescope-local/state')});
  try{
    const items=db.db.prepare('SELECT body,status FROM rb_items ORDER BY created_at').all();assert.equal(items.length,2);
    assert.ok(items.some(item=>item.body.includes('CSV')&&item.status==='superseded'));assert.ok(items.some(item=>item.body.includes('Parquet')&&item.status==='active'));
    assert.equal(db.db.prepare("SELECT text FROM messages WHERE id='cedar-u2'").get().text,project.chats[0].messages[2].text);
  }finally{db.close();}
});
