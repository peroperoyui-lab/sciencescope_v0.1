import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'research-input-ui-'));
let browser,server,debugPage;const calls=[],errors=[];
try{
  server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:{capabilities:{tokenStreaming:true},listProviders:async()=>[{id:'fixture',name:'Fixture',models:['one']}],getModelInfo:async()=>({}),getRuntimeConfig:async()=>({}),startSession:async({sessionId,noTools})=>noTools?'session-minutes':sessionId||'session-1',configurePolicy:async()=>{},configureReasoning:async()=>{},observeSession:()=>()=>{},getContextUsage:async()=>null,releaseSession:async()=>{},close:async()=>{},send:async({sessionId,text,onEvent})=>{if(sessionId==='session-minutes')return {finalResponse:'MINUTES'};/* the secretary's background minutes */calls.push(text);onEvent({type:'text-delta',delta:'Research **bold** source tail'});onEvent({type:'completed',text:'Research **bold** source tail'});}}});
  const response=await apiFetch(server,'api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:'source',projectId:null,text:'Source question',model:{providerId:'fixture',modelId:'one'},userMessageId:'source-user',assistantMessageId:'source-answer'})});await response.text();assert.equal(response.status,200);
  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',env:{...process.env,TEMP:root,TMP:root}});
  const page=await browser.newPage();debugPage=page;await installApiToken(page,server);page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url);
  await page.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeResearchInput);
  await page.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('source');});
  await page.waitForSelector('#message-source-answer .message-text');
  await page.evaluate(()=>{const node=document.querySelector('#message-source-answer .message-text p');const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:500,clientY:250}));});
  // Anchored mark popover (no dialog): note + Enter adds the quote to the main draft.
  await page.locator('[data-research-selection] [data-mark-comment]').fill('Check this exact excerpt');await page.keyboard.press('Enter');
  await page.waitForSelector('[data-research-selection]',{state:'detached'});assert.equal(await page.locator('dialog').count(),0);
  await page.waitForFunction(()=>document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.trim()==='标记 1');
  await page.evaluate(()=>window.ScienceScopeResearchInput.attachFiles([new File(['EVIDENCE_ROW_42'],'研究 材料.csv',{type:'text/csv'})]));
  // Attachment chip -> preview; select text in the real preview and add an annotation mark.
  await page.locator('[data-research-edit="attachmentIds"]').click();await page.locator('[data-attachment-menu] [data-do="preview"]').click();
  // T04 renders CSV as table cells; retain the same selected bytes, line
  // provenance, outgoing input and persisted receipt assertions below.
  await page.waitForFunction(()=>document.querySelector('.file-preview-panel [data-preview-doc] td')?.textContent==='EVIDENCE_ROW_42');
  // The panel slides open; text is not selectable until it is visible (intermittent empty selection, 2026-09-27).
  await page.waitForFunction(()=>{const panel=document.querySelector('.file-preview-panel');return getComputedStyle(panel).visibility==='visible'&&panel.getAnimations({subtree:true}).every(a=>a.playState!=='running')&&document.querySelector('.file-preview-panel td').checkVisibility({visibilityProperty:true,opacityProperty:true});});
  // Select like a user (triple-click the cell): the synthetic addRange was
  // intermittently ignored by Chromium here, leaving an empty selection.
  await page.locator('.file-preview-panel td').click({clickCount:3});
  await page.locator('[data-research-selection] [data-mark-comment]').fill('Verify this row');await page.locator('[data-research-selection] [data-add]').click();
  await page.waitForFunction(()=>document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.trim()==='标记 2');
  await page.locator('[data-draft="main"]').fill('Analyze attached evidence');await page.locator('[data-draft="main"]').dispatchEvent('input');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(()=>!V.pending.has(V.chat)&&S.messages.some(m=>m.role==='user'&&m.text==='Analyze attached evidence'));
  assert.equal(calls.length,2);
  const block=calls[1].split('[User-provided research material]\n')[1].split('\n[End user-provided research material]')[0];
  assert.match(block,/<quote source-chat="[^"]+" source-message="source-answer" speaker="assistant">\nResearch bold source tail\n<comment>Check this exact excerpt<\/comment>\n<\/quote>/);
  assert.match(block,/<annotation [^>]*location="第 1 行">\n<selected>EVIDENCE_ROW_42<\/selected>\n<comment>Verify this row<\/comment>\n<\/annotation>/);
  assert.match(block,/<material [^>]*title="研究 材料\.csv"[^>]*truncated="false">\nEVIDENCE_ROW_42\n<\/material>/);
  await page.waitForFunction(async()=>{const input=await window.ScienceScopeResearchInput.capture('main',V.chat);return input.annotations.length===0&&input.messageQuotes.length===0&&input.attachmentIds.length===0;});
  await page.reload();await page.waitForFunction(()=>window.ScienceScopeWorkspace?.ready);await page.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('source');});await page.waitForSelector('.research-receipt');assert.equal((await page.locator('.research-receipt summary').first().textContent()).trim(),'标记 2 条 · 材料 1 份');assert.equal(await page.locator('.research-receipt .mark-item').count(),2);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({productionRouter:true,realSelectionAcrossMarkdown:true,markPopover:true,previewAnnotation:true,unicodeAttachment:true,annotation:true,actualHostInput:true,ackClearedCaptured:true,receiptReopened:true,paidRequests:0}));
}catch(error){console.error({errors,ui:await debugPage?.evaluate(()=>({dialogs:document.querySelectorAll('dialog').length,toast:document.querySelector('.toast')?.textContent,chat:V.chat})).catch(()=>null)});throw error;}finally{await browser?.close();await server?.close();await rm(root,{recursive:true,force:true});}
