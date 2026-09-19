// Opt-in native geometry check; only the explicitly supplied app PID is touched.
import {chromium} from 'playwright-core';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(), pid=process.env.SCIENCESCOPE_NATIVE_PID;
assert.match(pid||'',/^\d+$/,'SCIENCESCOPE_NATIVE_PID must identify this test desktop');
const dimensionsFile=path.join(root,'.sciencescope-local/build/tauri/debug/data/assistant-window.json');
const original=await readFile(dimensionsFile).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const ps=(action,extra=[],orb=false)=>execFileSync('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/native-assistant-geometry-smoke.ps1'),'-Action',action,'-WindowTitle',orb?'ScienceScope · 助手':'ScienceScope · 全局助手',...extra],
  {cwd:root,env:{...process.env,SCIENCESCOPE_NATIVE_PID:pid}}).toString().trim();
const rect=(action,orb=false)=>{const [x,y,r,b]=ps(action,[],orb).split(',').map(Number);return {x,y,w:r-x,h:b-y};};
const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
const main=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().includes('surface='));
let assistant;
async function open() {
  await main.evaluate(()=>window.ScienceScopeWindows.open({surface:'assistant'}));
  for(let n=0;n<30;n++) {
    assistant=browser.contexts().flatMap(c=>c.pages()).find(p=>new URL(p.url()).searchParams.get('surface')==='assistant');
    if(assistant)break;await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(assistant);await assistant.waitForFunction(()=>window.ScienceScopeWindows);
}
const invoke=(command,args)=>assistant.evaluate(([c,a])=>window.__TAURI__.core.invoke(c,a),[command,args]);
async function close() {
  if(!assistant||assistant.isClosed())return;
  const closed=assistant.waitForEvent('close');
  const orb=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('surface=assistant-orb'));
  await orb.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(()=>{});await closed;
}
try {
  await open();await invoke('set_assistant_mode',{mode:'expanded'});
  ps('resize',['-Width','520','-Height','760']);await new Promise(r=>setTimeout(r,300));
  const resized=rect('find');assert.equal(resized.w,520);assert.equal(resized.h,760);
  await invoke('set_assistant_mode',{mode:'orb'});
  const orb=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('surface=assistant-orb'));
  await orb.waitForFunction(()=>innerWidth===64&&innerHeight===64);
  ps('move',['-X','-10000','-Y','-10000'],true);await new Promise(r=>setTimeout(r,300));
  const clamped=rect('find',true),area=rect('bounds',true);
  assert.ok(clamped.x>=area.x&&clamped.y>=area.y&&clamped.x+clamped.w<=area.x+area.w&&clamped.y+clamped.h<=area.y+area.h);
  await invoke('set_assistant_mode',{mode:'expanded'});
  const restored=rect('find');assert.ok(Math.abs(restored.w-resized.w)<=2&&Math.abs(restored.h-resized.h)<=2);
  await close();await open();const reopened=rect('find');
  assert.ok(Math.abs(reopened.w-resized.w)<=2&&Math.abs(reopened.h-resized.h)<=2);
  console.log(JSON.stringify({resized,clamped,restored,reopened,providerRequests:0,nativeMenuSelection:'not automated'}));
} finally {
  await close();
  if(original)await writeFile(dimensionsFile,original);else await rm(dimensionsFile,{force:true});
  await browser.close();
}
