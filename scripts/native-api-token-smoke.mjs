// Opt-in Windows native acceptance. Isolated fixture, no Provider or user data.
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {mkdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';

const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'native-api-token-'));
let host,browser,child,other;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  host=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:{listProviders:async()=>[],close:async()=>{}}});
  const headers={Authorization:`Bearer ${host.apiToken}`,'Content-Type':'application/json'};
  const setup=await fetch(host.url+'api/workspace',{method:'POST',headers,body:JSON.stringify({projects:[{id:'token-test',name:'Token fixture',desc:'',archived:false}],pins:[],projectExpanded:{},lastChatId:null})});
  assert.equal(setup.status,200);
  const executable=path.join(root,'sciencescope-desktop.exe');
  await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'),executable);
  child=spawn(executable,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,SCIENCESCOPE_NODE:process.execPath,SCIENCESCOPE_HOST_SCRIPT:path.resolve('scripts/native-fixture-host.mjs'),SCIENCESCOPE_TEST_HOST_URL:host.url,SCIENCESCOPE_TEST_API_TOKEN:host.apiToken,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9233',TEMP:root,TMP:root}});
  for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9233');break}catch{await pause(500)}}
  assert.ok(browser,'native diagnostic connection required');
  const context=browser.contexts()[0];
  const find=async surface=>{for(let i=0;i<60;i++){const p=context.pages().find(p=>p.url().startsWith(host.url)&&new URL(p.url()).searchParams.get('surface')===surface);if(p)return p;await pause(250)}throw Error('missing native surface '+surface)};
  const main=await find(null);await main.waitForFunction(()=>window.ScienceScopeWindows&&window.ScienceScopeWorkspace);
  await main.evaluate(()=>window.ScienceScopeWorkspace.ready);
  async function verify(page){
    await page.waitForFunction(()=>Object.hasOwn(window,'__SCIENCESCOPE_API_TOKEN__'));
    const result=await page.evaluate(async()=>{
      const d=Object.getOwnPropertyDescriptor(window,'__SCIENCESCOPE_API_TOKEN__');
      const {hostRequest}=await import('/desktop/host-client.mjs');
      await hostRequest('status');
      return {locked:!d.enumerable&&!d.writable&&!d.configurable,tokenLength:d.value.length};
    });
    assert.deepEqual(result,{locked:true,tokenLength:64});
  }
  await verify(main);
  await main.evaluate(()=>window.ScienceScopeWindows.open({surface:'assistant'}));
  const panel=await find('assistant'),orb=await find('assistant-orb');await verify(panel);await verify(orb);
  for(const surface of ['quick','map','browser']){
    await main.evaluate(surface=>window.ScienceScopeWindows.open({surface,...(surface==='browser'?{}:{projectId:'token-test'})}),surface);
    const page=await find(surface);await verify(page);
    if(surface==='browser'){
      const ownUrl=page.url();
      other=http.createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Untrusted loopback fixture</title>Other origin');});
      await new Promise(r=>other.listen(0,'127.0.0.1',r));
      await page.goto(`http://127.0.0.1:${other.address().port}/`);
      const denied=await page.evaluate(async()=>{
        let rejected=false;try{await window.__TAURI__.core.invoke('get_assistant_mode')}catch{rejected=true}
        return {tokenAbsent:!Object.hasOwn(window,'__SCIENCESCOPE_API_TOKEN__'),nativeBridgePresent:typeof window.__TAURI__?.core?.invoke==='function',ipcRejected:rejected};
      });
      assert.deepEqual(denied,{tokenAbsent:true,nativeBridgePresent:true,ipcRejected:true});
      await page.goto(ownUrl);await verify(page);
    }
    await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(e=>{if(!/closed/i.test(e.message))throw e});
  }
  assert.equal((await fetch(host.url+'api/status')).status,401);
  await main.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(()=>{});
  for(let i=0;i<80&&child.exitCode===null;i++)await pause(100);
  assert.equal(child.exitCode,0);
  console.log(JSON.stringify({nativeWindows:['main','assistant','orb','quick','map','browser'],authenticatedApi:true,immutableNonEnumerableToken:true,foreignLoopbackTokenAbsent:true,foreignLoopbackIpcDenied:true,mainExit:true,providerRequests:0}));
} finally {
  await browser?.close().catch(()=>{});
  if(child&&child.exitCode===null){child.kill();await pause(1000)}
  if(other){other.closeAllConnections();await new Promise(r=>other.close(r))}
  await host?.close();
  await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:500});
}
