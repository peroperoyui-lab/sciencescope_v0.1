// T18 browser acceptance through the production router and application DB.
// Offline: the fake runtime writes real minutes; proposal/write decisions use
// the real summary APIs and workbench store. No route or UI is mocked.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';

const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'summary-policy-ui-'));
const dataRoot=path.join(root,'app'),outputDir=path.join(root,'assets');
const screenshots=path.join(base,'t18-validation');await mkdir(screenshots,{recursive:true});
const projectId='summary-ui-project',chatId='summary-ui-main',model={providerId:'offline',modelId:'m'};
const visualStates=[['zh-CN','light','zh-light'],['zh-CN','dark','zh-dark'],['en','light','en-light'],['en','dark','en-dark']];
const screenshotPaths=[];
let sessionNumber=0,server,browser,page;

function runtimeHost(){
  const sessions=new Map();
  return {
    capabilities:{tokenStreaming:true},close:async()=>{},observeSession:()=>()=>{},setToolHandler:()=>{},
    listProviders:async()=>[{id:'offline',name:'Offline',models:['m'],configured:true,saved:true}],getRuntimeConfig:async()=>({}),getModelInfo:async()=>({}),getContextUsage:async()=>null,getGoal:async()=>null,
    startSession:async({sessionId,noTools})=>{const id=sessionId||`session-summary-ui-${++sessionNumber}`;sessions.set(id,noTools?'minutes':'chat');return id;},
    configurePolicy:async()=>{},configureReasoning:async()=>{},configureBrief:async()=>{},releaseSession:async()=>{},
    send:async({sessionId,text,onEvent})=>{
      if(sessions.get(sessionId)==='minutes'){
        if(String(text).includes('工作站现状'))return {finalResponse:JSON.stringify({plans:[],log:[]})};
        return {finalResponse:'## 研究问题与目标\n- 验证自动总结策略\n\n## 待办\n- 核对工作站更新'};
      }
      onEvent?.({type:'completed',text:'MAIN_FIXTURE_OK'});return {finalResponse:'MAIN_FIXTURE_OK'};
    },
  };
}
async function launch(){return createDesktopServer({dataRoot,outputDir,runtimeHost:runtimeHost()});}
async function request(route,body,{expected=200}={}){
  const response=await apiFetch(server,'/api/'+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let value={};try{value=text?JSON.parse(text):{};}catch{value={text};}
  assert.equal(response.status,expected,`${route}: ${text}`);return value;
}
async function desktopReady(target){
  await target.waitForFunction(()=>!!(window.ScienceScopeWorkspace?.ready&&window.ScienceScopeProfile?.ready&&window.ScienceScopePreferences?.ready&&window.ScienceScopeRoleSettings?.ready));
  // Workspace completion does not cover the independent settings/profile/role
  // initializers. Their completion can still remount settings.
  await target.evaluate(async()=>{
    window.__summarySmokeReadyEntered=true;
    await Promise.all([window.ScienceScopeWorkspace.ready,window.ScienceScopeProfile.ready,window.ScienceScopePreferences.ready,window.ScienceScopeRoleSettings.ready]);
    window.__summarySmokeDesktopReady=true;
  });
}
async function openPage(url=server.url,{startupRegression=false}={}){
  const target=await browser.newPage();await installApiToken(target,server);
  let releaseRoles,rolesReached,rolesHandled;
  const rolesGate=new Promise(resolve=>releaseRoles=resolve),rolesSeen=new Promise(resolve=>rolesReached=resolve);
  const rolesDone=new Promise(resolve=>rolesHandled=resolve);
  let handlingRoles=false;
  const holdRoles=async route=>{handlingRoles=true;rolesReached();try{await rolesGate;await route.continue();}finally{rolesHandled();}};
  if(startupRegression)await target.route('**/api/roles',holdRoles);
  try{
    await target.goto(url);const settled=desktopReady(target);
    if(startupRegression){
      await rolesSeen;
      await target.waitForFunction(()=>window.__summarySmokeReadyEntered);
      await target.evaluate(async()=>{await Promise.all([window.ScienceScopeWorkspace.ready,window.ScienceScopeProfile.ready,window.ScienceScopePreferences.ready]);});
      assert.equal(await target.evaluate(()=>!!window.__summarySmokeDesktopReady),false,'startup readiness must await the delayed role configuration, even after workspace/preferences finish');
      releaseRoles();
    }
    await settled;return target;
  }finally{releaseRoles();if(startupRegression){if(handlingRoles)await rolesDone;await target.unroute('**/api/roles',holdRoles);}}
}
async function openSecretary(target=page){await target.evaluate(async chatId=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread(chatId);if(V.panel!=='secretary')openPanel('secretary');},chatId);await target.waitForFunction(chatId=>window.ScienceScopeAssistants?.entry('secretary',chatId).loaded,chatId);}
async function waitSettings(){await page.waitForFunction(()=>{
  const form=document.querySelector('[data-summary-settings]'),fieldset=form?.querySelector('fieldset');
  const ready=fieldset&&!fieldset.disabled&&form.elements.messagesN.value!==''&&form.elements.tokensN.value!=='';
  const prior=window.__summarySettingsMount,count=ready&&prior?.form===form?prior.count+1:0;
  window.__summarySettingsMount={form,count};return count>=6;
});}
async function openMinutes(target=page){await target.locator('[data-v="workspace-menu"]').first().click();await target.locator('#v-menu [data-v="chat-minutes"]').click();await target.waitForSelector('#modal .minutes-dialog');}
async function appearance(language,theme,target=page){await request('preferences',{language,theme});await target.reload();await desktopReady(target);await target.waitForFunction(({language,theme})=>document.documentElement.lang===(language==='en'?'en':'zh-CN')&&document.documentElement.dataset.theme===theme,{language,theme});}
async function screenshot(kind,key){
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation=>animation.playState==='running'&&animation.effect?.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})));
  });
  if(kind==='proposals'){
    // Text can arrive while the panel is still opening. Require its final
    // visible geometry before capturing the actual approval controls.
    await page.waitForFunction(()=>{
      const panel=document.querySelector('.assistant-rightpanel');
      if(!panel)return false;
      const box=panel.getBoundingClientRect();
      const prior=window.__summaryPanelGeometry;
      const settled=box.width>=300&&box.right<=innerWidth+1&&!panel.getAnimations({subtree:true}).some(animation=>animation.playState==='running');
      const count=settled&&prior?.panel===panel&&Math.abs(prior.width-box.width)<0.5?prior.count+1:0;
      window.__summaryPanelGeometry={panel,width:box.width,count};
      return count>=6;
    });
    const geometry=await page.locator('.assistant-rightpanel').boundingBox();
    assert.ok(geometry?.width>=300,`proposal panel has its full visible width (${key}: ${JSON.stringify(geometry)})`);
    await page.locator('[data-assistant-action="summary-accept"]').first().waitFor({state:'visible'});
  }
  const file=path.join(screenshots,`${kind}-${key}.png`);await page.screenshot({path:file,fullPage:true});screenshotPaths.push(file);
}
function dbPath(){return path.join(dataRoot,'.sciencescope-local','state','sciencescope.sqlite');}
function seedProposals(minutesRevision){
  const db=new DatabaseSync(dbPath());const now=Date.now();
  const insert=db.prepare('INSERT INTO summary_proposals(id,chat_id,project_id,minutes_revision,target,op_json,status,created_at,decided_at) VALUES(?,?,?,?,?,?,?,?,NULL)');
  const values=[
    ['proposal-log-accept','log',{title:'接受的日志',note:'通过真实工作站接口追加'}],
    ['proposal-log-dismiss','log',{title:'忽略的日志',note:'不应写入工作站'}],
    ['proposal-map-first','map',{op:'status',nodeId:'root',status:'done'}],
    ['proposal-map-conflict','map',{op:'status',nodeId:'root',status:'review'}],
  ];
  for(const [index,[id,target,op]] of values.entries())insert.run(id,chatId,projectId,minutesRevision,target,JSON.stringify(op),'pending',new Date(now+index).toISOString());
  db.close();
}
function proposalStatuses(){const db=new DatabaseSync(dbPath());try{return Object.fromEntries(db.prepare('SELECT id,status FROM summary_proposals WHERE chat_id=? ORDER BY id').all(chatId).map(row=>[row.id,row.status]));}finally{db.close();}}
async function waitSummary(expected){await page.waitForFunction(async expected=>{
  const {hostRequest}=await import('/desktop/host-client.mjs');const value=await hostRequest('secretary/preferences');
  const same=(left,right)=>left===right||(Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((item,index)=>same(item,right[index])))||(left&&right&&typeof left==='object'&&typeof right==='object'&&!Array.isArray(left)&&!Array.isArray(right)&&Object.keys(left).length===Object.keys(right).length&&Object.keys(left).every(key=>Object.hasOwn(right,key)&&same(left[key],right[key])));
  return same(value.summary,expected);
},expected);}

