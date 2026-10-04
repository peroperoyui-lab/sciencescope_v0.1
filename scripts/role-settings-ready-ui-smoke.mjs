// Delay the real role catalog response until the independent secretary forms
// are editable. Initial role loading must preserve those forms and their drafts.
import path from 'node:path';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch,installApiToken} from './smoke-auth.mjs';

const base=path.resolve('.sciencescope-local/temp');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'role-settings-ready-ui-'));
const screenshots=path.join(base,'role-settings-ready-ui-evidence');await mkdir(screenshots,{recursive:true});
let server,browser,page,releaseRoles;
try{
  server=await createDesktopServer({dataRoot:root,outputDir:path.join(root,'assets'),runtimeHost:{listProviders:async()=>[{id:'offline',name:'Offline',models:['m'],configured:true}],getModelInfo:async()=>({}),close:async()=>{}}});
  async function request(route,body){const response=await apiFetch(server,'/api/'+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(response.status,200,route);return response.json();}
  await request('workspace',{projects:[{id:'ready-ui-project',name:'Role readiness',desc:'',archived:false}],pins:[],projectExpanded:{},lastChatId:null});
  await request('roles/save',{role:'secretary',config:{prompt:'Delayed role catalog fixture',model:{providerId:'offline',modelId:'m'},reasoningEffort:null}});
  const preferences=await request('secretary/preferences');preferences.summary.everyMessages.n=12;await request('secretary/preferences',{summary:preferences.summary});
  browser=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root}});
  page=await browser.newPage();await installApiToken(page,server);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let rolesReached;const rolesGate=new Promise(resolve=>releaseRoles=resolve),rolesSeen=new Promise(resolve=>rolesReached=resolve);
  await page.route('**/api/roles',async route=>{rolesReached();await rolesGate;await route.continue();});
  const gets={secretary:0,memory:0};
  page.on('request',request=>{if(request.method()!=='GET')return;const route=new URL(request.url()).pathname;if(route==='/api/secretary/preferences')gets.secretary++;if(route==='/api/research/consolidate/settings')gets.memory++;});
  await page.goto(server.url);await rolesSeen;
  await page.waitForFunction(()=>!!(window.ScienceScopeWorkspace?.ready&&window.ScienceScopeProfile?.ready&&window.ScienceScopePreferences?.ready&&window.ScienceScopeRoleSettings?.ready));
  await page.evaluate(async()=>{
    await Promise.all([window.ScienceScopeWorkspace.ready,window.ScienceScopeProfile.ready,window.ScienceScopePreferences.ready]);
    // go() paints immediately; its queued hashchange finishes navigation with
    // another render. Capture form identities after that navigation completes.
    await new Promise(resolve=>{
      const navigated=event=>{if(new URL(event.newURL).hash!=='#secretary-settings')return;window.removeEventListener('hashchange',navigated);resolve();};
      window.addEventListener('hashchange',navigated);go('secretary-settings');
    });
  });
  await page.waitForFunction(()=>{
    const summary=document.querySelector('[data-summary-settings]'),memory=document.querySelector('[data-memory-consolidation-settings]');
    return summary&&!summary.querySelector('fieldset').disabled&&memory&&!memory.querySelector('fieldset').disabled&&!document.querySelector('[data-secretary-template] textarea').disabled;
  });
  assert.equal(await page.locator('[data-role-form="secretary"]').count(),0,'the role catalog is still deliberately pending');
  assert.equal(await page.locator('[data-summary-settings] [name="messagesN"]').inputValue(),'12');
  await page.evaluate(()=>{
    window.__roleReadyForms={summary:document.querySelector('[data-summary-settings]'),memory:document.querySelector('[data-memory-consolidation-settings]'),template:document.querySelector('[data-secretary-template]')};
    for(const [form,name,value] of [[window.__roleReadyForms.summary,'messagesN','13'],[window.__roleReadyForms.memory,'idleMinutes','17'],[window.__roleReadyForms.template,'notesTemplate','Uncommitted template draft']]){
      form.elements[name].value=value;form.elements[name].dispatchEvent(new Event('input',{bubbles:true}));
    }
  });
  const before={...gets};assert.deepEqual(before,{secretary:1,memory:1});
  await page.screenshot({path:path.join(screenshots,'before-role-ready.png'),fullPage:true});
  releaseRoles();await page.evaluate(async()=>{await window.ScienceScopeRoleSettings.ready;});
  const retained=await page.evaluate(()=>Object.fromEntries(Object.entries(window.__roleReadyForms).map(([key,form])=>[key,form.isConnected&&form===document.querySelector(key==='summary'?'[data-summary-settings]':key==='memory'?'[data-memory-consolidation-settings]':'[data-secretary-template]')])));
  assert.deepEqual(retained,{summary:true,memory:true,template:true},'role readiness keeps independent form identities');
  assert.equal(await page.locator('[data-summary-settings] [name="messagesN"]').inputValue(),'13');
  assert.equal(await page.locator('[data-memory-consolidation-settings] [name="idleMinutes"]').inputValue(),'17');
  assert.equal(await page.locator('[data-secretary-template] textarea').inputValue(),'Uncommitted template draft');
  assert.equal(await page.locator('[data-role-form="secretary"] textarea[name="prompt"]').inputValue(),'Delayed role catalog fixture','the late role catalog still populates its real form');
  assert.deepEqual(gets,before,'no duplicate secretary/memory preference mount requests');
  assert.equal((await request('secretary/preferences')).summary.everyMessages.n,12,'input alone has not implicitly saved the draft');
  await page.screenshot({path:path.join(screenshots,'after-role-ready.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,delayedRoleCatalog:true,retainedForms:retained,unsavedDraftsPreserved:true,noPreferenceRemount:true,paidRequests:0,screenshots}));
}finally{releaseRoles?.();await page?.close().catch(()=>{});await browser?.close().catch(()=>{});await server?.close().catch(()=>{});await rm(root,{recursive:true,force:true});}
