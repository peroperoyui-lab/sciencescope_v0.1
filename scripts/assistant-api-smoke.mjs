// Offline real-DSH composition: three identities, explicit context, restart, cancel.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,rm,readFile,copyFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createDesktopApi} from './desktop-api.mjs';
import {buildDesktop} from './build-desktop.mjs';
import {chromium} from 'playwright-core';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'assistant-api-'));
const apiToken=randomBytes(32).toString('hex');
const calls=[];let api,server,origin,holdResolve,browser,native,proposalCalled=false;
const nativeMode=process.argv.includes('--native');
const entry=(process.argv.includes('--ui')||nativeMode)?await buildDesktop():null;
const held=new Promise(r=>holdResolve=r);
const fixture=createServer(async(req,res)=>{
  let body='';for await(const c of req)body+=c;const call=JSON.parse(body);calls.push(call);
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  if(!proposalCalled&&JSON.stringify(call.messages.at(-1)).includes('PROPOSE_MAIN_FIXTURE')){
    const tool=call.tools?.find(t=>t.function?.name==='propose_main_draft');
    assert.ok(tool,'registered secretary proposal tool');proposalCalled=true;
    res.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'proposal-call',type:'function',function:{name:tool.function.name,arguments:JSON.stringify({text:'Editable research proposal'})}}]}}]})}\n\n`);
    res.end('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');return;
  }
  res.write('data: {"choices":[{"delta":{"content":"ASSISTANT_FIXTURE_OK"}}]}\n\n');
  if(JSON.stringify(call.messages.at(-1)).includes('HOLD_FOR_STOP')){holdResolve();return;}
  setTimeout(()=>res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'),250);
});
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
async function launch(){api=await createDesktopApi({dataRoot:root,apiToken,onError:error=>{if(process.env.SCIENCESCOPE_FIXTURE_DIAGNOSTICS==='1')console.error(error);}});server=createServer(async(q,r)=>{
  if(await api.handle(q,r))return;
  try{
    const pathname=new URL(q.url,'http://localhost').pathname;
    const file=path.resolve(path.dirname(entry),pathname==='/'?'index.html':pathname.slice(1));
    if(!file.startsWith(path.dirname(entry)+path.sep))throw new Error('outside asset root');
    r.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');r.end(await readFile(file));
  }catch{r.writeHead(404);r.end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}/api/`;}
