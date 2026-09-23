import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,copyFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';
const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'assistant-window-'));let server,browser,child;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:{listProviders:async()=>[],close:async()=>{}}});
  const post=async value=>{const r=await apiFetch(server,'api/assistant-window/preferences',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});assert.equal(r.status,200);};
  await post({startup:'orb'});
  const executable=path.join(root,'sciencescope-desktop.exe');await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'),executable);
  child=spawn(executable,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,SCIENCESCOPE_NODE:process.execPath,SCIENCESCOPE_HOST_SCRIPT:path.resolve('scripts/native-fixture-host.mjs'),SCIENCESCOPE_TEST_HOST_URL:server.url,SCIENCESCOPE_TEST_API_TOKEN:server.apiToken,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9231',TEMP:root,TMP:root}});
  for(let i=0;i<60;i++){try{browser=await chromium.connectOverCDP('http://127.0.0.1:9231');break;}catch{await pause(500);}}
  assert.ok(browser,'Native CDP must become available');const context=browser.contexts()[0];
  const find=async surface=>{for(let i=0;i<60;i++){const p=context.pages().find(p=>new URL(p.url()).searchParams.get('surface')===surface);if(p)return p;await pause(250);}throw new Error('Missing surface '+surface);};
  const main=await find(null),orb=await find('assistant-orb'),panel=await find('assistant');
  await panel.waitForFunction(async()=>!(await window.__TAURI__.window.getCurrentWindow().isVisible()));
  await orb.waitForFunction(async()=>await window.__TAURI__.window.getCurrentWindow().isVisible());
  await main.evaluate(async()=>{await window.ScienceScopeWorkspace.ready;go('assistant-settings');});
  await main.waitForSelector('[data-assistant-window-form] select:enabled');
  assert.equal(await main.locator('[name="startup"]').inputValue(),'orb');
  await main.locator('[data-assistant-visibility="expanded"]').click();await panel.waitForFunction(async()=>await window.__TAURI__.window.getCurrentWindow().isVisible());
  await panel.waitForSelector('[data-assistant-input]');await panel.locator('[data-assistant-input]').fill('UNSENT_WINDOW_DRAFT');
  await main.locator('[data-assistant-visibility="closed"]').click();await panel.waitForFunction(async()=>!(await window.__TAURI__.window.getCurrentWindow().isVisible()));await orb.waitForFunction(async()=>!(await window.__TAURI__.window.getCurrentWindow().isVisible()));
  await main.locator('[data-assistant-visibility="expanded"]').click();await panel.waitForFunction(async()=>await window.__TAURI__.window.getCurrentWindow().isVisible());
  assert.equal(await panel.locator('[data-assistant-input]').inputValue(),'UNSENT_WINDOW_DRAFT');
  await main.locator('[name="startup"]').selectOption('closed');await main.locator('[data-assistant-window-form] button').click();await main.waitForFunction(()=>document.querySelector('[data-window-feedback]')?.textContent.includes('下次启动'));
  const saved=await apiFetch(server,'api/assistant-window/preferences').then(r=>r.json());assert.equal(saved.startup,'closed');
  await main.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(()=>{});
  for(let i=0;i<50&&child.exitCode===null;i++)await pause(100);
  assert.equal(child.exitCode,0);
  console.log(JSON.stringify({native:true,startupOrb:true,panelInitiallyHidden:true,showHide:true,unsentDraftPreserved:true,preferenceSaved:true,mainExit:true,paidRequests:0}));
}finally{await browser?.close().catch(()=>{});if(child&&child.exitCode===null){child.kill();await pause(1000);}await server?.close();await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:500});}
