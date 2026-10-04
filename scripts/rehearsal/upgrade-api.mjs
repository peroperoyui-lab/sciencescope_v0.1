// Repeatable old-host API seeding -> same-directory latest-host upgrade check.
// Uses real DSH with a loopback deterministic model; no production data or key.
// node scripts/rehearsal/upgrade-api.mjs seed|verify SOURCE DATA EVIDENCE LABEL
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';

const [phase,sourceArg,dataArg,evidenceArg,label='node']=process.argv.slice(2);
assert.ok(['seed','verify'].includes(phase),'phase must be seed or verify');
const source=path.resolve(sourceArg),data=path.resolve(dataArg),evidence=path.resolve(evidenceArg);
assert.ok(data.includes(path.join('.sciencescope-local','temp')),'owned temp data required');
await mkdir(data,{recursive:true});await mkdir(evidence,{recursive:true});
const importSource=relative=>import(pathToFileURL(path.join(source,relative)).href);
const sourceApi=await readFile(path.join(source,'scripts/desktop-api.mjs'),'utf8');
const supports=route=>sourceApi.includes(route);
const result={phase,label,source,data,status:'running',checks:[],features:{},errors:[],modelRequests:0};
const apiEvidence=[];const prompts=[];let api,server,host,fixture;
const model={providerId:'upgrade-local',modelId:'fixture'};
const project='upgrade-project',chat='upgrade-main',other='upgrade-independent';
const expectedPath=path.join(evidence,'baseline.json');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function subset(expected,actual,where){
 if(Array.isArray(expected)){assert.ok(Array.isArray(actual),where);assert.equal(actual.length,expected.length,where+' length');expected.forEach((x,i)=>subset(x,actual[i],where+'['+i+']'));}
 else if(expected&&typeof expected==='object'){assert.ok(actual&&typeof actual==='object',where);for(const [k,v] of Object.entries(expected))subset(v,actual[k],where+'.'+k);}
 else assert.deepEqual(actual,expected,where);
}
async function fileSnapshot(){
 const rows=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const p=path.join(dir,entry.name);if(entry.isDirectory())await walk(p);else if(entry.isFile())rows.push({path:path.relative(data,p),sha256:hash(await readFile(p))});}}
 await walk(path.join(data,'.sciencescope-local','library'));
 await walk(path.join(data,'.sciencescope-local','projects'));
 return rows.sort((a,b)=>a.path.localeCompare(b.path));
}
function sqlSnapshot(){
 const db=new DatabaseSync(path.join(data,'.sciencescope-local','state','sciencescope.sqlite'),{readOnly:true});
 const tables={};
 try{for(const row of db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
   if(/fts|^rb_vec(?:_|$)|context_.*cursors|summary_pending/.test(row.name))continue;
   const name='"'+row.name.replaceAll('"','""')+'"';
   const columns=db.prepare('PRAGMA table_info('+name+')').all();
   const primary=columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
   tables[row.name]={columns:columns.map(c=>c.name),primary,rows:db.prepare('SELECT * FROM '+name).all()};
  } return {tables,integrity:db.prepare('PRAGMA integrity_check').get(),foreignKeys:db.prepare('PRAGMA foreign_key_check').all()};
 }finally{db.close();}
}
async function call(route,body,{allow=false}={}){
 const response=await fetch(`http://127.0.0.1:${server.address().port}`+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer rehearsal-local-api',...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const raw=await response.text();let value;
 try{value=response.headers.get('content-type')?.includes('ndjson')?raw.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x)):raw?JSON.parse(raw):{};}catch{value={raw:raw.slice(0,300)}}
 apiEvidence.push({route,method:body===undefined?'GET':'POST',status:response.status,value});
 if(!allow)assert.equal(response.status,200,`${route}: ${JSON.stringify(value).slice(0,700)}`);
 return {status:response.status,value};
}
async function turn(id,text,suffix,extra={}){
 const r=await call('/api/chat',{chatId:id,projectId:id===other?null:project,model,text,userMessageId:'user-'+suffix,assistantMessageId:'assistant-'+suffix,executionMode:'ask',...extra});
 assert.equal(r.value.at(-1)?.type,'completed',JSON.stringify(r.value));
 assert.match(r.value.at(-1).text,/UPGRADE_REPLY/);
}
async function readSnapshots(ids){
 const views={};for(const route of ['/api/workspace','/api/profile','/api/preferences','/api/roles','/api/experts','/api/library','/api/knowledge?projectId='+project,...ids.map(id=>'/api/chats/'+id+'/messages')])views[route]=(await call(route)).value;
 for(const route of ['/api/chats/minutes?chatId='+chat,'/api/research-input/draft?scope=main&ownerId='+chat,'/api/python/settings','/api/python/resolve?chatId='+chat])if(supports(route.split('?')[0]))views[route]=(await call(route)).value;
 if(supports('/api/research/'))for(const route of ['/api/research/items?projectId='+project,'/api/research/sources?projectId='+project])views[route]=(await call(route)).value;
 return views;
}
async function settleMinutes(ids){
 if(!supports('/api/chats/minutes'))return;
 for(const id of ids){await call('/api/chats/minutes/refresh',{chatId:id});const deadline=Date.now()+90000;for(;;){const state=(await call('/api/chats/minutes?chatId='+id)).value;if(!state.updating&&(state.minutes?.throughOrdinal||0)>=state.latestMessage)break;assert.ok(Date.now()<deadline,'minutes readiness timed out '+id);await wait(250);}}
}
async function closeApp(){
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;}
 if(api){await api.close();api=null;host=null;}else if(host){await host.close();host=null;}
}
try{
 fixture=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw||'{}');result.modelRequests++;const messages=(input.messages||[]).map(m=>({role:m.role,text:typeof m.content==='string'?m.content:JSON.stringify(m.content)}));prompts.push(messages);
  const last=messages.filter(x=>x.role==='user').at(-1)?.text||'';const marker=last.match(/TURN_[A-Z]+/)?.[0]||'EXPERT';
  res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta:{content:'UPGRADE_REPLY_'+marker}}]})+'\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');});
 await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
 const credentialRef='SCIENCESCOPE_UPGRADE_FIXTURE';
 if(phase==='seed'){const home=path.join(data,'.sciencescope-local','dsh');await mkdir(home,{recursive:true});await writeFile(path.join(home,'.credentials.yaml'),'version: 1\nrefs:\n  '+credentialRef+': '+randomBytes(24).toString('hex')+'\n',{mode:0o600});}
 const runtimeConfig={providers:{[model.providerId]:{api:'openai-completions',baseURL:`http://127.0.0.1:${fixture.address().port}/v1`,apiKeyEnv:credentialRef,models:[{id:model.modelId,contextWindow:65536,maxTokens:256}]}}};
 const {createDshHost}=await importSource('adapters/runtime-dsh/host.mjs');
 host=await createDshHost({home:path.join(data,'.sciencescope-local','dsh'),cwd:path.join(data,'.sciencescope-local','projects'),sessionHeaders:['x-upgrade-session']});
 host.listProviders=async()=>[{id:model.providerId,models:[{id:model.modelId}]}];host.getRuntimeConfig=async()=>runtimeConfig;
 const {createDesktopApi}=await importSource('scripts/desktop-api.mjs');
 api=await createDesktopApi({dataRoot:data,runtimeHost:host,apiToken:'rehearsal-local-api',pythonBootstrap:false,onError:error=>result.errors.push({code:error.code||null,message:error.message})});
 server=createServer((req,res)=>{void api.handle(req,res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 result.features=(await call('/api/status')).value.features||{};
 if(phase==='seed'){
  await call('/api/workspace',{projects:[{id:project,name:'升级 α 研究 "preserve"',desc:'Synthetic Unicode / newline\nrelationships',archived:false},{id:'upgrade-archived',name:'Archived control',desc:'keep archived',archived:true}],pins:[{type:'project',id:project}],projectExpanded:{[project]:true},lastChatId:null});
  await call('/api/profile',{displayName:'Synthetic Researcher α',bio:'Upgrade fixture only\nNo real user data.'});
  await call('/api/preferences',{theme:'dark',chatFontSize:20,sendKey:'ctrl-enter',reduceMotion:true,showScrollbars:true});
  for(const role of ['main','secretary','global'])await call('/api/roles/save',{role,config:{prompt:'Synthetic '+role+' role α. Preserve this user-authored setting exactly.'}});
  await turn(chat,'TURN_ALPHA Preserve first decision.','alpha');
  await turn(chat,'TURN_BETA Preserve second decision.','beta');
  await turn(other,'TURN_INDEPENDENT Independent history.','independent');
  const resource=(await call('/api/library/import',{name:'upgrade-notes.md',projectId:project,base64:Buffer.from('# Upgrade α\n\nEvidence unchanged.\n').toString('base64')})).value;
  await call('/api/library/import',{name:'independent.txt',projectId:null,base64:Buffer.from('Independent original bytes\n').toString('base64')});
  const knowledge=(await call('/api/knowledge/propose',{projectId:project,namespace:'canonical',title:'Synthetic accepted knowledge α',content:'Exact legacy finding with source relationship.',sourceIds:[resource.id]})).value;await call('/api/knowledge/accept',{id:knowledge.id});
  const roster=(await call('/api/experts')).value.experts;roster[0].persona+='\nSynthetic upgrade persona must survive.';
  await call('/api/experts',{experts:roster});
  const discussion=await call('/api/discussion',{chatId:chat,projectId:project,model,kind:supports('/api/discussion/adopt')?'ordered':'independent',text:'TURN_DISCUSSION compare preserved decisions.',expertIds:[roster[0].id,roster[1].id],...(supports('/api/discussion/adopt')?{reviewerId:roster[2].id}:{}),userMessageId:'user-discussion'});
  assert.equal(discussion.value.at(-1)?.type,'completed');assert.equal(discussion.value.filter(e=>e.type==='expert-end').length,supports('/api/discussion/adopt')?3:2);
  if(supports('/api/discussion/adopt')){const review=discussion.value.find(e=>e.type==='expert-end'&&e.review);assert.ok(review,'reviewer answer');await call('/api/discussion/adopt',{chatId:chat,messageId:review.messageId,adopted:true});result.checks.push({feature:'expert-adoption',status:'pass',messageId:review.messageId});}
  else result.checks.push({feature:'expert-adoption',status:'unsupported-old-version'});
  if(supports('/api/chats/minutes')){await settleMinutes([chat,other]);const old=(await call('/api/chats/minutes?chatId='+chat)).value.minutes;const one=(await call('/api/chats/minutes',{chatId:chat,text:'User authoritative minutes α\nDecision preserved #1',expectedRevision:old?.revision||0})).value.minutes;await call('/api/chats/minutes',{chatId:chat,text:'User authoritative minutes α\nDecision preserved #1\nSecond version kept',expectedRevision:one.revision});}
  else result.checks.push({feature:'minutes',status:'unsupported-old-version'});
  if(supports('/api/research-input/draft')){
   const notes={attachmentIds:[resource.id],messageQuotes:[{id:'quote-upgrade',revision:1,sourceChatId:chat,sourceMessageId:'assistant-alpha',selectedText:'UPGRADE_REPLY_TURN_ALPHA',comment:'quoted α'}],annotations:[{id:'mark-upgrade',revision:1,resourceId:resource.id,selectedText:'Evidence unchanged.',comment:'mark α',location:{page:1}}],contextRefs:[]};
   await call('/api/research-input/draft',{scope:'main',ownerId:chat,snapshot:notes});
  }else result.checks.push({feature:'marks-draft',status:'unsupported-old-version'});
  if(supports('/api/python/bind')){
   await call('/api/python/bind',{scope:'project',targetId:project,envId:'system'});await call('/api/python/bind',{scope:'chat',targetId:chat,envId:'system'});await call('/api/python/settings',{defaultEnvId:'system',autoApproveFull:true});
  }else result.checks.push({feature:'python-bindings',status:'unsupported-old-version'});
  if(supports('/api/research/')){
   await call('/api/research/items',{item:{type:'memory',subtype:'decision',scope:'project',projectId:project,title:'Upgrade decision α',body:'Retain exact content and project relation.',visibility:'shared'}});
  }else result.checks.push({feature:'research-items',status:'unsupported-old-version'});
  const ids=[chat,other];
  if(result.features.branch){const branch=(await call('/api/chats/branch',{chatId:chat,messageId:'assistant-alpha',mode:'reply'})).value;ids.push(branch.chatId);await call('/api/chats/draft',{chatId:branch.chatId,text:'Preserved branch draft α'});}
  else result.checks.push({feature:'branched-conversation',status:'unsupported-old-version'});
  await wait(1800);
  const views=await readSnapshots(ids);await closeApp();const baseline={label,ids,resourceId:resource.id,views,sql:sqlSnapshot(),files:await fileSnapshot()};
  if(supports('/api/chats/minutes')){const m=baseline.views['/api/chats/minutes?chatId='+chat].minutes;assert.equal(m.author,'user','latest seeded minutes are user authoritative');const row=baseline.sql.tables.chat_minutes.rows.find(x=>x.chat_id===chat&&x.revision===m.revision);assert.equal(row.text,m.text);assert.equal(Math.max(...baseline.sql.tables.chat_minutes.rows.filter(x=>x.chat_id===chat).map(x=>x.revision)),m.revision,'views and stopped database have same latest minutes');}
  await writeFile(expectedPath,JSON.stringify(baseline,null,2));result.checks.push({feature:'api-created-dataset',status:'pass',chats:ids.length,files:baseline.files.length,tables:Object.keys(baseline.sql.tables).length});
 }else{
  const baseline=JSON.parse(await readFile(expectedPath,'utf8'));const after=sqlSnapshot();const changes=[];let rows=0;
  for(const [name,table] of Object.entries(baseline.sql.tables)){
   assert.ok(after.tables[name],'table preserved '+name);
   for(const old of table.rows){const candidate=after.tables[name].rows.find(row=>table.primary.length?table.primary.every(k=>row[k]===old[k]):table.columns.every(k=>row[k]===old[k]));assert.ok(candidate,'row preserved '+name+': '+JSON.stringify(table.primary.map(k=>old[k])));
    for(const k of table.columns)if(candidate[k]!==old[k])changes.push({table:name,key:table.primary.map(p=>old[p]),column:k,before:old[k],after:candidate[k]});rows++;}
  }
  await writeFile(path.join(evidence,'sql-changes.json'),JSON.stringify(changes,null,2));
  // Explicit safe restart rule: saved outbox state resumes paused, never auto-sends.
  const intentional=changes.filter(c=>c.table==='chat_outbox_state'&&c.column==='paused'&&c.before===0&&c.after===1);
  result.intentionalRestartChanges=intentional;assert.deepEqual(changes.filter(c=>!intentional.includes(c)),[],'old columns unchanged apart from explicit safe outbox pause');
  assert.equal(Object.values(after.integrity)[0],'ok');assert.deepEqual(after.foreignKeys,[]);
  for(const file of baseline.files)assert.equal(hash(await readFile(path.join(data,file.path))),file.sha256,'file preserved '+file.path);
  result.checks.push({feature:'raw-storage-preservation',status:'pass',rows,files:baseline.files.length,tables:Object.keys(baseline.sql.tables).length});
  const views=await readSnapshots(baseline.ids);
  // New computed presentation fields/default capabilities are allowed; all old payload fields remain equal.
  for(const [route,view] of Object.entries(baseline.views)){
   const compare=structuredClone(view);if(route==='/api/experts')delete compare.available;if(route.startsWith('/api/python/resolve'))delete compare.revision;if(route.startsWith('/api/chats/minutes')){delete compare.summaryStatus;delete compare.exportStatus;delete compare.updating;}
   if(route==='/api/experts'){const actual=structuredClone(views[route]);const added=actual.experts.filter(e=>!compare.experts.some(old=>old.id===e.id));assert.ok(added.length<=1&&added.every(e=>e.id==='independent-reviewer'&&e.kind==='reviewer'&&e.enabled===false),'only documented default reviewer may be added');actual.experts=compare.experts.map(old=>actual.experts.find(e=>e.id===old.id));subset(compare,actual,route);}
   else if(route.startsWith('/api/research/sources')){const actual=structuredClone(views[route]);const added=actual.sources.filter(e=>!compare.sources.some(old=>old.id===e.id));for(const e of added){const original=baseline.sql.tables.resources.rows.find(r=>r.id===e.resourceId);assert.ok(original,'only existing originals can gain a source catalog row');assert.equal(e.title,original.title);assert.equal(e.projectId,original.project_id);}assert.equal(new Set(added.map(e=>e.resourceId)).size,added.length,'no duplicate catalog additions');actual.sources=compare.sources.map(old=>actual.sources.find(e=>e.id===old.id));if(Object.hasOwn(compare,'total'))delete compare.total;subset(compare,actual,route);}
   else if(route.startsWith('/api/research/items')){const actual=structuredClone(views[route]);const added=actual.items.filter(e=>!compare.items.some(old=>old.id===e.id));for(const e of added){const old=baseline.sql.tables.knowledge.rows.find(r=>r.id===e.legacyId);assert.ok(old,'only legacy knowledge gains a mirrored item');assert.equal(e.title,old.title);assert.equal(e.body,old.content);assert.equal(e.projectId,old.project_id);assert.equal(e.createdBy,'import:knowledge');}actual.items=compare.items.map(old=>actual.items.find(e=>e.id===old.id));if(Object.hasOwn(compare,'total'))delete compare.total;subset(compare,actual,route);}
   else subset(compare,views[route],route);
  }
  result.checks.push({feature:'api-payload-preservation',status:'pass',routes:Object.keys(baseline.views).length});
  const materialRoute='/api/research-input/draft?scope=main&ownerId='+chat;const material=baseline.views[materialRoute];
  const preview=(await call('/api/library/preview?id='+encodeURIComponent(baseline.resourceId))).value;assert.match(preview.text,/Evidence unchanged/);
  const promptStart=prompts.length;await turn(chat,'TURN_RESUME Continue original history.','resume',material?{researchInput:material}:{});
  const context=prompts.slice(promptStart).flat().map(m=>m.text).join('\n');assert.match(context,/TURN_ALPHA/);assert.match(context,/TURN_BETA/);assert.match(context,/UPGRADE_REPLY/);
  result.checks.push({feature:'runtime-history-resume',status:'pass'});
  if(material){assert.match(context,/Evidence unchanged/);assert.match(context,/mark α/);const page=(await call('/api/chats/'+chat+'/messages')).value;const receipt=page.messages.find(m=>m.id==='user-resume').researchInput;assert.equal(receipt.annotations[0].id,'mark-upgrade');assert.equal(receipt.messageQuotes[0].sourceMessageId,'assistant-alpha');result.checks.push({feature:'marks-quotes-library-functionality',status:'pass'});}
  const independentStart=prompts.length;await turn(other,'TURN_OTHER_RESUME Continue independent history.','other-resume');const independentContext=prompts.slice(independentStart).flat().map(m=>m.text).join('\n');assert.match(independentContext,/TURN_INDEPENDENT/);assert.doesNotMatch(independentContext,/TURN_ALPHA|TURN_BETA/);result.checks.push({feature:'independent-history-isolation',status:'pass'});
  if(baseline.ids.length>2){const branchId=baseline.ids[2];const start=prompts.length;await turn(branchId,'TURN_BRANCH_RESUME Continue branched history.','branch-resume');const ctx=prompts.slice(start).flat().map(m=>m.text).join('\n');assert.match(ctx,/TURN_ALPHA/);assert.doesNotMatch(ctx,/TURN_BETA/);result.checks.push({feature:'branch-context-isolation',status:'pass'});}
  const roster=(await call('/api/experts')).value.experts;const discussion=await call('/api/discussion',{chatId:chat,projectId:project,model,kind:'ordered',text:'TURN_POST_UPGRADE expert functionality.',expertIds:[roster[0].id],userMessageId:'user-post-upgrade-discussion'});assert.equal(discussion.value.at(-1)?.type,'completed');assert.equal(discussion.value.filter(e=>e.type==='expert-end').length,1);
  result.checks.push({feature:'post-upgrade-chat-expert-functionality',status:'pass'});await settleMinutes(baseline.ids.slice(0,2));
 }
 assert.deepEqual(result.errors,[],'no background application errors');result.status='pass';
}catch(error){result.status='fail';result.failure={message:error.message.slice(0,1600),stack:error.stack?.slice(0,2200)};process.exitCode=1;}
finally{await closeApp().catch(error=>result.errors.push({code:'CLOSE_FAILED',message:error.message}));if(fixture){fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));}await writeFile(path.join(evidence,phase+'-api.json'),JSON.stringify(apiEvidence,null,2));await writeFile(path.join(evidence,phase+'-model-prompts.json'),JSON.stringify(prompts,null,2));await writeFile(path.join(evidence,phase+'-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
