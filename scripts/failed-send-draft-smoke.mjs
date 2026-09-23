// Offline browser smoke: a Main turn that fails after acceptance gives its text
// back to the composer for retry, without overwriting text typed during the run.
// Browser: SCIENCESCOPE_BROWSER, else installed Edge (Windows default).
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
const failure = '模型服务找不到所选模型；请在模型设置中确认模型 ID 仍然可用。';
let requests = 0;
let release;
let gate = Promise.resolve();
const json = (res,body) => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req,res) => {
  if(req.url.startsWith('/api/research-input/draft')){for await(const _ of req){}return json(res,{attachmentIds:[],messageQuotes:[],annotations:[],contextRefs:[]});}
  if(req.url==='/api/workspace')return json(res,{projects:[],pins:[],projectExpanded:{},lastChatId:null});
  if(req.url==='/api/chats')return json(res,{chats:[]});
  if(req.url.startsWith('/api/chats/'))return json(res,{chat:{},messages:[],total:0,before:null,after:null});
  if(req.url==='/api/status')return json(res,{available:false});
  if(req.url.startsWith('/api/chat/outbox')){for await(const _ of req){}return json(res,{paused:false,items:[]});}
  if(req.url==='/api/chat') {
    requests++;
    for await(const _ of req){}
    res.writeHead(200,{'Content-Type':'application/x-ndjson'});
    res.write(JSON.stringify({type:'accepted'})+'\n');
    await gate;
    res.end(JSON.stringify({type:'failed',message:failure})+'\n'); return;
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
  browser = await chromium.launchPersistentContext(path.join(output,'failed-send-profile'), {
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
    window.ScienceScopeModels = {available:()=>true,selected:()=>({providerId:'offline',modelId:'missing-model'})};
    S.annotations=[]; S.contextRefs=[]; S.messages=[]; saveThread(); go('work');
  });
  const input = page.locator('textarea[data-draft="main"]');

  // 1. Failure with an untouched composer: the sent text comes back.
  await input.fill('第一次发送：应在失败后回到输入框');
  assert.equal(await page.evaluate(()=>window.SS.submitMain(S.drafts.main||document.querySelector('[data-draft="main"]').value)),false);
  assert.equal(await input.inputValue(),'第一次发送：应在失败后回到输入框');
  assert.equal(await page.evaluate(()=>S.drafts.main),'第一次发送：应在失败后回到输入框');
  assert.equal(await page.locator('[data-main-stop]').count(),0,'send button restored');

  // 2. Failure while the user has typed something new: keep the new text.
  let open; gate = new Promise(resolve=>{release=resolve;open=true;});
  await input.fill('第二次发送');
  await page.evaluate(()=>{window.secondSend=window.SS.submitMain(document.querySelector('[data-draft="main"]').value);});
  await page.waitForFunction(()=>document.querySelector('[data-draft="main"]').value==='');
  await input.fill('运行期间新写的草稿');
  await page.evaluate(()=>{const el=document.querySelector('[data-draft="main"]');S.drafts.main=el.value;});
  release();
  assert.equal(await page.evaluate(()=>window.secondSend),false);
  assert.equal(await input.inputValue(),'运行期间新写的草稿');
  assert.ok(open);

  assert.deepEqual(errors,[]);
  assert.equal(requests,2);
  console.log(JSON.stringify({failedSendRestoresDraft:true,newerDraftPreserved:true,localRequests:requests,realProviderRequests:0}));
} finally {
  release?.(); await browser?.close(); server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}
