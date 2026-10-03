// T21 offline acceptance through the production API/assets and real DSH.
// --native uses an owned Tauri/WebView2 client; paid requests: zero.
import assert from 'node:assert/strict';
import path from 'node:path';
import net from 'node:net';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, writeFile, readFile, stat, copyFile, rm, access} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import {createDshHost} from '../adapters/runtime-dsh/host.mjs';
import {createDshWebHost} from '../adapters/runtime-dsh/web-host.mjs';
import {createProviderService} from '../adapters/runtime-dsh/provider-service.mjs';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch, installApiToken} from './smoke-auth.mjs';

const native = process.argv.includes('--native');
const base = path.resolve('.sciencescope-local/temp/t21-validation', native ? 'native' : 'browser');
await mkdir(base, {recursive:true});
const root = await mkdtemp(path.join(base, 'run-'));
const evidence = path.join(root, 'evidence'); await mkdir(evidence);
const dataRoot = path.join(root, 'app'), internal = path.join(dataRoot, '.sciencescope-local');
const home = path.join(internal, 'dsh'), credentialPath = path.join(internal, 'secret', 'credentials.yaml');
const legacyPath = path.join(home, '.credentials.yaml'), dbPath = path.join(internal, 'state', 'sciencescope.sqlite');
const markerPath = path.join(root, 'unexpected-shell-output.txt');
const model = {providerId:'sciencescope-t21-fixture', modelId:'offline'};
const credentialRef = 'SCIENCESCOPE_T21_FIXTURE_API_KEY';
// A fixture value only; never write or print live credentials.
const fixtureSecret = 'T21_LOCAL_MIGRATION_SENTINEL';
const requests = [], events = [], errors = [], badAssets = [], externalRequests = [], screenshots = [];
const execute = promisify(execFile), pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
// Windows PowerShell must locate its own modules rather than inherited pwsh modules.
const powershellEnv = {...process.env, TEMP:root, TMP:root}; delete powershellEnv.PSModulePath;
let host, web, server, browser, page, child, fixture, diagnosticPort, ownedNative = [], phase = 'setup';
let nativeShell;
let readAttempted = false, shellAttempted = false, migratedAuthRequests = 0;
async function exists(filename) {try {await access(filename); return true;} catch (error) {if(error.code==='ENOENT')return false;throw error;}}
async function poll(read, check, label, timeout=60000) {
  const until=Date.now()+timeout; let value;
  do {value=await read();if(check(value))return value;await pause(100);} while(Date.now()<until);
  throw new Error(`${label} timed out`);
}
async function ok(route, body) {
  const response=await apiFetch(server, 'api/'+route, body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200,route);return response.json();
}
async function snapshotProcesses() {
  const {stdout}=await execute(powershell,['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"],{windowsHide:true,timeout:15000,maxBuffer:1024*1024,env:powershellEnv});
  const result=JSON.parse(stdout);return Array.isArray(result)?result:[result];
}
async function captureNative() {
  const all=await snapshotProcesses(),ids=new Set([child.pid]);let changed=true;
  while(changed){changed=false;for(const process of all)if(ids.has(process.ParentProcessId)&&!ids.has(process.ProcessId)){ids.add(process.ProcessId);changed=true;}}
  ownedNative=all.filter(process=>ids.has(process.ProcessId));
  assert.ok(ownedNative.some(process=>process.Name==='node.exe'));
  assert.ok(ownedNative.some(process=>/webview2/i.test(process.Name)));
}
async function ownerOnlyAcl() {
  if(process.platform!=='win32')return {platform:process.platform};
  const command="$ErrorActionPreference='Stop'; $a=Get-Acl -LiteralPath $env:T21_ACL_PATH; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; [pscustomobject]@{protected=$a.AreAccessRulesProtected;ownerOnly=(@($a.Access | Where-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -ne $u }).Count -eq 0)} | ConvertTo-Json -Compress";
  const {stdout}=await execute(powershell,['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,env:{...powershellEnv,T21_ACL_PATH:credentialPath}});
  const result=JSON.parse(stdout);assert.equal(result.protected,true);assert.equal(result.ownerOnly,true);return result;
}
async function launch() {
  if(!native){
    browser=await chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:process.env.SCIENCESCOPE_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1440,height:960},env:{...process.env,TEMP:root,TMP:root}});
    page=await browser.newPage();await installApiToken(page,server);await page.goto(server.url);
  } else {
    assert.equal(process.platform,'win32');const executable=path.join(root,'sciencescope-desktop.exe');
    await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'),executable);
    nativeShell={sha256:createHash('sha256').update(await readFile(executable)).digest('hex'),builtAt:(await stat(executable)).mtime.toISOString(),assets:'Current production build served by this run; Tauri shell source unchanged.'};
    const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));diagnosticPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    child=spawn(executable,[],{cwd:root,windowsHide:true,stdio:'ignore',env:{...process.env,SCIENCESCOPE_NODE:process.execPath,SCIENCESCOPE_HOST_SCRIPT:path.resolve('scripts/native-fixture-host.mjs'),SCIENCESCOPE_TEST_HOST_URL:server.url,SCIENCESCOPE_TEST_API_TOKEN:server.apiToken,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${diagnosticPort}`,TEMP:root,TMP:root}});
    await poll(async()=>{try{return await chromium.connectOverCDP(`http://127.0.0.1:${diagnosticPort}`);}catch{return null;}},Boolean,'native diagnostics',30000).then(value=>browser=value);
    page=await poll(async()=>browser.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().startsWith(server.url)&&!candidate.url().includes('surface=')),Boolean,'native main page');
    assert.ok(await page.evaluate(()=>!!window.__TAURI__?.core?.invoke));await captureNative();
  }
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.status()>=400&&new URL(response.url()).pathname.startsWith('/desktop/'))badAssets.push(response.url());});
  page.on('request',request=>{const url=new URL(request.url());if(native&&url.origin==='http://ipc.localhost')return;if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(server.url).origin)externalRequests.push(url.origin);});
  await page.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeModels&&window.ScienceScopeExecution);
  await page.evaluate(()=>window.ScienceScopeWorkspace.ready);
}
try {
  await mkdir(home,{recursive:true});
  await writeFile(legacyPath,`version: 1\nrefs:\n  ${credentialRef}: ${fixtureSecret}\n`);
  fixture=createServer(async(request,response)=>{
    try {
      let raw='';for await(const chunk of request)raw+=chunk;const input=JSON.parse(raw);
      assert.ok(request.headers.authorization===`Bearer ${fixtureSecret}`,'migrated credential remains usable');migratedAuthRequests++;
      assert.ok(!JSON.stringify(input).includes(fixtureSecret),'model messages must never receive credential contents');
      requests.push(input);
      response.writeHead(200,{'content-type':'text/event-stream'});
      let tool,args;
      if(!readAttempted){readAttempted=true;tool=input.tools?.find(item=>item.function?.name==='read');assert.ok(tool,'read tool registered');args={file_path:credentialPath};}
      else if(!shellAttempted){shellAttempted=true;tool=input.tools?.find(item=>item.function?.name==='pwsh');assert.ok(tool,'pwsh tool registered');args={command:`Get-Content -LiteralPath '${dbPath.replaceAll("'","''")}' -Raw | Set-Content -LiteralPath '${markerPath.replaceAll("'","''")}'`,description:'Local protected-path denial fixture'};}
      if(tool){response.write(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:`t21-call-${requests.length}`,type:'function',function:{name:tool.function.name,arguments:JSON.stringify(args)}}]}}]})}\n\n`);response.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');}
      else {assert.ok(readAttempted&&shellAttempted,'required fixture tools registered');response.write('data: {"choices":[{"delta":{"content":"T21_GUARDS_CONFIRMED"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');}
      response.end('data: [DONE]\n\n');
    } catch(error){errors.push(error.message);response.writeHead(500);response.end('fixture assertion failed');}
  });
  await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
  const protectedPaths=[path.join(internal,'state'),home,path.join(internal,'secret'),path.join(internal,'models')];
  web=await createDshWebHost({home,cwd:root,credentialPath,protectedPaths,timeoutMs:60000});
  host=await createDshHost({home,cwd:root,credentialPath,protectedPaths,sessionHeaders:['x-fixture-session'],timeoutMs:60000});
  Object.assign(host,createProviderService(web.call));
  const send=host.send.bind(host);host.send=input=>send({...input,onEvent:event=>{events.push(event);input.onEvent?.(event);}});
  server=await createDesktopServer({dataRoot,outputDir:path.join(root,'assets'),runtimeHost:host});
  await ok('providers/save',{id:model.providerId,name:'T21 local fixture',baseUrl:`http://127.0.0.1:${fixture.address().port}/v1`,protocol:'openai-chat-completions',models:[model.modelId]});
  assert.equal(await exists(legacyPath),false);assert.equal(await exists(credentialPath),true);
  const acl=await ownerOnlyAcl();
  phase='Full mode protected file and shell denial';await launch();
  await page.evaluate(value=>window.ScienceScopeModels.select(value),model);
  await page.locator('[data-v="mode-menu"]').first().click();
  await page.locator('[data-execution="mode"][data-mode="full"]').click();
  await page.locator('dialog.workspace-confirm button[value="confirm"]').click();
  assert.equal(await page.evaluate(()=>window.ScienceScopeExecution.mode()),'full');
  await page.getByRole('textbox',{name:'主输入框'}).fill('Exercise the local protected path fixture once, then acknowledge the denials.');
  await page.getByRole('button',{name:'发送',exact:true}).click();
  await page.locator('[data-protected-path-approval]').waitFor({state:'visible',timeout:60000});
  const chats=await ok('chats');assert.equal(chats.chats.length,1);const chatId=chats.chats[0].id;
  const approval=await ok('execution?chatId='+chatId);assert.equal(approval.mode,'full');assert.equal(approval.approvals.length,1);assert.equal(approval.approvals[0].classification,'protected-path');
  phase='localized protected approval screenshots';
  for(const language of ['zh-CN','en'])for(const theme of ['light','dark']){
    await ok('preferences',{language,theme});
    await page.evaluate(({language,theme})=>{window.ScienceScopeI18n?.setLanguage?.(language);document.documentElement.dataset.theme=theme;}, {language,theme});
    await page.evaluate(()=>window.ScienceScopeExecution.refresh());
    const card=page.locator('[data-protected-path-approval]');await card.waitFor({state:'visible'});
    assert.match(await card.innerText(),language==='en'?/internal.*data|application.*data/i:/涉及应用内部数据/);
    const color=await card.locator('.protected-path-warning').evaluate(element=>getComputedStyle(element).color);
    const rgb=color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    assert.ok(rgb&&Number(rgb[1])>Number(rgb[2])&&Number(rgb[1])>Number(rgb[3]),'protected marker is red');
    const screenshot=path.join(evidence,`protected-approval-${language==='en'?'en':'zh'}-${theme}.png`);
    await page.screenshot({path:screenshot});screenshots.push({path:screenshot,markerColor:color});
  }
  phase='deny protected command and finish answer';
  await page.locator('[data-execution="reject"]').click();
  await page.getByText('T21_GUARDS_CONFIRMED',{exact:true}).waitFor({state:'visible',timeout:60000});
  await poll(()=>Promise.resolve(events.filter(event=>event.type==='completed').length),value=>value===1,'one completed answer');
  assert.equal(migratedAuthRequests,3);assert.equal(await exists(markerPath),false);
  const toolMessages=requests.flatMap(request=>request.messages.filter(message=>message.role==='tool'));
  assert.match(JSON.stringify(toolMessages),/该路径属于应用内部数据/);assert.match(JSON.stringify(toolMessages),/涉及应用内部数据的命令未获批准/);
  assert.ok(!JSON.stringify(toolMessages).includes(fixtureSecret));
  assert.deepEqual(events.filter(event=>['failed','error','cancelled'].includes(event.type)),[]);
  assert.deepEqual(errors,[]);assert.deepEqual(badAssets,[]);assert.deepEqual(externalRequests,[]);
  if(native){phase='owned native shutdown';await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(error=>{if(!/closed/i.test(error.message))throw error;});await poll(()=>Promise.resolve(child.exitCode),value=>value!==null,'native exit');assert.equal(child.exitCode,0);await poll(async()=>{const all=await snapshotProcesses();return ownedNative.filter(owned=>all.some(process=>process.ProcessId===owned.ProcessId));},value=>value.length===0,'owned descendants exit');}
  const result={passed:true,native,node:process.version,nodePath:process.execPath,productionRouter:true,realDsh:true,paidRequests:0,physicalRequests:migratedAuthRequests,credentialMigrationPreserved:true,legacyCredentialRemoved:true,credentialAcl:acl,fileToolDenied:true,fullShellApproval:true,shellDeniedWithoutExecution:true,completedAnswers:1,terminalErrors:[],screenshots,browserErrors:errors,badAssets,externalRequests,...(native?{actualTauriWebView2:true,nativeShell,nativeMainPid:child.pid,nativeMainExitCode:child.exitCode,ownedNativeProcesses:ownedNative,ownedNativeProcessesExited:true}:{})};
  await writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(error){
  await page?.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});
  await writeFile(path.join(evidence,'failure.json'),JSON.stringify({phase,message:error.message,errors,badAssets},null,2));
  throw error;
} finally {
  if(native&&child?.exitCode===null){await page?.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(()=>{});await pause(1000);if(child.exitCode===null)child.kill();}
  await browser?.close().catch(()=>{});await server?.close().catch(()=>{});await host?.close().catch(()=>{});await web?.close().catch(()=>{});
  fixture?.closeAllConnections();if(fixture?.listening)await new Promise(resolve=>fixture.close(resolve));
  for(const owned of ['app','assets','profile','sciencescope-desktop.exe'])await rm(path.join(root,owned),{recursive:true,force:true,maxRetries:6,retryDelay:500}).catch(()=>{});
}
