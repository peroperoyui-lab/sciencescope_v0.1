// Opt-in against a locally launched debug desktop with WebView2 CDP port 9229.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const browser=await chromium.connectOverCDP('http://127.0.0.1:9229');
const pages=browser.contexts().flatMap(c=>c.pages());
const main=pages.find(p=>p.url().startsWith('http://127.0.0.1:')&&!p.url().includes('surface='));
if(!main)throw new Error('Native main window not found');
const projectId='native-window-smoke';
try {
  await main.evaluate(()=>window.ScienceScopeWorkspace.ready);
  await main.evaluate(async id=>{
    if(!S.projects.some(p=>p.id===id))S.projects.push({id,name:'窗口验收临时项目',desc:'只检查独立窗口，不调用模型。'});
    const {hostRequest}=await import('/desktop/host-client.mjs');await hostRequest('workspace',{projects:S.projects});
  },projectId);
  // Persistent orb/panel behavior is covered by native-client-smoke.mjs.
  for(const surface of ['quick','map','browser']) {
    const options={surface,...(['quick','map'].includes(surface)?{projectId}:{})};
    const label=await main.evaluate(options=>window.ScienceScopeWindows.open(options),options);
    assert.match(label,/^secondary-/);
    let child;
    for(let n=0;n<30;n++) {
      child=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url().includes('surface='+surface));
      if(child)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(child,`${surface} window was not created`);
    await child.waitForFunction(()=>window.ScienceScopeWorkspace);
    await child.evaluate(()=>window.ScienceScopeWorkspace.ready);
    if(surface==='quick')assert.equal(await child.evaluate(()=>activeThread()?.projectId),projectId);
    const same=await main.evaluate(options=>window.ScienceScopeWindows.open(options),options);
    assert.equal(same,label,'second open must focus the owned window');
    const closed=child.waitForEvent('close',{timeout:10000});
    await child.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(error=>{if(!/closed/i.test(error.message))throw error;});
    await closed;
  }
  console.log(JSON.stringify({nativeWindows:['quick','map','browser'],reuseAndClose:true,mainStillOpen:!main.isClosed(),providerRequests:0}));
}finally {
  if(!main.isClosed())await main.evaluate(async id=>{
    S.projects=S.projects.filter(p=>p.id!==id);
    const {hostRequest}=await import('/desktop/host-client.mjs');await hostRequest('workspace',{projects:S.projects});
    render();
  },projectId);
  await browser.close();
}
