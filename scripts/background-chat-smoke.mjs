import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'background-ui-'));
let release,more,browser;
const gate=new Promise(resolve=>release=resolve);
const host={capabilities:{tokenStreaming:true},listProviders:async()=>[],close:async()=>{},
  startSession:async()=> 'background-session',getGoal:async()=>null,
  configurePolicy:async()=>{},configureReasoning:async()=>{},observeSession:()=>()=>{},releaseSession:async()=>{},
  async send({onEvent}) {
    onEvent({type:'text-delta',delta:'FIRST_PART'});
    more=()=>onEvent({type:'text-delta',delta:'_BACKGROUND_PART'});
    await gate;
    onEvent({type:'completed',text:'FIRST_PART_BACKGROUND_PART_FINISHED'});
  },
};
const server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:host});
try{
  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,
    viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root},
  });
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url);
  await page.waitForFunction(()=>window.ScienceScopeActivity&&window.ScienceScopeWorkspace?.ready);
  await page.evaluate(()=>window.ScienceScopeWorkspace.ready);
  await page.evaluate(()=>{window.ScienceScopeModels={available:()=>true,selected:()=>({providerId:'fixture',modelId:'fixture'}),select:()=>{}};window.running=window.SS.submitMain('HOLD_A');});
  await page.waitForFunction(()=>S.messages.some(message=>message.text==='FIRST_PART'));
  const chatId=await page.evaluate(()=>V.chat);
  await page.locator('[data-route="quick"]').first().click();
  await page.locator('[data-draft="main"]').fill('B_DRAFT_KEEP');
  const row=page.locator(`[data-object="chat"][data-object-id="${chatId}"]`).first();
  await page.waitForFunction(id=>document.querySelector(`[data-object-id="${id}"] .chat-activity-badge`)?.dataset.state==='running',chatId);
  assert.equal(await page.locator('.background-activity-summary').count(),1);
  more();
  await page.waitForFunction(id=>chatData[id]?.messages.some(message=>message.text.includes('BACKGROUND_PART')),chatId);
  assert.equal(await page.locator('[data-draft="main"]').inputValue(),'B_DRAFT_KEEP');
  assert.equal(await page.locator('.message-text').count(),0,'background text must not appear in the new chat');
  await row.locator('[data-v="select-chat"]').click();
  await page.waitForFunction(()=>S.messages.some(message=>message.text==='FIRST_PART_BACKGROUND_PART'));
  assert.equal(await page.locator('[data-main-stop]').count(),1);
  await page.locator('[data-route="quick"]').first().click();
  assert.equal(await page.locator('[data-draft="main"]').inputValue(),'B_DRAFT_KEEP');
  release();await page.evaluate(()=>window.running);
  await page.waitForFunction(id=>document.querySelector(`[data-object-id="${id}"] .chat-activity-badge`)?.dataset.state==='completed',chatId);
  await page.locator(`[data-object-id="${chatId}"] [data-v="select-chat"]`).first().click();
  await page.waitForFunction(()=>S.messages.some(message=>message.text==='FIRST_PART_BACKGROUND_PART_FINISHED'));
  assert.equal(await page.locator('[data-main-stop]').count(),0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({backgroundStatus:true,partialResume:true,completionBadge:true,otherDraftPreserved:true,noCrossChatOutput:true,paidRequests:0}));
}finally{release();await browser?.close();await server.close();await rm(root,{recursive:true,force:true});}
