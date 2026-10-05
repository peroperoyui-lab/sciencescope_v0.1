// Opt-in T11 acceptance through an owned Tauri client, real Win32 picker, and real Go/DSH.
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {copyFile, mkdir, mkdtemp, readFile, stat} from 'node:fs/promises';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import {createContextLiveHarness} from './context-live-harness.mjs';

assert.equal(process.platform, 'win32');
assert.ok(process.argv.includes('--live'), 'Paid/native evaluation requires --live');
const temp = path.resolve('.sciencescope-local/temp');
const selected = await mkdtemp(path.join(temp, 'f-'));
const priorFeatures=process.env.SCIENCESCOPE_NATIVE_FEATURES;
process.env.SCIENCESCOPE_NATIVE_FEATURES='pickFolder';
const run = await createContextLiveHarness('python-native-live', {
  desktop: true, maxRequests: 8, maxTokens: 1536,
  apiOptions: {pythonBootstrap: false},
  evidenceFile: `native-live-${Date.now()}.json`,
});
const {desktopServer: server, call, model, evidence} = run;
const fixture = run.root;
const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const exec = promisify(execFile);
let child, browser, page, port, phase = 'preflight', owned = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(fn, good, label, timeout = 30000) {
  const end = Date.now() + timeout; let value;
  do {value = await fn(); if(good(value))return value; await pause(180);} while(Date.now() < end);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
async function ps(code, extra = {}) {
  const encoded = Buffer.from(`[Console]::OutputEncoding=[Text.Encoding]::UTF8\n${code}`, 'utf16le').toString('base64');
  const result = await exec(shell, ['-NoProfile','-NonInteractive','-EncodedCommand',encoded], {windowsHide:true,timeout:20000,maxBuffer:2e6,
    env:{...process.env,TEMP:fixture,TMP:fixture,...extra}});
  return result.stdout.trim();
}
async function processes() {
  const result = JSON.parse(await ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'));
  return Array.isArray(result) ? result : [result];
}
async function descendants() {
  const all = await processes(), ids = new Set([child.pid]); let added;
  do {added=false; for(const item of all)if(ids.has(item.ParentProcessId)&&!ids.has(item.ProcessId)){ids.add(item.ProcessId);added=true;}}while(added);
  return all.filter(item=>ids.has(item.ProcessId));
}
async function freePort() {
  const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const value=probe.address().port;await new Promise(resolve=>probe.close(resolve));return value;
}
const win32 = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class T11Picker {
  public delegate bool EnumProc(IntPtr hwnd,IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb,IntPtr state);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd,StringBuilder text,int len);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hwnd,int id);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd,uint msg,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  public static long Find(int wanted) {
    long found=0;EnumWindows((h,s)=>{uint pid;GetWindowThreadProcessId(h,out pid);
      var name=new StringBuilder(100);GetClassName(h,name,name.Capacity);
      if(pid==wanted&&name.ToString()=="#32770"&&IsWindowVisible(h)){found=h.ToInt64();return false;}return true;
    },IntPtr.Zero);return found;
  }
}
'@
$h=[IntPtr][T11Picker]::Find([int]$env:T11_NATIVE_PID)
`;
async function dialogHandle() {return Number(await ps(`${win32}\n$h.ToInt64()`,{T11_NATIVE_PID:String(child.pid)}));}
async function selectFolder() {
  const command=`${win32}
