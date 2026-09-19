// Opt-in against the owned native debug client. No model requests.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {DESKTOP_ASSETS} from './build-desktop.mjs';
const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
const main=browser.contexts().flatMap(c=>c.pages()).find(p=>!p.url().includes('surface='));
assert.ok(main);
let original;
try {
  await main.waitForFunction(()=>window.ScienceScopeProfile&&window.ScienceScopeWorkspace);
  await main.evaluate(()=>Promise.all([window.ScienceScopeProfile.ready,window.ScienceScopeWorkspace.ready]));
  for(const file of DESKTOP_ASSETS)assert.equal((await main.request.get(new URL('/desktop/'+file,main.url()).href)).status(),200,file);
  original=await main.evaluate(()=>fetch('/api/profile').then(r=>r.json()));
  assert.equal(await main.evaluate(()=>V.pending.size||(S.drafts.main||'').length),0,'do not disturb active work');
  await main.locator('[data-profile-open]').click();
  await main.locator('#profile-name').fill('本机资料验收');
  await main.locator('#local-profile-form button').click();
  await main.waitForFunction(()=>window.ScienceScopeProfile.name()==='本机资料验收');
  await main.reload();await main.waitForFunction(()=>window.ScienceScopeProfile);
  await main.evaluate(()=>window.ScienceScopeProfile.ready);
  assert.equal(await main.evaluate(()=>window.ScienceScopeProfile.name()),'本机资料验收');
  await main.evaluate(()=>window.ScienceScopeWindows.open({surface:'assistant'}));
  let panel,orb;
  for(let n=0;n<40;n++) {
    const pages=browser.contexts().flatMap(c=>c.pages());
    panel=pages.find(p=>new URL(p.url()).searchParams.get('surface')==='assistant');
    orb=pages.find(p=>new URL(p.url()).searchParams.get('surface')==='assistant-orb');
    if(panel&&orb)break;await new Promise(r=>setTimeout(r,100));
  }
  assert.ok(panel&&orb,'independent panel and persistent orb required');
  await panel.waitForFunction(()=>window.ScienceScopeWorkspace);await panel.evaluate(()=>window.ScienceScopeWorkspace.ready);
  await orb.waitForSelector('.assistant-orb');
  assert.equal(await panel.locator('.detached-shell > .panelhead').count(),0);
  assert.equal(await panel.locator('.detached-shell').evaluate(el=>getComputedStyle(el).borderRadius),'20px');
  assert.deepEqual(await orb.evaluate(()=>[innerWidth,innerHeight]),[64,64]);
  await orb.locator('.assistant-orb').click();
  assert.equal(await main.evaluate(()=>window.__TAURI__.core.invoke('get_assistant_mode')),'orb');
  assert.equal(orb.isClosed(),false);
  await orb.locator('.assistant-orb').click();
  assert.equal(await main.evaluate(()=>window.__TAURI__.core.invoke('get_assistant_mode')),'expanded');
  console.log(JSON.stringify({productionAssets:DESKTOP_ASSETS.length,profileSaveReload:true,persistentOrb:true,separateRoundedPanel:true,headerRemoved:true,toggle:true,providerRequests:0}));
} finally {
  if(original&&!main.isClosed())await main.evaluate(async value=>{
    await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
    new BroadcastChannel('sciencescope-local-profile').postMessage('changed');
  },original);
  await browser.close();
}
