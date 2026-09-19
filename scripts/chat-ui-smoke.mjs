// Explicit, entirely offline browser smoke. Uses installed Edge; no browser download.
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { buildDesktop } from './build-desktop.mjs';
import { defaultRoot } from './prepare-desktop.mjs';

const entry = await buildDesktop();
const output = path.join(defaultRoot,'.sciencescope-local','ui-smoke');
await mkdir(output,{recursive:true});
process.env.TEMP=output;process.env.TMP=output;
let finishReply;
const replyGate = new Promise(resolve => { finishReply = resolve; });
const text = '# 流式排版验收\n\n这是**第一段**。\n\n- 文献检索\n- 方法核查\n\n```python\nprint("SCIENCESCOPE_OK")\n```\n\n| 检查 | 结果 |\n| --- | --- |\n| Markdown | 正常 |\n\n';
let requests = 0;
const server = http.createServer(async (req,res) => {
  if(req.url==='/api/workspace') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({projects:[],pins:[],projectExpanded:{},lastChatId:null}));return;}
  if(req.url==='/api/chats') {res.setHeader('Content-Type','application/json');res.end('{"chats":[]}');return;}
  if(req.url.startsWith('/api/chats/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({chat:{},messages:[],total:2,before:null,after:null}));return;}
  if (req.url === '/api/status') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({available:false})); return; }
  if (req.url === '/api/chat') {
    requests++;
    for await (const _ of req) { /* Only local fixed fixture input. */ }
    res.writeHead(200,{'Content-Type':'application/x-ndjson'});
    res.write(JSON.stringify({type:'accepted'})+'\n');
    res.write(JSON.stringify({type:'text-delta',delta:text})+'\n');
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
    executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
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
  assert.equal(await page.locator('.rendered-markdown pre').evaluate(el=>getComputedStyle(el).borderRadius),'8px');
  assert.equal(await page.locator('.message[data-streaming]').count(),1);
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
  const sanitized = await page.evaluate(()=>markdown('<script>alert(1)</script><button data-v="send">bad</button>[bad](javascript:alert(1))<img src="https://example.com/track">'));
  assert.doesNotMatch(sanitized,/<script|<button|data-v|href=["']javascript:|<img/i);
  assert.deepEqual(errors,[]);
  assert.equal(requests,1);
  console.log(JSON.stringify({markdown:true,incrementalBeforeCompletion:true,draftAndFocusPreserved:true,localRequests:requests,realProviderRequests:0}));
} finally {
  finishReply(); await browser?.close(); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