try{
  server=await launch();
  await request('workspace',{projects:[{id:projectId,name:'总结策略界面验收',desc:'',archived:false}],pins:[],projectExpanded:{[projectId]:true},lastChatId:chatId});
  await request('roles/save',{role:'secretary',config:{prompt:'Offline secretary',model,reasoningEffort:null}});
  await request('chat',{chatId,projectId,title:'总结策略界面验收',model,text:'记录自动总结界面验收。',userMessageId:'summary-ui-user',assistantMessageId:'summary-ui-answer'});
  const refreshed=await request('chats/minutes/refresh',{chatId});
  assert.equal(refreshed.minutes.revision,1,'fake runtime creates an actual minutes revision through the production API');

  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root}});
  page=await openPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>go('secretary-settings'));await waitSettings();
  const form=page.locator('[data-summary-settings]');
  assert.equal(await form.locator('[name="afterDiscussion"]').isChecked(),true);
  assert.equal(await form.locator('[name="messagesEnabled"]').isChecked(),true);assert.equal(await form.locator('[name="messagesN"]').inputValue(),'20');
  assert.equal(await form.locator('[name="tokensEnabled"]').isChecked(),true);assert.equal(await form.locator('[name="tokensN"]').inputValue(),'30000');
  for(const name of ['onEnterProject','onLeaveProject','saveMarkdown'])assert.equal(await form.locator(`[name="${name}"]`).isChecked(),true);
  for(const name of ['map','versions','plans','log'])assert.equal(await form.locator(`[name="${name}"]`).inputValue(),'off');

  await form.locator('[name="messagesN"]').fill('12');await form.locator('[name="messagesN"]').dispatchEvent('change');
  await form.locator('[name="tokensEnabled"]').uncheck();await form.locator('[name="onEnterProject"]').uncheck();
  await form.locator('[name="plans"]').selectOption('propose');await form.locator('[name="log"]').selectOption('apply');
  const expectedSummary={afterDiscussion:true,onEnterProject:false,onLeaveProject:true,saveMarkdown:true,everyMessages:{enabled:true,n:12},everyTokens:{enabled:false,n:30000},workbench:{map:'off',versions:'off',plans:'propose',log:'apply'}};
  await waitSummary(expectedSummary);await page.waitForFunction(()=>document.querySelector('[data-summary-feedback]')?.textContent.includes('已保存'));

  // A real host restart over the same data root proves durable settings.
  await page.close();await server.close();server=await launch();page=await openPage(server.url,{startupRegression:true});page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>go('secretary-settings'));await waitSettings();
  assert.equal(await page.locator('[data-summary-settings] [name="messagesN"]').inputValue(),'12');
  assert.equal(await page.locator('[data-summary-settings] [name="tokensEnabled"]').isChecked(),false);
  assert.equal(await page.locator('[data-summary-settings] [name="onEnterProject"]').isChecked(),false);
  assert.equal(await page.locator('[data-summary-settings] [name="plans"]').inputValue(),'propose');
  assert.equal(await page.locator('[data-summary-settings] [name="log"]').inputValue(),'apply');

  for(const [language,theme,key] of visualStates){
    await appearance(language,theme);await page.evaluate(()=>go('secretary-settings'));await waitSettings();
    await page.locator('[data-summary-settings] h2').evaluate(element=>element.scrollIntoView({block:'start'}));
    await page.waitForFunction(language=>document.querySelector('[data-summary-settings]')?.innerText.includes(language==='en'?'Automatic summaries':'自动总结'),language);
    await screenshot('settings',key);
  }

  if(process.argv.includes('--settings-screenshots-only')){
    console.log(JSON.stringify({passed:true,settingsScreenshotsOnly:true,screenshots:screenshotPaths,paidRequests:0}));
  }else{
  seedProposals(refreshed.minutes.revision);
  for(const [language,theme,key] of visualStates){
    await appearance(language,theme);await openSecretary();
    await page.waitForFunction(()=>window.ScienceScopeAssistants.entry('secretary','summary-ui-main').summaryProposals?.length===4);
    await page.waitForFunction(language=>document.querySelector('.assistant-summary-proposals')?.innerText.includes(language==='en'?'Workstation updates awaiting approval':'待确认的工作站更新'),language);
    await screenshot('proposals',key);
  }

  async function decide(id,action){const button=page.locator(`[data-assistant-action="${action}"][data-id="${id}"]`);await button.click();await page.waitForFunction(id=>!document.querySelector(`[data-assistant-action][data-id="${id}"]`),id);}
  await decide('proposal-log-accept','summary-accept');
  let workbench=await request(`workbench?projectId=${projectId}`);assert.ok(workbench.logs.some(log=>log.title==='接受的日志'));
  await decide('proposal-log-dismiss','summary-dismiss');workbench=await request(`workbench?projectId=${projectId}`);assert.ok(!workbench.logs.some(log=>log.title==='忽略的日志'));
  await decide('proposal-map-first','summary-accept');workbench=await request(`workbench?projectId=${projectId}`);assert.equal(workbench.map.nodes.find(node=>node.id==='root').status,'done');
  await decide('proposal-map-conflict','summary-accept');workbench=await request(`workbench?projectId=${projectId}`);assert.equal(workbench.map.nodes.find(node=>node.id==='root').status,'review');
  assert.deepEqual(proposalStatuses(),{'proposal-log-accept':'accepted','proposal-log-dismiss':'dismissed','proposal-map-conflict':'accepted','proposal-map-first':'accepted'});

  // Perform one successful undo before the minutes matrix so every captured
  // locale/theme shows its durable disabled receipt.
  await openMinutes();
  await page.waitForFunction(()=>document.querySelectorAll('[data-summary-undo]').length>=3);
  const writeResult=await request(`summary/writes?chatId=${chatId}`),writes=writeResult.writes;
  const logWrite=writes.find(write=>write.target==='log'&&write.op?.title==='接受的日志');
  const conflictWrite=writes.find(write=>write.target==='map'&&write.op?.status==='review');
  assert.ok(logWrite&&conflictWrite,'accepted proposals create durable write receipts');
  await page.locator(`[data-summary-undo="${logWrite.id}"]`).click();
  let undoneAt=null;
  for(let attempt=0;attempt<100&&!undoneAt;attempt++){
    undoneAt=(await request(`summary/writes?chatId=${chatId}`)).writes.find(write=>write.id===logWrite.id)?.undoneAt;
    if(!undoneAt)await page.waitForTimeout(100);
  }
  assert.ok(undoneAt,'undo receipt is durable before reading workbench');
  workbench=await request(`workbench?projectId=${projectId}`);assert.ok(!workbench.logs.some(log=>log.title==='接受的日志'),'successful undo removes only the summary-created log');

  for(const [language,theme,key] of visualStates.slice(0,3)){
    await appearance(language,theme);await openMinutes();
    await page.waitForFunction(()=>document.querySelectorAll('[data-summary-undo]').length>=3);
    await page.waitForFunction(language=>document.querySelector('[data-minutes-writes]')?.innerText.includes(language==='en'?'Recent workstation updates':'最近的工作站更新'),language);
    await screenshot('minutes',key);
  }

  // A user edit after the summary write makes automatic undo unsafe (409).
  workbench=await request(`workbench?projectId=${projectId}`);
  const editedMap=structuredClone(workbench.map),rootNode=editedMap.nodes.find(node=>node.id==='root');rootNode.status='user-edited';
  await request('workbench/save',{projectId,revision:workbench.revision,map:editedMap});
  await appearance('en','dark');await openMinutes();await page.waitForFunction(()=>document.querySelectorAll('[data-summary-undo]').length>=3);
  await page.locator(`[data-summary-undo="${conflictWrite.id}"]`).click();
  await page.waitForFunction(()=>document.querySelector('[data-minutes-export]')?.textContent.trim().length>0);
  assert.match(await page.locator('[data-minutes-export]').innerText(),/modified|cannot be undone/i,'English UI surfaces the 409 conflict');
  assert.equal(await page.locator(`[data-summary-undo="${conflictWrite.id}"]`).isEnabled(),true);
  assert.equal((await request(`workbench?projectId=${projectId}`)).map.nodes.find(node=>node.id==='root').status,'user-edited');
  await screenshot('minutes','en-dark');

  await appearance('en','dark');await page.evaluate(()=>go('secretary-settings'));await waitSettings();
  assert.match(await page.locator('[data-summary-settings]').innerText(),/Automatic summaries[\s\S]*Update the workstation with summaries/);
  assert.equal(await page.locator('[data-summary-settings] [name="messagesN"]').inputValue(),'12');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,settingsDefaults:true,settingsRestart:true,proposalAccept:true,proposalDismiss:true,workbenchEffects:true,undo:true,userEditConflict409:true,english:true,screenshots:screenshotPaths,paidRequests:0}));
  }
}finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