if($h -eq [IntPtr]::Zero){throw 'Native folder dialog absent'}
Add-Type -AssemblyName System.Windows.Forms
[void][T11Picker]::SetForegroundWindow($h)
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait($env:T11_FOLDER)
Start-Sleep -Milliseconds 750
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 850
$choose=[T11Picker]::GetDlgItem($h,1)
if($choose -eq [IntPtr]::Zero){throw 'Native Select Folder button absent'}
[void][T11Picker]::SendMessage($choose,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)`;
  await ps(command,{T11_NATIVE_PID:String(child.pid),T11_FOLDER:selected});
}
async function cancelDialog() {
  if(!child||!(await dialogHandle()))return;
  await ps(`${win32}\n$c=[T11Picker]::GetDlgItem($h,2);if($c -ne [IntPtr]::Zero){[void][T11Picker]::SendMessage($c,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)}`,{T11_NATIVE_PID:String(child.pid)});
}
async function launch() {
  const existing=(await processes()).filter(item=>item.Name?.toLowerCase()==='sciencescope-desktop.exe');
  assert.equal(existing.length,0,'Do not disturb any existing ScienceScope client');
  const exe=path.join(fixture,'sciencescope-desktop.exe');
  await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'),exe);
  port=await freePort();
  child=spawn(exe,[],{cwd:fixture,windowsHide:true,stdio:'ignore',env:{...process.env,
    SCIENCESCOPE_NODE:process.execPath,SCIENCESCOPE_HOST_SCRIPT:path.resolve('scripts/native-fixture-host.mjs'),
    SCIENCESCOPE_TEST_HOST_URL:server.url,SCIENCESCOPE_TEST_API_TOKEN:server.apiToken,
    SCIENCESCOPE_NATIVE_FEATURES:'pickFolder',WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
    TEMP:fixture,TMP:fixture}});
  for(let i=0;i<60&&!browser;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);}catch{await pause(500);}}
  assert.ok(browser,'Owned native WebView2 diagnostic connection required');
  page=await poll(async()=>browser.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().startsWith(server.url)&&!candidate.url().includes('surface=')),Boolean,'real native main page');
  await page.waitForFunction(()=>window.ScienceScopeWorkspace?.ready&&window.ScienceScopeCreation);
  assert.ok(await page.evaluate(()=>!!window.__TAURI__?.core?.invoke),'real Tauri bridge required');
  owned=await descendants();
  assert.ok(owned.some(item=>item.Name==='node.exe')&&owned.some(item=>/webview2/i.test(item.Name)),'owned native host and WebView2 descendants required');
}
const exists=async file=>stat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const answer=events=>events.filter(event=>event.type==='text-delta').map(event=>event.delta).join('');
async function send(chatId,text,mode) {return call('chat',{chatId,projectId,model,text,executionMode:mode});}
let projectId, outside, marker;
try {
  phase='owned native launch';await launch();
  phase='project page native picker';
  await page.evaluate(()=>go('project-new'));
  await page.waitForSelector('#new-project-path');
  await page.locator('#new-project-name').fill('T11 native live project');
  await page.locator('[data-action="pick-project-folder"]').click();
  await poll(dialogHandle,Boolean,'real Win32 folder picker');
  await selectFolder();
  await poll(()=>page.locator('#new-project-path').inputValue(),value=>value.toLowerCase()===selected.toLowerCase(),'native picker exact fixture selection');
  assert.equal((await page.locator('#new-project-path').inputValue()).toLowerCase(),selected.toLowerCase(),'never create project outside fixture');
  await page.locator('[data-action="create-project"]').click();
  projectId=await poll(()=>page.evaluate(()=>S.projects.find(project=>project.name==='T11 native live project')?.id),Boolean,'native project creation');
  await poll(()=>call(`workbench?projectId=${encodeURIComponent(projectId)}`),value=>value.folder?.toLowerCase()===selected.toLowerCase(),'native project folder binding');
  await poll(()=>page.locator('.wb-path').getAttribute('title'),value=>value?.toLowerCase()===selected.toLowerCase(),'native workbench renders bound folder');
  const shot=path.join(fixture,'native-project-picker-bound.png');await page.screenshot({path:shot});
  evidence.checks.nativePickerBound=true;evidence.checks.nativeScreenshot=shot;

  phase='real model project write';
  marker=path.join(selected,'go-wrote-project-marker.txt');
  assert.equal(await exists(marker),false);
  const chatId=`t11-native-write-${Date.now()}`;
  const events=await send(chatId,`Use the shell tool to create exactly one file in this project's directory: ${marker}. Write exactly T11_NATIVE_GO_WRITE_OK followed by a newline. Do not write or modify any other file. Then report completion briefly.`, 'full');
  assert.ok(events.some(event=>event.type==='tool-call'),'real Go must call a filesystem tool');
  assert.equal(await exists(marker),true,'real Go must create the marker');
  assert.equal((await readFile(marker,'utf8')).trim(),'T11_NATIVE_GO_WRITE_OK');
  evidence.checks.realGoProjectWrite=true;

  phase='ask-mode out-of-project write refusal';
  outside=path.join(temp,`t11-outside-${Date.now()}.txt`);
  assert.equal(await exists(outside),false);
  const deniedChat=`t11-native-denied-${Date.now()}`;
  let complete=false,stream,streamError,denied=false,approvalSeen=false;
  const task=send(deniedChat,`In ask mode, use the shell tool to write exactly T11_OUTSIDE_SHOULD_NOT_EXIST to ${outside}. This path is outside the current project folder. Do not write anywhere else. If the application asks for approval, wait for the user's decision.`, 'ask')
    .then(value=>stream=value,error=>streamError=error).finally(()=>complete=true);
  const deadline=Date.now()+120000;
  while(!complete&&Date.now()<deadline){
    const status=await call(`execution?chatId=${encodeURIComponent(deniedChat)}`);
    for(const approval of status.approvals||[]){approvalSeen=true;denied=true;await call('execution/approval',{chatId:deniedChat,requestId:approval.requestId,allowed:false});}
    await pause(300);
  }
  if(!complete){await call('chat/stop',{chatId:deniedChat}).catch(()=>{});await task;throw new Error('Ask-mode outside attempt timed out');}
  await task;if(streamError)throw streamError;
  assert.equal(await exists(outside),false,'out-of-project file must not exist');
  assert.ok(stream.some(event=>event.type==='tool-call'),'real Go must attempt an out-of-project tool call');
  evidence.checks.askOutsideDenied=true;evidence.checks.approvalSeen=approvalSeen;
  evidence.checks.askDenial=denied?'user-denied':'sandbox-denied';
  evidence.checks.realGoToolCalls={write:events.filter(event=>event.type==='tool-call').map(event=>event.name),outside:stream.filter(event=>event.type==='tool-call').map(event=>event.name)};
  evidence.checks.passed=true;
}catch(error){evidence.failure={phase,message:error.message};throw error;}
finally{
  phase='owned shutdown';
  await cancelDialog().catch(()=>{});
  if(page&&child?.exitCode===null)await page.evaluate(()=>window.__TAURI__.window.getCurrentWindow().close()).catch(()=>{});
  if(child){await poll(()=>child.exitCode,value=>value!==null,'owned native main exit',10000).catch(()=>{});if(child.exitCode===null)child.kill();
    evidence.checks.nativeMainExitCode=child.exitCode;
    await poll(async()=>{const all=await processes();return owned.filter(item=>all.some(current=>current.ProcessId===item.ProcessId));},value=>value.length===0,'owned native process tree exit',15000);
    evidence.checks.ownedProcessesExited=true;}
  await browser?.close().catch(()=>{});
  await run.close();
  if(priorFeatures===undefined)delete process.env.SCIENCESCOPE_NATIVE_FEATURES;else process.env.SCIENCESCOPE_NATIVE_FEATURES=priorFeatures;
  console.log(JSON.stringify({passed:evidence.checks.passed===true,root:run.root,selected,marker,outside,checks:evidence.checks,providerRequests:evidence.forwardedRequests}));
}
