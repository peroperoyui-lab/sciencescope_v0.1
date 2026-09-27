// Actual local host/store, browser interactions, no provider requests.
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createDesktopApi} from './desktop-api.mjs';
import {buildDesktop} from './build-desktop.mjs';
import {defaultRoot} from './prepare-desktop.mjs';
import {createChatStore} from './chat-store.mjs';
const temp=path.join(defaultRoot,'.sciencescope-local/temp');await mkdir(temp,{recursive:true});
const root=await mkdtemp(path.join(temp,'workbench-ui-'));
const apiToken=randomBytes(32).toString('hex');
process.env.TEMP=root;process.env.TMP=root;
let organizeRuns=0;
const runtimeHost={
  capabilities:{tokenStreaming:true},close:async()=>{},setToolHandler:()=>{},listProviders:async()=>[{id:'offline',name:'Offline',models:['m'],configured:true,saved:true}],
  getRuntimeConfig:async()=>({}),startSession:async()=>`session-organize-${organizeRuns+1}`,releaseSession:async()=>{},
  send:async()=>{organizeRuns+=1;await new Promise(resolve=>setTimeout(resolve,700));return {finalResponse:'# 版本说明\nAUTO_ORGANIZED_NOTE'};},
};
const api=await createDesktopApi({dataRoot:root,apiToken,runtimeHost});
const entry=await buildDesktop();
const server=http.createServer(async(req,res)=>{
  if(await api.handle(req,res))return;
  const pathname=new URL(req.url,'http://localhost').pathname;
  const file=path.resolve(path.dirname(entry),pathname==='/'?'index.html':pathname.slice(1));
  if(!file.startsWith(path.dirname(entry)+path.sep)){res.writeHead(404);res.end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const requestHeaders=(contentType=false)=>({...(contentType?{'Content-Type':'application/json'}:{}),Authorization:`Bearer ${apiToken}`});
const post=async(route,data)=>{const response=await fetch(url+'/api/'+route,{method:'POST',headers:requestHeaders(true),body:JSON.stringify(data)});assert.equal(response.status,200,await response.clone().text());return response.json();};
const get=async route=>{const response=await fetch(url+'/api/'+route,{headers:requestHeaders()});assert.equal(response.status,200,await response.clone().text());return response.json();};
let context;
try{
  await post('workspace',{projects:[{id:'wb-test',name:'工作站验收'}],pins:[],projectExpanded:{},lastChatId:null});
  await post('roles/save',{role:'secretary',config:{prompt:'Offline secretary',model:{providerId:'offline',modelId:'m'},reasoningEffort:null}});
  const seed=await createChatStore({stateDir:path.join(root,'.sciencescope-local/state')});
  await seed.ensureChat({chatId:'long-chat',title:'双向历史',projectId:'wb-test'});
  for(let i=0;i<160;i++)await seed.appendMessage({chatId:'long-chat',id:'history-'+i,role:i%2?'assistant':'user',text:'历史 '+i+'\n\n'+('可追溯内容。'.repeat(15))});
  seed.close?.();
  context=await chromium.launchPersistentContext(path.join(root,'edge'),{executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,viewport:{width:1500,height:1000},env:{...process.env,TEMP:root,TMP:root}});
  const page=await context.newPage(),errors=[];await page.addInitScript(({origin,token})=>{if(location.origin===origin)Object.defineProperty(window,'__SCIENCESCOPE_API_TOKEN__',{value:token,writable:false,enumerable:false,configurable:false});},{origin:url,token:apiToken});page.on('pageerror',e=>{errors.push(e.message);console.log('UI error:',e.message);});
  await page.goto(url);await page.waitForFunction(()=>window.ScienceScopeWorkbench?.ready);
  await page.evaluate(()=>loadThread('long-chat'));
  await page.waitForFunction(()=>{const box=document.querySelector('.messages');return box&&box.scrollHeight-box.scrollTop-box.clientHeight<5;});
  assert.equal(await page.evaluate(()=>S.messages[0].id),'history-100');
  await page.locator('.messages').evaluate(el=>el.scrollTop=0);
  await page.waitForFunction(()=>S.messages[0]?.id==='history-70');
  assert.equal(await page.locator('.messages > .message').count(),60);
  await page.locator('.messages').evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.waitForFunction(()=>S.messages[0]?.id==='history-100');
  assert.equal(await page.locator('.messages > .message').count(),60);
  await page.evaluate(()=>{selectProject('wb-test');go('workbench');});
  await page.waitForFunction(()=>S.nodes.length===1);
  assert.equal(await page.locator('.wb-action').count(),0);
  assert.equal(await page.locator('[data-wb="logs"]').count(),1);
  assert.equal(await page.evaluate(()=>S.plans.length),0);
  assert.match(await page.locator('.wb-path').innerText(),/project-wb-test/);
  await page.waitForFunction(()=>document.querySelector('.filetree')?.textContent.includes('mind_map'));
  await page.locator('[data-v="new-record"][data-kind="plan"]').click();
  await page.locator('#record-title').fill('真实计划');await page.locator('[data-v="save-record"]').click();
  await page.waitForFunction(()=>!V.editor);
  await page.locator('[data-v="new-record"][data-kind="log"]').click();
  await page.locator('#record-title').fill('真实日志');await page.locator('#record-text').fill('文件与导图已核对');await page.locator('[data-v="save-record"]').click();
  await page.waitForFunction(()=>!V.editor);
  await page.locator('[data-wb-organize]').check();
  let autoOrganize=false;
  for(let i=0;i<40&&!autoOrganize;i++){autoOrganize=(await get('workbench?projectId=wb-test')).autoOrganize;if(!autoOrganize)await page.waitForTimeout(100);}
  assert.equal(autoOrganize,true,'auto-organize preference is durable before the import');
  const chooserPromise=page.waitForEvent('filechooser');await page.locator('[data-action="upload-version"]').click();const chooser=await chooserPromise;
  await chooser.setFiles({name:'paper.md',mimeType:'text/markdown',buffer:Buffer.from('# Real original\n')});
  await page.waitForFunction(()=>S.versions.length===1);
  await page.waitForFunction(()=>document.querySelectorAll('.versionrow').length===1);
  assert.equal(await page.locator('.versionrow').count(),1);
  let organized;
  for(let i=0;i<50&&!organized;i++){const snapshot=await get('workbench?projectId=wb-test');organized=snapshot.versions[0]?.status==='organized';if(!organized)await page.waitForTimeout(200);}
  assert.equal(organized,true,'the host event completed automatic organization');
  await page.waitForFunction(()=>document.querySelector('.versionrow')?.textContent.includes('附说明 MD'),null,{timeout:10000});
  assert.equal(organizeRuns,1,'host event organized the imported version once');
  assert.match(await page.locator('.versionrow').innerText(),/附说明 MD/,'background receipt polling refreshes the version note in place');
  await page.evaluate(()=>go('map'));
  await page.locator('[data-node="root"]').dblclick();
  await page.locator('.wb-node-editor').fill('**完整内容**\n'+ '长文字'.repeat(200));
  await page.locator('.wb-node-editor').press('Control+Enter');
  await page.locator('[data-wb="floating"]').click();
  await page.locator('[data-wb="connect"]').click();
  await page.locator('#wb-link-from').selectOption('root');
  const floating=await page.evaluate(()=>S.nodes.find(n=>n.floating).id);
  await page.locator('#wb-link-to').selectOption(floating);
  await page.locator('[data-wb="connect-save"]').click();
  await page.locator('[data-action="undo-map"]').click();assert.equal(await page.evaluate(()=>S.mapEdges.length),0);
  await page.locator('[data-action="redo-map"]').click();assert.equal(await page.evaluate(()=>S.mapEdges.length),1);
  await page.locator('[data-node="root"]').dispatchEvent('drop',{dataTransfer:await page.evaluateHandle(()=>{const transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8fsAAAAASUVORK5CYII='),c=>c.charCodeAt(0))],'node.png',{type:'image/png'}));return transfer;})});
  await page.waitForFunction(()=>S.nodes[0].images?.length===1&&document.querySelector('#mapsavestate')?.textContent==='项目文件 · 保存后更新预览');
  await page.evaluate(()=>window.ScienceScopeWorkbench.saveMap());
  const saved=await fetch(url+'/api/workbench?projectId=wb-test',{headers:requestHeaders()}).then(r=>r.json());
  assert.equal(saved.map.edges.length,1);assert.equal(saved.map.edges[0].directed,true);assert.equal(saved.map.nodes[0].text.length,609);
  await page.reload();await page.waitForFunction(()=>window.ScienceScopeWorkbench?.ready);
  await page.evaluate(()=>{selectProject('wb-test');go('map');});
  assert.equal(await page.evaluate(()=>S.mapEdges.length),1);
  assert.equal(await page.evaluate(()=>S.nodes[0].images.length),1);
  await page.waitForFunction(()=>document.querySelector('[data-node="root"] img')?.naturalWidth>0);
  assert.ok(await page.locator('[data-node="root"] img').evaluate(img=>img.naturalWidth>0),'reloaded image must be decoded');
  assert.equal(await page.evaluate(()=>S.plans[0].title),'真实计划');
  assert.equal(await page.evaluate(()=>S.journals[0].title),'真实日志');
  const overflow=await page.locator('[data-node="root"] .nodetext').evaluate(el=>el.scrollWidth>el.clientWidth+2);
  assert.equal(overflow,false,'long text wraps horizontally');
  await page.evaluate(()=>go('workbench'));
  const artifacts=path.join(defaultRoot,'.sciencescope-local/temp/workbench-ui');await mkdir(artifacts,{recursive:true});
  await page.screenshot({path:path.join(artifacts,'workbench.png')});
  await page.evaluate(()=>go('map'));await page.screenshot({path:path.join(artifacts,'map.png')});
  const resource=await post('library/import',{projectId:'wb-test',name:'evidence.txt',base64:Buffer.from('Original source, not accepted knowledge.').toString('base64')});
  const candidate=await post('knowledge/propose',{projectId:'wb-test',namespace:'heuristic',title:'待核查经验',content:'仅是候选。',sourceIds:[resource.id]});
  assert.equal(candidate.status,'candidate');await post('knowledge/accept',{id:candidate.id});
  await page.evaluate(()=>go('database'));
  await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('evidence.txt'));
  await page.reload();await page.waitForFunction(()=>window.ScienceScopeLibrary&&window.ScienceScopeWorkbench?.ready);
  await page.evaluate(()=>go('database'));
  await page.waitForFunction(()=>document.querySelector('main')?.textContent.includes('evidence.txt'));
  assert.deepEqual(errors,[]);
  console.log('PASS: real host, real folder/import, map edit/link/save/reload, wrapping, no fake plans.');
}finally{await context?.close();await api.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
