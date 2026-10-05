// Opt-in T11 provider acceptance using only an owned environment-test fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import {readFile,mkdir,copyFile,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createContextLiveHarness} from './context-live-harness.mjs';

if(!process.argv.includes('--live'))throw new Error('Paid acceptance requires --live');
const arg=process.argv.indexOf('--root');
if(arg<0)throw new Error('Pass the successful python-env-local-smoke fixture with --root');
const root=path.resolve(process.argv[arg+1]);
const relative=path.relative(path.resolve('.sciencescope-local/temp/t11-validation'),root);
if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Invalid T11 fixture path');
const local=JSON.parse(await readFile(path.join(root,'result.json'),'utf8'));
assert.equal(local.checks.passed,true,'real managed environments must pass local acceptance first');
const database=path.join(root,'.sciencescope-local/state/sciencescope.sqlite');
await mkdir(path.dirname(database),{recursive:true});
try{await access(database);}catch{await copyFile(path.join(root,'environments.sqlite'),database,constants.COPYFILE_EXCL);}
const approvalOnly=process.argv.includes('--approval-only'),stamp=Date.now();
const run=await createContextLiveHarness('python-env-live',{preparedRoot:root,evidenceFile:approvalOnly?`live-approval-${stamp}.json`:`live-result-${stamp}.json`,maxRequests:approvalOnly?10:30,maxTokens:1536,apiOptions:{pythonOptions:{uvPath:path.resolve('.sciencescope-local/runtimes/uv/uv.exe')},pythonBootstrap:false}});
const {call,model,evidence}=run;
const projectId='python-env-evaluation',a=`python-main-a-${stamp}`,b=`python-main-b-${stamp}`,system=`python-main-system-${stamp}`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const answer=events=>events.filter(event=>event.type==='text-delta').map(event=>event.delta).join('');
async function send(chatId,text,extra={}){
  const events=await call('chat',{chatId,projectId,model,text,executionMode:'full',...(approvalOnly?{pythonEnvId:local.copy.id}:{}),...extra});
  evidence.turns.push({chatId,text,events});return events;
}
async function install(chatId,allow,requirement){
  let finished=false,approvalSeen=false,turnError,turnEvents;
  const task=send(chatId,`Call python_env_install exactly once with packages ["${requirement}"] and reason "T11 controlled test package". Do not use any other tools. After the result, say whether installation was approved or denied, then stop.`,{executionMode:'ask'}).then(events=>{turnEvents=events;},error=>{turnError=error;}).finally(()=>finished=true);
  const deadline=Date.now()+120000;
  while(!finished&&Date.now()<deadline){
    const state=await call('execution?chatId='+encodeURIComponent(chatId));
    for(const approval of state.approvals||[]){
      assert.equal(approval.toolName,'python_env_install');
      assert.deepEqual(approval.packages,[requirement]);assert.ok(approval.targetEnvironment);
      approvalSeen=true;await call('execution/approval',{chatId,requestId:approval.requestId,allowed:allow});
    }
    await pause(250);
  }
  if(!finished){await call('chat/stop',{chatId}).catch(()=>{});await task.catch(()=>{});throw new Error('Installation approval turn exceeded test budget');}
  await task;if(turnError)throw turnError;const events=turnEvents;assert.ok(approvalSeen,'a real application approval was presented');
  assert.ok(events.some(event=>event.type==='tool-call'&&event.toolName==='python_env_install'||event.type==='tool-call'&&event.name==='python_env_install'));
  const toolCall=events.find(event=>event.type==='tool-call'&&(event.name||event.toolName)==='python_env_install');
  const toolResult=events.find(event=>event.type==='tool-result'&&event.callId===toolCall.callId);
  assert.equal(toolResult.isError,false);
  const blocks=JSON.parse(toolResult.resultPreview);
  const receipt=JSON.parse(blocks.find(block=>block.type==='text').text);
  assert.equal(receipt.installed,allow,'tool result reports the actual installation outcome explicitly');
  assert.deepEqual(receipt.requestedPackages,[requirement]);
  return events;
}
try{
  await call('workspace',{projects:[{id:projectId,name:'Python environment acceptance',desc:'Synthetic fixture only',archived:false}],pinned:[],projectExpanded:{}});
  await call('python/bind',{scope:'project',targetId:projectId,envId:local.builtin.id});
  if(!approvalOnly){for(const [chatId,envId] of [[a,local.builtin.id],[b,local.copy.id],[system,'system']]){
    const events=await send(chatId,'Use the shell tool only to run python -c "import sys; print(sys.executable); print(sys.prefix)". Report those two exact paths. Do not inspect any files.',{pythonEnvId:envId});
    const text=JSON.stringify(events);
    assert.ok(events.some(event=>event.type==='tool-result'),'actual filesystem process tool result required');
    if(envId!=='system')assert.ok(text.includes(envId),`real Python result must identify ${envId}`);
    evidence.checks[chatId]=true;
  }
  await send(a,'Remember the short test marker T11_HISTORY_CEDAR. Reply ACK only; no tools.');
  await call('python/bind',{scope:'chat',targetId:a,envId:local.copy.id});
  const switched=await send(a,'First run python -c "import sys; print(sys.prefix)" using the shell tool. Then state the test marker I previously asked you to remember. Do not inspect files.');
  assert.match(JSON.stringify(switched),new RegExp(local.copy.id));assert.match(answer(switched),/T11_HISTORY_CEDAR/);
  evidence.checks.nextTurnEnvironmentAndHistory=true;
  }
  const installedPackage=approvalOnly?'humanfriendly':'humanize';
  await install(a,true,installedPackage);
  await install(a,false,'emoji');
  const envs=await call('python/envs'),env=envs.envs.find(item=>item.id===local.copy.id);
  assert.ok(env.packages.includes(installedPackage));assert.ok(!env.packages.includes('emoji'));
  evidence.checks.approveAndReject=true;
  evidence.checks.passed=true;
}catch(error){evidence.failure={code:error.code||'ACCEPTANCE_ASSERTION',message:error.message};throw error;}
finally{await run.close();}
