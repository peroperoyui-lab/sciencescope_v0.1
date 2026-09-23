// Exercise the real desktop asset router, not a permissive fixture file server.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'navigation-'));
let browser;
let sends=0;
let usedTokens=1250;
const host={
  capabilities:{tokenStreaming:true},listProviders:async()=>[],
  close:async()=>{},startSession:async()=>`fixture-${++sends}`,
  configurePolicy:async()=>{},configureReasoning:async()=>{},
  observeSession:()=>()=>{},releaseSession:async()=>{},
  getGoal:async()=>null,getContextUsage:async()=>({usedTokens,contextWindow:5000,estimated:true}),
  send:async({onEvent})=>{onEvent({type:'text-delta',delta:'LOCAL_REPLY'});onEvent({type:'completed',text:'LOCAL_REPLY'});},
};
const server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:host});
try {
  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true,viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root},
  });
  const page=await browser.newPage(),errors=[],dialogs=[],missing=[];
  await installApiToken(page,server);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{dialogs.push(dialog.type());void dialog.dismiss();});
  page.on('response',response=>{if(response.status()===404&&response.url().includes('/desktop/'))missing.push(response.url());});
  await page.goto(server.url);
  await page.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeOutbox);
  await page.evaluate(()=>window.ScienceScopeWorkspace.ready);
  await page.evaluate(()=>{window.ScienceScopeModels={available:()=>true,selected:()=>({providerId:'fixture',modelId:'fixture'})};});
  await page.locator('[data-route="quick"]').first().click();
  const first=await page.evaluate(()=>V.chat);
  await page.locator('[data-draft="main"]').fill('第一条消息');
  await page.locator('[data-v="send"][data-scope="main"]').click();
  await page.waitForFunction(()=>S.messages.some(m=>m.text==='LOCAL_REPLY')&&!V.pending.has(V.chat));
  const persisted=await (await apiFetch(server,'api/chats')).json();
  assert.equal(persisted.chats.length,1);
  assert.equal(persisted.chats[0].id,first);
  await page.waitForFunction(()=>document.querySelector('[data-usage="main"]')?.style.getPropertyValue('--context-pct')==='25%');
  usedTokens=2500;
  await page.waitForFunction(()=>document.querySelector('[data-usage="main"]')?.style.getPropertyValue('--context-pct')==='50%');
  usedTokens=500;
  await page.waitForFunction(()=>document.querySelector('[data-usage="main"]')?.style.getPropertyValue('--context-pct')==='10%');
  await page.locator('[data-route="quick"]').first().click();
  assert.notEqual(await page.evaluate(()=>V.chat),first);
  assert.equal(await page.locator('[data-draft="main"]').inputValue(),'');
  assert.equal(await page.locator('[data-usage="main"]').getAttribute('data-context-known'),'false');
  assert.equal((await (await apiFetch(server,'api/chats')).json()).chats.length,1,'draft alone does not create a durable chat');
   assert.equal(await page.evaluate(()=>{
     const target=document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
     const event=new KeyboardEvent('keydown',{key:'F5',bubbles:true,cancelable:true});
     target.dispatchEvent(event);
     return event.defaultPrevented;
   }),true);
  await page.evaluate(()=>openPanel('browser'));
  assert.match(await page.locator('.browser-panel').innerText(),/尚未接入/);
  assert.equal(await page.locator('.browser-document').count(),0);
  await page.evaluate(()=>openPalette());
  await page.locator('#command-query').fill('LOCAL_REPLY');
  await page.waitForFunction(()=>paletteMatches.some(item=>item.category.startsWith('对话 ·')));
  await page.locator('#command-results button').filter({hasText:'LOCAL_REPLY'}).last().click();
  await page.waitForFunction(()=>S.messages.some(m=>m.text==='LOCAL_REPLY'));
  assert.equal(await page.evaluate(()=>V.chat),first);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);assert.deepEqual(missing,[]);
  console.log(JSON.stringify({productionRouter:true,newChat:true,firstSendPersists:true,noBrowserDialogs:true,noDemoBrowser:true,contextRingIncreasesAndDecreases:true,module404s:0,paidRequests:0}));
}finally{await browser?.close();await server.close();await rm(root,{recursive:true,force:true});}
