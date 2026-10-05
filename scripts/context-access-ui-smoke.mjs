// T17 browser acceptance: secretary follow-up status, global focus controls,
// translated overview hint, and four language/theme screenshots. Offline only.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';

const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'context-access-ui-'));
const output=path.join(base,'t17-validation','context-access-ui');await mkdir(output,{recursive:true});
let session=0;
const host={
  capabilities:{tokenStreaming:true},close:async()=>{},observeSession:()=>()=>{},setToolHandler:()=>{},
  listProviders:async()=>[{id:'offline',name:'Offline',models:['m'],configured:true,saved:true}],getRuntimeConfig:async()=>({}),getModelInfo:async()=>({}),getContextUsage:async()=>null,getGoal:async()=>null,
  startSession:async({sessionId})=>sessionId||`session-context-${++session}`,configurePolicy:async()=>{},configureReasoning:async()=>{},configureBrief:async()=>{},releaseSession:async()=>{},
  send:async({onEvent})=>{onEvent?.({type:'completed',text:'LOCAL_CONTEXT_OK'});return {finalResponse:'LOCAL_CONTEXT_OK'};},
};
const server=await createDesktopServer({dataRoot:path.join(root,'app'),outputDir:path.join(root,'assets'),runtimeHost:host});
const model={providerId:'offline',modelId:'m'};
async function post(route,body){const response=await apiFetch(server,'/api/'+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200,`${route}: ${await response.clone().text()}`);return response;}
async function mainTurn(index,text){const response=await apiFetch(server,'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chatId:'context-main',projectId:'context-project',title:'上下文访问验收',model,text,userMessageId:`context-user-${index}`,assistantMessageId:`context-answer-${index}`})});const body=await response.text();assert.equal(response.status,200,body);}
let browser;
try{
  // This T17 fixture checks verbatim catch-up without an existing minutes
  // revision. T18's default project-entry summaries are covered separately;
  // disable only the project-focus triggers for this isolated scenario.
  const preferences=await (await apiFetch(server,'/api/secretary/preferences')).json();
  await post('secretary/preferences',{summary:{...preferences.summary,onEnterProject:false,onLeaveProject:false}});
  await post('workspace',{projects:[{id:'context-project',name:'上下文访问项目',desc:''}],pins:[],projectExpanded:{'context-project':true},lastChatId:'context-main'});
  await post('roles/save',{role:'secretary',config:{prompt:'Offline secretary',model,reasoningEffort:null}});
  await post('roles/save',{role:'global',config:{prompt:'Offline global assistant',model,reasoningEffort:null}});
  await mainTurn(1,'第一轮：主要终点是可复现的上下文访问。');
  await mainTurn(2,'第二轮：检查秘书跟进位置。');

  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root}});
  const consoleMessages=[];const pageErrors=[];
  const watch=page=>{page.on('console',message=>{if(['warning','error'].includes(message.type()))consoleMessages.push({type:message.type(),text:message.text(),url:message.location().url,line:message.location().lineNumber,column:message.location().columnNumber});});page.on('pageerror',error=>pageErrors.push(error.message));};
  const main=await browser.newPage();watch(main);await installApiToken(main,server);await main.goto(server.url);
  await main.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeAssistants);
  await main.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('context-main');openPanel('secretary');});
  await main.waitForFunction(()=>window.ScienceScopeAssistants.entry('secretary','context-main').loaded);
  assert.match(await main.locator('[data-follow-up]').innerText(),/已跟进到主对话第 0 条 · 纪要第 0 版/);
  const secretaryInput=main.locator('[data-assistant-input]');await secretaryInput.fill('现在进行到哪一步？');await secretaryInput.press('Enter');
  await main.waitForFunction(()=>!window.ScienceScopeAssistants.entry('secretary','context-main').sending&&window.ScienceScopeAssistants.entry('secretary','context-main').followUp?.seenOrdinal===4);
  assert.match(await main.locator('[data-follow-up]').innerText(),/已跟进到主对话第 4 条 · 纪要第 0 版/);
  assert.equal(await main.locator('[data-assistant-action="context"]').count(),0,'secretary has no obsolete conversation-reference menu');

  const global=await browser.newPage();watch(global);await installApiToken(global,server);await global.goto(server.url+'?surface=assistant');
  await global.waitForFunction(()=>window.ScienceScopeAssistants?.entry('global').loaded);
  const combinations=[['zh-CN','light','zh-light.png'],['zh-CN','dark','zh-dark.png'],['en','light','en-light.png'],['en','dark','en-dark.png']];
  const secretaryScreenshots=[];
  for(const [language,theme,file] of combinations){
    await post('preferences',{language,theme});await global.reload();
    await global.waitForFunction(({language,theme})=>document.documentElement.lang===(language==='en'?'en':'zh-CN')&&document.documentElement.dataset.theme===theme,{language,theme});
    const contextButton=global.locator('[data-assistant-action="context"]');
    const placeholder=await global.locator('[data-assistant-input]').getAttribute('placeholder');
    if(language==='en')assert.match(placeholder,/Which projects have pending tasks/);else assert.match(placeholder,/哪些项目还有待办/);
    await contextButton.click();await global.locator('[data-assistant-action="choose-context"][data-chat="context-main"]').click();
    if(language==='en')assert.match(await contextButton.innerText(),/Conversation selected/);else assert.match(await contextButton.innerText(),/已指定对话/);
    await global.screenshot({path:path.join(output,file),fullPage:true});
    await main.reload();await main.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeAssistants);
    await main.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('context-main');openPanel('secretary');});
    await main.waitForFunction(({language,theme})=>document.documentElement.lang===(language==='en'?'en':'zh-CN')&&document.documentElement.dataset.theme===theme&&window.ScienceScopeAssistants.entry('secretary','context-main').loaded,{language,theme});
    const status=await main.locator('[data-follow-up]').innerText();
    if(language==='en')assert.match(status,/Caught up through Main message 4 · Minutes revision 0/);else assert.match(status,/已跟进到主对话第 4 条 · 纪要第 0 版/);
    const secretaryFile='secretary-'+file;secretaryScreenshots.push(path.join(output,secretaryFile));
    await main.screenshot({path:path.join(output,secretaryFile),fullPage:true});
  }
  assert.doesNotMatch(await global.evaluate(()=>String(iconPaths.copy)),/</,'the generated copy icon is path data, not nested SVG markup');
  assert.equal(await global.locator('svg path').evaluateAll(paths=>paths.filter(path=>String(path.getAttribute('d')).includes('<')).length),0,'no rendered SVG path receives markup as its d attribute');
  assert.deepEqual(consoleMessages.filter(message=>/<path> attribute d|Expected moveto path command/.test(message.text)),[],'the copy icon emits no SVG path parse errors');
  assert.deepEqual(pageErrors,[]);
  console.log(JSON.stringify({passed:true,secretaryFollowUp:true,secretaryReferenceRemoved:true,globalFocus:true,overviewHint:true,screenshots:combinations.map(item=>path.join(output,item[2])),secretaryScreenshots,consoleWarnings:consoleMessages}));
}finally{await browser?.close();await server.close();await rm(root,{recursive:true,force:true});}
