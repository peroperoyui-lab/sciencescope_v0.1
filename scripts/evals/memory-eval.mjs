// T09 controlled global project-memory Q&A. Default is offline preparation.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {memoryFixture,writeMemoryFixture} from './memory-eval-fixture.mjs';
import {validateUpstreamProxy} from './hybrid-live-retrieval.mjs';
import {ANSWER_PREFIX,MEMORY_LIMITS,MEMORY_MODEL,sha,saveJson,seedSources,sourceIdentity,clonePreparedDatabase,createMemoryHarness,runMemoryQuestion,decideRunProposals,ownedPath} from './memory-eval-core.mjs';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.join(repo,'.sciencescope-local/temp/t09-validation');
const receiptFiles=['scripts/evals/memory-eval.mjs','scripts/evals/memory-eval-core.mjs','scripts/evals/memory-eval-fixture.mjs','scripts/evals/hybrid-live-retrieval.mjs','scripts/research-base/consolidate.mjs','scripts/context/tools.mjs','scripts/context/policy.mjs','scripts/context/research-tools.mjs','scripts/assistant-chat-service.mjs','scripts/desktop-api.mjs','adapters/runtime-dsh/host.mjs','adapters/runtime-dsh/session-control.mjs'];
export function parseMemoryArgs(argv){
  const args={mode:'preflight',round:1,arm:'baseline',runName:'memory-preflight'};
  for(let i=0;i<argv.length;i++){
    const name=argv[i];
    if(name==='--preflight')args.mode='preflight';
    else if(name==='--live')args.mode='live';
    else if(name==='--authorized-live')args.authorized=true;
    else if(name==='--freeze')args.freeze=path.resolve(argv[++i]);
    else if(name==='--arm')args.arm=argv[++i];
    else if(name==='--round')args.round=Number(argv[++i]);
    else if(name==='--run-name')args.runName=argv[++i];
    else if(name==='--questions')args.questions=argv[++i]?.split(',');
    else if(name==='--upstream-proxy')args.upstreamProxy=validateUpstreamProxy(argv[++i]);
    else throw new Error(`Unknown option ${name}`);
  }
  assert.ok(['baseline','consolidated'].includes(args.arm));assert.ok(Number.isSafeInteger(args.round)&&args.round>=1&&args.round<=3);
  assert.match(args.runName,/^[a-zA-Z0-9_-]{1,64}$/u);
  if(args.mode==='live')assert.ok(args.authorized&&args.freeze,'live requires explicit authorization and a frozen receipt');
  return args;
}
export async function memoryIdentity({upstreamProxy=null}={}){
  const fixture=memoryFixture();const rulesReceipt=Object.fromEntries(await Promise.all(receiptFiles.map(async file=>[file,sha(await readFile(path.join(repo,file)))])));
  return {schema:1,model:MEMORY_MODEL,limits:MEMORY_LIMITS,transport:{upstreamProxy:upstreamProxy?validateUpstreamProxy(upstreamProxy):null,tlsVerification:true},promptSha256:sha(ANSWER_PREFIX),corpusSha256:sha(JSON.stringify(fixture.corpus,null,2)+'\n'),questionsSha256:sha(JSON.stringify(fixture.questions,null,2)+'\n'),goldSha256:sha(JSON.stringify(fixture.gold,null,2)+'\n'),rulesReceipt};
}
export async function prepareMemoryEvaluation({runName='memory-preflight'}={}){
  await mkdir(base,{recursive:true});await writeMemoryFixture(path.join(base,'fixture'));
  const run=await mkdtemp(path.join(base,runName+'-'));const fixture=memoryFixture();
  const baseline=path.join(run,'baseline'),comparison=path.join(run,'comparison');
  const first=await seedSources(baseline,fixture.corpus);await clonePreparedDatabase(baseline,comparison);const second=await sourceIdentity(comparison);
  assert.deepEqual(second,first,'both arms must expose byte-equivalent source tables');
  const identity=await memoryIdentity();const result={status:'OFFLINE_PREFLIGHT_COMPLETE',runRoot:run,identity,sourceIdentity:first,questions:30,paidRequests:0,
    scope:'global project-memory Q&A',briefLimit:'Global receives no production Research Base brief; expected hit count 0; next Main brief tested separately.',
    pending:['local real DSH manifest/tool/JSON smoke','primary fixture and source review','freeze receipt before live']};
  await saveJson(path.join(run,'preflight.json'),result);return result;
}
export async function runConsolidationStage({dataRoot,evidenceRoot,stage,...options}){
  const harness=await createMemoryHarness({dataRoot,evidenceRoot,id:stage.id,stage:true,...options});
  let run,decisions=[];
  try{
    await harness.call('/api/research/consolidate/settings',{enabled:false,model:MEMORY_MODEL});
    run=await harness.call('/api/research/consolidate',{chatId:stage.chatId});
    if(run.state==='completed')decisions=await decideRunProposals(harness.call,run);
    else if(run.state!=='skipped')harness.active.status='FAILED';
    if(harness.active.status!=='FAILED')harness.active.status='COMPLETED';
    harness.active.consolidation=run;harness.active.decisions=decisions;
  }catch(error){harness.active.status='FAILED';harness.active.runnerError={code:error.code??null,name:error.name};
    harness.active.consolidation=await harness.call(`/api/research/consolidate/status?chatId=${encodeURIComponent(stage.chatId)}`).catch(()=>null);}
  const receipt=await harness.close();await saveJson(path.join(evidenceRoot,'stage-result.json'),receipt);return receipt;
}
export async function runMemoryEvaluation(args){
  const frozen=JSON.parse(await readFile(args.freeze,'utf8'));const identity=await memoryIdentity({upstreamProxy:args.upstreamProxy});
  assert.equal(frozen.status,'FROZEN_FOR_PAID_EVALUATION');assert.deepEqual(frozen.identity,identity,'paid source/fixture/prompt/budget changed');
  const fixture=memoryFixture();const ids=args.questions??fixture.questions.questions.map(row=>row.id);
  assert.ok(ids.length&&new Set(ids).size===ids.length&&ids.every(id=>fixture.questions.questions.some(q=>q.id===id)),'unapproved question selection');
  const root=ownedPath(path.join(base,'live',args.runName));
  assert.equal(existsSync(path.join(root,'result.json')),false,'run exists; never retry RUNNING/interrupted/paid questions');
  // No key access precedes explicit live flag and identity checks.
  const credential=(await readFile(path.join(repo,'.sciencescope-local/secret/opencode.key'),'utf8')).trim();assert.ok(credential.length>=8);
  await mkdir(root,{recursive:true});
  const ledger={schema:1,status:'RUNNING',arm:args.arm,round:args.round,identity,selectedQuestionIds:ids,consolidation:[],questions:[],startedAt:new Date().toISOString()};
  const file=path.join(root,'result.json');await saveJson(file,ledger);
  const template=path.join(root,'template');
  const selectedProjects=fixture.corpus.projects.filter(project=>fixture.questions.questions.some(question=>question.projectId===project.id&&ids.includes(question.id)));
  const selectedCorpus={...fixture.corpus,projects:selectedProjects};
  if(args.arm==='baseline')await seedSources(template,selectedCorpus);
  else{
    for(const project of selectedProjects)for(const stage of project.consolidationStages){
      await seedSources(template,selectedCorpus,{stage});
      const receipt=await runConsolidationStage({dataRoot:template,evidenceRoot:path.join(root,'consolidation',stage.id),stage,credential,upstreamProxy:args.upstreamProxy});
      ledger.consolidation.push(receipt);await saveJson(file,ledger);
    }
  }
  const expectedRoot=path.join(root,'source-comparison');const expected=await seedSources(expectedRoot,selectedCorpus);
  ledger.sourceIdentity=await sourceIdentity(template);assert.deepEqual(ledger.sourceIdentity,expected,'consolidation changed raw source history');
  for(const question of fixture.questions.questions.filter(row=>ids.includes(row.id))){
    const dataRoot=path.join(root,'questions',question.id,'app'),evidenceRoot=path.join(root,'questions',question.id,'evidence');
    await clonePreparedDatabase(template,dataRoot);
    // Reserve the turn before starting a proxy or a model session. No resume path.
    ledger.questions.push({id:question.id,status:'RUNNING'});await saveJson(file,ledger);
    const result=await runMemoryQuestion({dataRoot,evidenceRoot,question,gold:fixture.gold.questions.find(row=>row.questionId===question.id),corpus:fixture.corpus,credential,upstreamProxy:args.upstreamProxy});
    ledger.questions[ledger.questions.length-1]=result;await saveJson(file,ledger);
    console.log(JSON.stringify({id:question.id,arm:args.arm,round:args.round,outcome:result.active.outcome,grade:result.active.grade?.coreGrade??null,requests:result.active.requestCount}));
    if(result.active.stopReason==='RUNNER_FAILURE')break;
  }
  ledger.status=ledger.questions.length===ids.length?'FINISHED_SOURCE_AUDIT_PENDING':'STOPPED_SOURCE_AUDIT_PENDING';ledger.finishedAt=new Date().toISOString();
  await saveJson(file,ledger);const report=summarizeMemoryLedger(ledger);await saveJson(path.join(root,'report.json'),report);return {root,status:ledger.status,questions:ledger.questions.length,report};
}
export function summarizeMemoryLedger(ledger){
  const rows=ledger.questions.filter(row=>row.active).map(row=>row.active);
  const allEvents=[...ledger.consolidation,...ledger.questions].flatMap(row=>row.requests?.events??[]).filter(row=>row.routeKind==='completion'&&row.forwarded);
  const unknownUsage=allEvents.filter(event=>!Number.isFinite(event.usage?.total_tokens));
  const knownUsage={};
  for(const event of allEvents.filter(event=>Number.isFinite(event.usage?.total_tokens)))for(const [key,value] of Object.entries(event.usage))if(Number.isFinite(value))knownUsage[key]=(knownUsage[key]??0)+value;
  const infrastructure=rows.filter(row=>row.outcome==='infrastructure').length;
  const pendingQuestions=(ledger.selectedQuestionIds?.length??rows.length)-rows.length;
  const qualityDenominator=rows.length-infrastructure;
  const byCategory=Object.fromEntries(['single','update','temporal','cross_session','unanswerable'].map(category=>{
    const selected=rows.filter(row=>row.category===category&&row.outcome!=='infrastructure');
    return [category,{denominator:selected.length,correct:selected.filter(row=>row.outcome==='completed'&&row.grade?.correct).length}];
  }));
  return {schema:1,arm:ledger.arm,round:ledger.round,status:ledger.status,questions:rows.length,
    correct:rows.filter(row=>row.outcome==='completed'&&row.grade?.correct).length,qualityDenominator,infrastructureFailures:infrastructure,pendingQuestions,
    accuracy:pendingQuestions?null:qualityDenominator?rows.filter(row=>row.outcome==='completed'&&row.grade?.correct).length/qualityDenominator:null,
    formatFailures:rows.filter(row=>row.grade?.coreGrade==='format_fail').length,correctRefusals:rows.filter(row=>row.outcome==='completed'&&row.grade?.coreGrade==='correct_refusal').length,
    byCategory,briefHitCount:0,retrievalCallCount:rows.reduce((total,row)=>total+(row.retrievalHitReceipts?.length??0),0),
    retrievalNonemptyCalls:rows.reduce((total,row)=>total+(row.retrievalHitReceipts??[]).filter(receipt=>receipt.hits.length>0).length,0),
    retrievalHitCount:rows.reduce((total,row)=>total+(row.retrievalHitReceipts??[]).reduce((sum,receipt)=>sum+receipt.hits.length,0),0),
    expectedSupportedRetrievalHitCount:null,sourceAuditStatus:'PENDING',consolidationStages:ledger.consolidation.length,
    consolidationFailures:ledger.consolidation.filter(row=>row.active?.status==='FAILED'||row.active?.decisions?.some(item=>item.status==='failed')).length,
    physicalRequests:allEvents.length,effectiveModelSteps:allEvents.filter(event=>!event.isRetry).length,retries:allEvents.filter(event=>event.isRetry).length,
    unknownUsageRequests:unknownUsage.map(event=>({questionId:event.questionId,sequence:event.sequence})),knownUsage,
    interpretation:'Controlled synthetic global project-memory Q&A. Located citations require a separate source audit. Global Research Base brief is not injected.'};
}
export async function main(argv=process.argv.slice(2)){
  const args=parseMemoryArgs(argv);const result=args.mode==='live'?await runMemoryEvaluation(args):await prepareMemoryEvaluation(args);console.log(JSON.stringify(result));return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(JSON.stringify({status:'REFUSED_OR_FAILED',name:error.name,code:error.code??null,message:error.message}));process.exitCode=1;});
