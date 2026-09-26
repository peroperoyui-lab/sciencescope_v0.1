// Explicit, entirely offline browser smoke. Uses installed Edge; no browser download.
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { buildDesktop } from './build-desktop.mjs';
import { defaultRoot } from './prepare-desktop.mjs';

const entry = await buildDesktop();
const output = path.join(defaultRoot,'.sciencescope-local','temp','ui-smoke');
await mkdir(output,{recursive:true});
process.env.TEMP=output;process.env.TMP=output;
let finishReply;
const replyGate = new Promise(resolve => { finishReply = resolve; });
const text = '# 流式排版验收\n\n这是**第一段**。\n\n- 文献检索\n- 方法核查\n\n```python\nprint("SCIENCESCOPE_OK")\n```\n\n| 检查 | 结果 |\n| --- | --- |\n| Markdown | 正常 |\n\n';
let requests = 0;
let activeReply;
let stopRequests=0;
let secondRelease;
const secondGate=new Promise(resolve=>{secondRelease=resolve;});
let thirdRelease;
const thirdGate=new Promise(resolve=>{thirdRelease=resolve;});
const outbox={paused:false,items:[]};
const server = http.createServer(async (req,res) => {
  if(req.url.startsWith('/api/research-input/draft')){for await(const _ of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({attachmentIds:[],messageQuotes:[],annotations:[],contextRefs:[]}));return;}
  if(req.url==='/api/workspace') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({projects:[],pins:[],projectExpanded:{},lastChatId:null}));return;}
  if(req.url==='/api/chats') {res.setHeader('Content-Type','application/json');res.end('{"chats":[]}');return;}
  if(req.url.startsWith('/api/chats/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({chat:{},messages:[],total:2,before:null,after:null}));return;}
  if (req.url === '/api/status') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({available:false})); return; }
  if(req.url.startsWith('/api/chat/outbox')) {
    if(req.method==='POST') {
      let raw='';for await(const chunk of req)raw+=chunk;
      const body=JSON.parse(raw);
      if(body.action==='enqueue')outbox.items.push({id:'outbox-fixture',status:'queued',input:body.input});
      if(body.action==='pause')outbox.paused=true;
      if(body.action==='resume')outbox.paused=false;
      if(body.action==='cancel')outbox.items=outbox.items.filter(item=>item.id!==body.id);
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(outbox));return;
  }
  if(req.url==='/api/chat/stop') {
    stopRequests++;
    for await(const _ of req){}
    res.setHeader('Content-Type','application/json');res.end('{"stopping":true}');
    secondRelease();return;
  }
  if (req.url === '/api/chat') {
    requests++;
    let raw='';for await(const chunk of req)raw+=chunk;
    const sent=JSON.parse(raw);
    if(sent.outboxId)outbox.items=outbox.items.filter(item=>item.id!==sent.outboxId);
    res.writeHead(200,{'Content-Type':'application/x-ndjson'});
    activeReply=res;
    res.write(JSON.stringify({type:'accepted'})+'\n');
    res.write(JSON.stringify({type:'text-delta',delta:text})+'\n');
    if(requests===2) {
      await secondGate;
      res.end(JSON.stringify({type:'cancelled',text})+'\n');return;
    }
    if(requests===3)await thirdGate;
    await replyGate;
    res.write(JSON.stringify({type:'text-delta',delta:'最后一段。'})+'\n');
    res.end(JSON.stringify({type:'completed'})+'\n'); return;
  }
  try {
    const url = new URL(req.url,'http://localhost');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(path.dirname(entry),relative);
    if (!file.startsWith(path.dirname(entry)+path.sep)) throw new Error('Invalid asset');
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser = await chromium.launchPersistentContext(path.join(output,'edge-profile'), {
    executablePath:process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    headless:true, viewport:{width:1440,height:960},
    env:{...process.env,TEMP:output,TMP:output},
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.ScienceScopeModels && window.SSV2);
  await page.evaluate(()=>window.ScienceScopeWorkspace.ready);
  await page.evaluate(()=>{
    window.ScienceScopeModels = {available:()=>true,selected:()=>({providerId:'offline',modelId:'offline-model'})};
    S.annotations=[]; S.contextRefs=[]; S.messages=[]; saveThread(); go('work');
    window.smokeSend = window.SS.submitMain('请展示排版。');
  });
  try { await page.waitForSelector('.rendered-markdown h1'); }
  catch(error) {
    console.error(JSON.stringify({errors,requests,state:await page.evaluate(()=>({route,chat:V.chat,messages:S.messages,pending:[...V.pending]}))}));
    throw error;
  }
  assert.equal(await page.locator('.rendered-markdown pre code').innerText(),'print("SCIENCESCOPE_OK")\n');
  assert.equal(await page.locator('.rendered-markdown table tbody tr').count(),1);
  assert.equal(await page.locator('.rendered-markdown li').count(),2);
  assert.equal(await page.locator('.rendered-markdown pre').evaluate(el=>getComputedStyle(el).borderRadius),'12px');
  assert.equal(await page.locator('.message[data-streaming]').count(),1);
  assert.equal(await page.locator('[data-main-stop]').count(),1);
  await page.locator('.messagebody').last().evaluate(el=>el.style.minHeight='1800px');
  await page.locator('.messages').evaluate(el=>el.scrollTop=0);
  activeReply.write(JSON.stringify({type:'tool-call',callId:'call-1',name:'read',argumentsPreview:'local fixture file'})+'\n');
  await page.waitForSelector('.turn-activity');
  assert.equal(await page.locator('.messages').evaluate(el=>el.scrollTop),0);
  assert.equal(await page.locator('.turn-activity').count(),1);
  assert.equal(await page.locator('.message.receipt').count(),0);
  await page.locator('.turn-activity > summary').click();
  await page.locator('[data-tool-call] > summary').click();
  activeReply.write(JSON.stringify({type:'tool-result',callId:'call-1',resultPreview:'fixture result',isError:false})+'\n');
  await page.waitForFunction(()=>document.querySelector('.turn-activity')?.textContent.includes('fixture result'));
  assert.equal(await page.locator('.turn-activity[open]').count(),1);
  assert.match(await page.locator('.turn-activity').innerText(),/fixture result/);
  const input = page.locator('textarea[data-draft="main"]');
  await input.fill('下一条草稿，不应因流式刷新丢失');
  await input.focus();
  await page.screenshot({path:path.join(output,'streaming-markdown.png')});
  finishReply();
  assert.equal(await page.evaluate(()=>window.smokeSend),true);
  assert.equal(await input.inputValue(),'下一条草稿，不应因流式刷新丢失');
  assert.equal(await input.evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('.message[data-streaming]').count(),0);
  assert.match(await page.locator('.rendered-markdown').last().innerText(),/最后一段/);
  assert.equal(await page.locator('[data-main-stop]').count(),0);
  assert.equal(await page.locator('.turn-activity[open]').count(),1,'user-expanded details stay open after completion');
  await page.evaluate(()=>{window.smokeSecond=window.SS.submitMain('请等待停止。');});
  await page.waitForSelector('[data-main-stop]');
  await page.waitForFunction(()=>S.messages.filter(m=>m.role==='assistant').length===2);
  await page.locator('[data-main-stop]').click();
  assert.equal(await page.evaluate(()=>window.smokeSecond),true);
  assert.equal(stopRequests,1);
  assert.equal(await page.locator('[data-main-stop]').count(),0);
  await page.evaluate(()=>{window.smokeThird=window.SS.submitMain('第三轮。');});
  await page.waitForFunction(()=>S.messages.filter(m=>m.role==='assistant').length===3);
  await page.locator('textarea[data-draft="main"]').fill('排队的第四轮');
  await page.locator('textarea[data-draft="main"]').press('Enter');
  await page.waitForFunction(()=>document.querySelector('.main-outbox')?.textContent.includes('排队的第四轮'));
  assert.equal(outbox.items.length,1);
  assert.equal(await page.locator('textarea[data-draft="main"]').inputValue(),'');
  await page.locator('textarea[data-draft="main"]').fill('后写草稿不能被排队发送清除');
  thirdRelease();
  await page.evaluate(()=>window.smokeThird);
  await page.waitForFunction(()=>S.messages.filter(m=>m.role==='assistant').length===4&&!V.pending.has(V.chat));
  assert.equal(outbox.items.length,0);
  assert.equal(await page.locator('textarea[data-draft="main"]').inputValue(),'后写草稿不能被排队发送清除');
  const sanitized = await page.evaluate(()=>markdown('<script>alert(1)</script><button data-v="send">bad</button>[bad](javascript:alert(1))<img src="https://example.com/track">'));
  assert.doesNotMatch(sanitized,/<script|<button|data-v|href=["']javascript:|<img/i);
  assert.deepEqual(errors,[]);
  assert.equal(requests,4);
  console.log(JSON.stringify({markdown:true,incrementalBeforeCompletion:true,draftAndFocusPreserved:true,toolGroupingAndDetails:true,readingPositionPreserved:true,stopButton:true,queuedSend:true,localRequests:requests,realProviderRequests:0}));
} finally {
  finishReply(); secondRelease(); thirdRelease(); await browser?.close(); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
