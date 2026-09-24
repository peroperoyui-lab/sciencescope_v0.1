// Marks (标记) UI smoke: anchored selection popover, consecutive marks, the
// composer "标记 N" popover (定位/修改/移除/全部清除), real file preview marks,
// secretary target and send compilation through the production router.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'marks-ui-'));
const answer='First paragraph **alpha** evidence.\n\nSecond paragraph beta claim.';
let browser,server,debugPage;const calls=[],errors=[];
const host={capabilities:{tokenStreaming:true},listProviders:async()=>[{id:'fixture',name:'Fixture',models:['one']}],getModelInfo:async()=>({}),getRuntimeConfig:async()=>({}),startSession:async({sessionId})=>sessionId||'session-1',configurePolicy:async()=>{},configureReasoning:async()=>{},observeSession:()=>()=>{},getContextUsage:async()=>null,releaseSession:async()=>{},close:async()=>{},send:async({text,onEvent})=>{calls.push(text);onEvent({type:'text-delta',delta:answer});onEvent({type:'completed',text:answer});}};
const select=(page,selector,index=0)=>page.evaluate(({selector,index})=>{const node=document.querySelectorAll(selector)[index];const range=document.createRange();range.selectNodeContents(node);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const r=node.getBoundingClientRect();node.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:r.left+10,clientY:r.bottom}));},{selector,index});
const count=page=>page.evaluate(()=>document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.trim()||'');
try{
  server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:host});
  const response=await apiFetch(server,'api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chatId:'source',projectId:null,text:'Source question',model:{providerId:'fixture',modelId:'one'},userMessageId:'source-user',assistantMessageId:'source-answer'})});await response.text();assert.equal(response.status,200);
  const imported=await apiFetch(server,'api/library/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'notes.md',base64:Buffer.from('# Notes\n\nPara one gamma.\n\nPara two delta.').toString('base64'),projectId:null})});const resource=await imported.json();assert.equal(imported.status,200);
  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,viewport:{width:1360,height:860},executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',env:{...process.env,TEMP:root,TMP:root}});
  const page=await browser.newPage();debugPage=page;await installApiToken(page,server);page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url);
  await page.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeResearchInput&&window.ScienceScopePreview);
  await page.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('source');});
  await page.waitForSelector('#message-source-answer .message-text p');
  await page.locator('[data-draft="main"]').fill('my draft');await page.locator('[data-draft="main"]').dispatchEvent('input');
  await page.evaluate(()=>{document.querySelector('.messages').__marksTag=1;document.querySelector('[data-draft="main"]').__marksTag=1;});
  // Two consecutive marks from the transcript, no dialog in between.
  await select(page,'#message-source-answer .message-text p',0);
  await page.locator('[data-research-selection] [data-mark-comment]').fill('n1');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.trim()==='标记 1');
  await select(page,'#message-source-answer .message-text p',1);
  await page.locator('[data-research-selection] [data-add]').click();
  await page.waitForFunction(()=>document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.trim()==='标记 2');
  assert.equal(await page.locator('dialog').count(),0);
  // File preview mark.
  await page.evaluate(id=>window.ScienceScopePreview.open(id),resource.id);
  await page.waitForSelector('.file-preview-panel h2:text("文件预览与标记")');
  await page.waitForFunction(()=>document.querySelectorAll('.file-preview-panel [data-preview-doc] p').length===2);
  assert.equal(await page.locator('.file-preview-panel [data-preview-resource]').inputValue(),resource.id);
  await select(page,'.file-preview-panel [data-preview-doc] p',1);
  await page.locator('[data-research-selection] [data-mark-comment]').fill('n3');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.trim()==='标记 3');
  assert.ok(await page.evaluate(()=>CSS.highlights.has('ss-marks')),'annotation highlighted in preview');
  const same=await page.evaluate(()=>({messages:document.querySelector('.messages').__marksTag,draft:document.querySelector('[data-draft="main"]').__marksTag,value:document.querySelector('[data-draft="main"]').value}));
  assert.deepEqual(same,{messages:1,draft:1,value:'my draft'},'transcript and composer not remounted, draft kept');
  // Popover contents.
  await page.locator('[data-composer="main"] [data-marks-toggle]').click();
  await page.waitForSelector('.marks-popover .mark-item');
  const items=await page.$$eval('.marks-popover .mark-item',nodes=>nodes.map(n=>({source:n.querySelector('.mark-origin').textContent.trim(),text:n.querySelector('.mark-text').textContent,note:n.querySelector('.mark-note').textContent})));
  assert.equal(items.length,3);
  assert.deepEqual(items.map(i=>i.note),['n1','无备注','n3']);
  assert.equal(items[0].text,'First paragraph alpha evidence.');
  assert.ok(!/Joy/.test(items[0].source)&&items[0].source.length>0,items[0].source);
  assert.equal(items[2].source,'notes.md · 第 3 段');
  // 修改: inline edit, revision+1.
  await page.locator('.marks-popover .mark-item').nth(1).locator('[data-mark-action="edit"]').click();
  await page.locator('.marks-popover [data-mark-note]').fill('edited');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelectorAll('.marks-popover .mark-note')[1]?.textContent==='edited');
  const edited=await page.evaluate(async()=>(await window.ScienceScopeResearchInput.capture('main',V.chat)).messageQuotes[1]);
  assert.equal(edited.comment,'edited');assert.equal(edited.revision,1);
  // 定位 quote: flash the source message.
  await page.locator('.marks-popover .mark-item').nth(0).locator('[data-mark-action="locate"]').click();
  await page.waitForSelector('.marks-popover',{state:'detached'});
  await page.waitForSelector('#message-source-answer.msg-target');
  // 定位 annotation: preview focus highlight.
  await page.locator('[data-composer="main"] [data-marks-toggle]').click();
  await page.locator('.marks-popover .mark-item').nth(2).locator('[data-mark-action="locate"]').click();
  await page.waitForFunction(()=>CSS.highlights.has('ss-mark-focus'));
  // Esc and outside click close.
  await page.locator('[data-composer="main"] [data-marks-toggle]').click();await page.waitForSelector('.marks-popover');
  await page.keyboard.press('Escape');await page.waitForSelector('.marks-popover',{state:'detached'});
  await page.locator('[data-composer="main"] [data-marks-toggle]').click();await page.waitForSelector('.marks-popover');
  await page.mouse.click(700,120);await page.waitForSelector('.marks-popover',{state:'detached'});
  // 移除.
  await page.locator('[data-composer="main"] [data-marks-toggle]').click();
  await page.locator('.marks-popover .mark-item').nth(1).locator('[data-mark-action="remove"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.marks-popover .mark-item').length===2);
  assert.equal(await count(page),'标记 2');
  await page.keyboard.press('Escape');
  // Send: text + all current marks.
  await page.locator('[data-draft="main"]').fill('Analyze marks');await page.locator('[data-draft="main"]').dispatchEvent('input');
  await page.locator('[data-composer="main"] [data-v="send"]').click();
  await page.waitForFunction(()=>!V.pending.has(V.chat)&&S.messages.some(m=>m.role==='user'&&m.text==='Analyze marks'));
  const sent=calls.at(-1);
  assert.ok(sent.startsWith('Analyze marks\n[User-provided research material]'));
  assert.match(sent,/<quote [^>]*source-message="source-answer"[^>]*>\nFirst paragraph alpha evidence\.\n<comment>n1<\/comment>\n<\/quote>/);
  assert.match(sent,/<annotation [^>]*title="notes\.md"[^>]*location="第 3 段">\n<selected>Para two delta\.<\/selected>\n<comment>n3<\/comment>\n<\/annotation>/);
  assert.ok(!sent.includes('Second paragraph beta claim.\n'),'removed mark not sent');
  await page.waitForFunction(()=>!document.querySelector('[data-composer="main"] [data-marks-toggle]'));
  await page.waitForSelector('.research-receipt');
  assert.equal((await page.locator('.research-receipt summary').last().textContent()).trim(),'标记 2 条');
  // Secondary target: quote to the task secretary lands in the secretary composer.
  await select(page,'#message-source-answer .message-text p',0);
  await page.locator('[data-research-selection] .mark-secondary',{hasText:'引用至任务秘书'}).click();
  await page.waitForFunction(()=>document.querySelector('.assistant-composer [data-marks-toggle]')?.textContent.trim()==='标记 1');
  await page.locator('.assistant-composer [data-marks-toggle]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.marks-popover .mark-item').length===1);
  await page.locator('.marks-popover [data-mark-action="clear"]').click();
  await page.waitForFunction(()=>!document.querySelector('.assistant-composer [data-marks-toggle]')&&!document.querySelector('.marks-popover'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({consecutiveMarks:true,noDialog:true,noRemount:true,previewMark:true,popover:true,edit:true,locateQuote:true,locateAnnotation:true,remove:true,escOutside:true,sendIncludesAllMarks:true,receipt:true,secretaryTarget:true,clearAll:true,paidRequests:0}));
}catch(error){console.error({errors,ui:await debugPage?.evaluate(()=>({dialogs:document.querySelectorAll('dialog').length,toast:document.querySelector('.toast')?.textContent,chat:V.chat,panel:V.panel})).catch(()=>null)});throw error;}finally{await browser?.close();await server?.close();await rm(root,{recursive:true,force:true});}