async function close(){await api?.close();server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));api=null;server=null;}
async function request(route,body){return fetch(origin+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),Authorization:`Bearer ${apiToken}`},body:body?JSON.stringify(body):undefined});}
async function json(route,body){const r=await request(route,body);assert.equal(r.status,200,route);return r.json();}
async function stream(route,body){const r=await request(route,body);assert.equal(r.status,200,route);const events=(await r.text()).trim().split('\n').map(JSON.parse);assert.ok(!events.some(e=>e.type==='failed'),JSON.stringify(events));return events;}
const model={providerId:'sciencescope-assistant-fixture',modelId:'fixture'};
try{
  await launch();
  await json('providers/save',{id:model.providerId,name:'Fixture',baseUrl:`http://127.0.0.1:${fixture.address().port}/v1`,protocol:'openai-chat-completions',models:[model.modelId,'fixture-two'],apiKey:'offline-fixture'});
  const researchFile=await json('library/import',{name:'research-input.txt',base64:Buffer.from('RESEARCH_MATERIAL_FIXTURE').toString('base64')});
  await stream('chat',{chatId:'main-a',projectId:null,model,text:'MAIN_PUBLIC_SENTINEL',researchInput:{attachmentIds:[researchFile.id],annotations:[{id:'annotation-fixture',revision:0,resourceId:researchFile.id,selectedText:'RESEARCH_MATERIAL_FIXTURE',comment:'Check the evidence.'}]}});
  assert.match(JSON.stringify(calls[0].messages),/RESEARCH_MATERIAL_FIXTURE/);
  assert.match(JSON.stringify(calls[0].messages),/User-provided research material/);
  await json('roles/save',{role:'secretary',config:{prompt:'SECRETARY_ROLE_BEFORE',model,reasoningEffort:null}});
  await Promise.all([
    stream('assistant/chat',{scope:'global',ownerId:'global',model,text:'PRIVATE_GLOBAL_SENTINEL'}),
    stream('assistant/chat',{scope:'secretary',ownerId:'main-a',model,text:'PRIVATE_SECRETARY_SENTINEL'})
  ]);
  const a=await json('assistant?scope=global&ownerId=global'),s=await json('assistant?scope=secretary&ownerId=main-a');
  assert.notEqual(a.chat.id,s.chat.id);
  assert.equal((await json('chats')).chats.length,1);
  assert.equal((await json('chats/main-a/messages')).total,2);
  assert.equal((await request('chat',{chatId:a.chat.id,projectId:null,model,text:'ILLEGAL_REUSE'})).status,403);
  assert.equal((await request(`chats/${a.chat.id}/messages`)).status,404);
  for(const call of calls.slice(1)){
    assert.ok(call.tools?.length,'assistant receives actual runtime tools');
    assert.doesNotMatch(JSON.stringify(call.messages),/MAIN_PUBLIC_SENTINEL/);
  }
  assert.ok(calls.some(call=>JSON.stringify(call.messages).includes('SECRETARY_ROLE_BEFORE')),'new secretary consumes saved prompt');
  await json('roles/save',{role:'secretary',config:{prompt:'SECRETARY_ROLE_AFTER',model,reasoningEffort:null}});
  await close();await launch();
  await stream('assistant/chat',{scope:'secretary',ownerId:'main-a',model,text:'RESUMED_PRIVATE_QUERY',contextChatId:'main-a'});
  const restored=JSON.stringify(calls.at(-1).messages);
  assert.match(restored,/SECRETARY_ROLE_BEFORE/);assert.doesNotMatch(restored,/SECRETARY_ROLE_AFTER/,'saving does not silently change existing prompt after reopen');
  assert.match(restored,/PRIVATE_SECRETARY_SENTINEL/);assert.match(restored,/MAIN_PUBLIC_SENTINEL/);
  assert.doesNotMatch(restored,/PRIVATE_GLOBAL_SENTINEL/);
  const attachment=await json('library/import',{name:'assistant-source.txt',base64:Buffer.from('ATTACHED_SOURCE_4821').toString('base64')});
  await json('assistant/draft',{scope:'secretary',ownerId:'main-a',text:'Read attachment',attachmentIds:[attachment.id]});
  assert.equal((await json('assistant?scope=secretary&ownerId=main-a')).attachments[0].id,attachment.id);
  await stream('assistant/chat',{scope:'secretary',ownerId:'main-a',model,text:'Read attachment',attachmentIds:[attachment.id],executionMode:'ask'});
  assert.match(JSON.stringify(calls.at(-1).messages),/ATTACHED_SOURCE_4821/);
  assert.deepEqual((await json('assistant?scope=secretary&ownerId=main-a')).attachments,[]);
  await json('roles/apply',{role:'secretary',chatId:'main-a'});
  assert.equal((await json('roles/history?role=secretary&chatId=main-a')).receipts.length,1);
  const pending=stream('assistant/chat',{scope:'global',ownerId:'global',model,text:'HOLD_FOR_STOP'});
  await held;await json('assistant/stop',{scope:'global',ownerId:'global'});
  const end=await pending;assert.ok(end.some(e=>e.type==='cancelled'));
  const nextModel={...model,modelId:'fixture-two'};
  await json('assistant/model',{scope:'global',ownerId:'global',model:nextModel});
  await stream('assistant/chat',{scope:'global',ownerId:'global',model:nextModel,text:'AFTER_MODEL_SWITCH'});
  assert.equal(calls.at(-1).model,'fixture-two');
  assert.match(JSON.stringify(calls.at(-1).messages),/PRIVATE_GLOBAL_SENTINEL/,'DSH history survives actual model switch');
  assert.equal((await json('assistant?scope=secretary&ownerId=main-a')).total,6);
  assert.equal((await json('chats/main-a/messages')).total,2);
  if(entry){
    let context;
    if(nativeMode){
      const executable=path.join(root,'sciencescope-desktop.exe');
      await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'),executable);
      native=spawn(executable,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,SCIENCESCOPE_NODE:process.execPath,SCIENCESCOPE_HOST_SCRIPT:path.resolve('scripts/native-fixture-host.mjs'),SCIENCESCOPE_TEST_HOST_URL:origin.replace('/api/',''),SCIENCESCOPE_TEST_API_TOKEN:apiToken,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9228',TEMP:root,TMP:root}});
      for(let retry=0;retry<60;retry++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9228');break;}catch{await new Promise(r=>setTimeout(r,500));}}
      assert.ok(browser,'Native debug bridge did not become ready');context=browser.contexts()[0];
    }else{context=await chromium.launchPersistentContext(path.join(root,'browser'),{headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root}});browser=context;}
    const page=nativeMode?context.pages()[0]:await context.newPage(),errors=[];if(!nativeMode)await page.addInitScript(({origin,token})=>{if(location.origin===origin)Object.defineProperty(window,'__SCIENCESCOPE_API_TOKEN__',{value:token,writable:false,enumerable:false,configurable:false});},{origin:origin.replace('/api/','').replace(/\/$/,''),token:apiToken});page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin.replace('/api/',''));
    await page.waitForFunction(()=>window.ScienceScopeAssistants);
    await page.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('main-a');openPanel('secretary');});
    await page.waitForFunction(()=>window.ScienceScopeAssistants.entry('secretary','main-a').loaded);
    const input=page.locator('[data-assistant-input]');await input.fill('UI_SECRETARY_QUERY');await input.press('Enter');
    await page.waitForFunction(()=>window.ScienceScopeAssistants.entry('secretary','main-a').messages.length===8&&!window.ScienceScopeAssistants.entry('secretary','main-a').sending);
    assert.match(JSON.stringify(calls.at(-1).messages),/SECRETARY_ROLE_AFTER/);assert.doesNotMatch(JSON.stringify(calls.at(-1).messages),/SECRETARY_ROLE_BEFORE/);
    assert.equal(await page.locator('.assistant-message').count(),8);
    await input.fill('PROPOSE_MAIN_FIXTURE');await input.press('Enter');
    await page.locator('.assistant-proposal textarea').waitFor();
    await page.waitForFunction(()=>!window.ScienceScopeAssistants.entry('secretary','main-a').sending);
    await page.locator('.assistant-proposal textarea').fill('User corrected proposal');
    await page.locator('[data-assistant-action="apply-proposal"]').click();
    await page.waitForFunction(()=>S.drafts.main==='User corrected proposal');
    assert.equal((await json('chats/main-a/messages')).total,2,'proposal never sends to Main');
    assert.ok((await json('assistant?scope=secretary&ownerId=main-a')).messages.some(m=>m.toolActivity?.length),'tool details survive reload');
    await input.fill('SAVED_SECRETARY_DRAFT');await page.waitForTimeout(600);await page.reload();
    await page.waitForFunction(()=>window.ScienceScopeAssistants);
    await page.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;await window.SSV2.loadThread('main-a');openPanel('secretary');});
    await page.waitForFunction(()=>document.querySelector('[data-assistant-input]')?.value==='SAVED_SECRETARY_DRAFT');
    let global;
    if(nativeMode){
      const opened=context.waitForEvent('page');await page.evaluate(()=>window.ScienceScopeWindows.open({surface:'assistant'}));
      await opened;
      for(let i=0;i<40;i++){global=context.pages().find(p=>p.url().includes('surface=assistant')&&!p.url().includes('assistant-orb'));if(global)break;await new Promise(r=>setTimeout(r,100));}
      assert.ok(global,'Native assistant window missing');
      }else{global=await context.newPage();await global.addInitScript(({origin,token})=>{if(location.origin===origin)Object.defineProperty(window,'__SCIENCESCOPE_API_TOKEN__',{value:token,writable:false,enumerable:false,configurable:false});},{origin:origin.replace('/api/','').replace(/\/$/,''),token:apiToken});await global.goto(origin.replace('/api/','')+'?surface=assistant');}
    global.on('pageerror',e=>errors.push(e.message));
    await global.waitForFunction(()=>window.ScienceScopeAssistants?.entry('global').loaded);
    await global.locator('[data-assistant-input]').fill('UI_GLOBAL_QUERY');await global.locator('[data-assistant-input]').press('Enter');
    await global.waitForFunction(()=>window.ScienceScopeAssistants.entry('global').messages.some(m=>m.text==='UI_GLOBAL_QUERY')&&!window.ScienceScopeAssistants.entry('global').sending);
    assert.equal(await global.locator('.detached-shell>.panelhead').count(),0);
    await global.locator('[data-assistant-nav="database"]').click();
    await page.waitForFunction(()=>route==='database');
    assert.equal((await json('chats/main-a/messages')).total,2);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({native:nativeMode,browserSecretary:true,browserGlobal:true,draftReopened:true,mainUnchanged:true}));
    if(nativeMode){
      await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(error=>{
        if(!/Target page, context or browser has been closed/.test(error.message))throw error;
      });
      for(let i=0;i<50&&native.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
      assert.equal(native.exitCode,0,'Closing the main window must exit the native client');
    }
  }
  console.log(JSON.stringify({passed:true,realDsh:true,providerRequests:calls.length,paidRequests:0,privateIsolation:true,explicitContext:true,restartHistory:true,cancelledOneOnly:true}));
}finally{
  await browser?.close().catch(()=>{});
  if(native&&native.exitCode===null){native.kill();await new Promise(r=>{native.once('exit',r);setTimeout(r,3000);});}
  await close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));
  await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:500});
}
