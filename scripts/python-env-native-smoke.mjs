// T11 native acceptance: an owned Tauri/WebView2 copy and the real Windows folder dialog.
// Run `node scripts/python-env-native-smoke.mjs --inspect-dialog` to capture UIA controls first.
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright-core';
import {createDesktopServer} from './preview-desktop.mjs';
import {apiFetch} from './smoke-auth.mjs';

assert.equal(process.platform, 'win32', 'native folder picker requires Windows');
const output = path.resolve('.sciencescope-local/temp/t11-native-validation');
await mkdir(output, {recursive: true});
const fixture = await mkdtemp(path.join(output, 'run-'));
const dataRoot = path.join(fixture, 'app');
const folderBase = path.resolve('.sciencescope-local/temp');
const folder = await mkdtemp(path.join(folderBase, 'f-'));
const exec = promisify(execFile);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const previousFeatures = process.env.SCIENCESCOPE_NATIVE_FEATURES;
process.env.SCIENCESCOPE_NATIVE_FEATURES = 'pickFolder';
let server, browser, page, child, phase = 'setup', diagnosticPort, owned = [];
const errors = [], screenshots = [], nativeIpc = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const poll = async (read, accept, label, timeout = 30000) => {
  const until = Date.now() + timeout;
  let value;
  do {value = await read(); if (accept(value)) return value; await pause(150);} while (Date.now() < until);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
};
const fakeUv = async (_command, args) => {
  if (args[0] === 'venv') {
    const scripts = path.join(args.at(-1), 'Scripts');
    await mkdir(scripts, {recursive: true});
    await writeFile(path.join(scripts, 'python.exe'), 'fake fixture interpreter');
  }
  if (args[0] === '--version') return {code: 0, stdout: 'Python 3.14.7\n', stderr: ''};
  if (args[0] === 'pip' && args[1] === 'compile') {
    await writeFile(args[args.indexOf('--output-file') + 1], await readFile(args[2]));
  }
  return {code: 0, stdout: '', stderr: ''};
};
const runtimeHost = {
  capabilities: {tokenStreaming: true}, close: async () => {}, observeSession: () => () => {},
  listProviders: async () => [], getRuntimeConfig: async () => ({}), getModelInfo: async () => ({}), getContextUsage: async () => null,
  startSession: async ({sessionId}) => sessionId || 'session-native-unused', configurePolicy: async () => {}, configureReasoning: async () => {},
  releaseSession: async () => {}, getGoal: async () => null, setToolHandler: () => {},
  send: async () => {throw new Error('T11 native picker smoke never calls a model');},
};
async function request(route, body) {
  const response = await apiFetch(server, `api/${route}`, body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  const result = await response.json();
  assert.equal(response.status, 200, `${route}: ${JSON.stringify(result)}`);
  return result;
}
async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}
async function ps(command, extra = {}) {
  const encoded = Buffer.from(`[Console]::OutputEncoding=[Text.Encoding]::UTF8\n${command}`, 'utf16le').toString('base64');
  try {
    const {stdout} = await exec(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024,
      env: {...process.env, TEMP: fixture, TMP: fixture, ...extra},
    });
    return stdout.trim();
  } catch (error) {throw new Error(`PowerShell UI automation failed: ${(error.stderr || error.stdout || error.message).slice(-2000)}`);}
}
async function processSnapshot() {
  const text = await ps('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress');
  const value = JSON.parse(text);
  return Array.isArray(value) ? value : [value];
}
async function ownedProcesses() {
  const all = await processSnapshot();
  const ids = new Set([child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of all) if (ids.has(process.ParentProcessId) && !ids.has(process.ProcessId)) {ids.add(process.ProcessId); changed = true;}
  }
  return all.filter(process => ids.has(process.ProcessId));
}
const uiaPrelude = `
Add-Type -AssemblyName UIAutomationClient
$desktop=[System.Windows.Automation.AutomationElement]::RootElement
$targetProcessId=[int]$env:T11_NATIVE_PID
$ownedProcessIds=@($env:T11_OWNED_PIDS -split ',' | ForEach-Object {[int]$_})
$all=$desktop.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class T11DialogWindow {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  public static long Find(int targetPid) {
    long found=0;
    EnumWindows((hwnd,state) => {
      uint pid; GetWindowThreadProcessId(hwnd,out pid);
      var kind=new StringBuilder(100); GetClassName(hwnd,kind,kind.Capacity);
      if(pid==targetPid && kind.ToString()=="#32770" && IsWindowVisible(hwnd)){found=hwnd.ToInt64();return false;}
      return true;
    },IntPtr.Zero);
    return found;
  }
}
'@
$handle=[T11DialogWindow]::Find($targetProcessId)
$dialog=if($handle -ne 0){[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)}else{$null}
`;
async function dialogSnapshot() {
  const command = `${uiaPrelude}
if(-not $dialog){ [pscustomobject]@{dialog=$null;windows=@($all | ForEach-Object { try {if($ownedProcessIds -contains $_.Current.ProcessId -or $_.Current.ClassName -eq '#32770' -or $_.Current.Name -like '*文件夹*'){[pscustomobject]@{name=$_.Current.Name;class=$_.Current.ClassName;processId=$_.Current.ProcessId}}}catch{}})} | ConvertTo-Json -Compress -Depth 6; exit }
$controls=@($dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
  try { [pscustomobject]@{name=$_.Current.Name;class=$_.Current.ClassName;id=$_.Current.AutomationId;type=$_.Current.ControlType.ProgrammaticName;enabled=$_.Current.IsEnabled} } catch {}
})
[pscustomobject]@{dialog=[pscustomobject]@{name=$dialog.Current.Name;class=$dialog.Current.ClassName;handle=$dialog.Current.NativeWindowHandle;bounds=[pscustomobject]@{x=$dialog.Current.BoundingRectangle.X;y=$dialog.Current.BoundingRectangle.Y;width=$dialog.Current.BoundingRectangle.Width;height=$dialog.Current.BoundingRectangle.Height}};controls=$controls} | ConvertTo-Json -Compress -Depth 8`;
  return JSON.parse(await ps(command, {T11_NATIVE_PID: String(child.pid), T11_OWNED_PIDS: owned.map(process => process.ProcessId).join(',')}));
}
async function captureOwnedWindow(file) {
  const command = `${uiaPrelude}
Add-Type -AssemblyName System.Drawing
$main=$all | Where-Object {try {$_.Current.ProcessId -eq $targetProcessId -and $_.Current.ClassName -eq 'Tauri Window'}catch {$false}} | Select-Object -First 1
if(-not $main){throw 'Owned native main window is absent'}
$r=$main.Current.BoundingRectangle
$bitmap=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try {$graphics.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bitmap.Size);$bitmap.Save($env:T11_DIALOG_SCREEN)} finally {$graphics.Dispose();$bitmap.Dispose()}`;
  await ps(command, {T11_NATIVE_PID: String(child.pid), T11_OWNED_PIDS: owned.map(process => process.ProcessId).join(','), T11_DIALOG_SCREEN: file});
}
async function win32Snapshot() {
  const command = `
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class T11WindowInfo { public long Hwnd {get;set;} public long Owner {get;set;} public int ProcessId {get;set;} public string Title {get;set;} public string ClassName {get;set;} public bool Visible {get;set;} }
public static class T11WindowQuery {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr state);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr state);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  public static T11WindowInfo[] Find(int[] owned) {
    var found=new List<T11WindowInfo>();
    EnumWindows((hwnd,state) => {
      uint pid; GetWindowThreadProcessId(hwnd,out pid);
      var title=new StringBuilder(500); GetWindowText(hwnd,title,title.Capacity);
      var kind=new StringBuilder(200); GetClassName(hwnd,kind,kind.Capacity);
      var titleText=title.ToString();
      if(Array.IndexOf(owned,(int)pid)>=0 || titleText.Contains("Native IPC probe") || titleText.Contains("选择工作文件夹"))
        found.Add(new T11WindowInfo {Hwnd=hwnd.ToInt64(),Owner=GetWindow(hwnd,4).ToInt64(),ProcessId=(int)pid,Title=titleText,ClassName=kind.ToString(),Visible=IsWindowVisible(hwnd)});
      return true;
    },IntPtr.Zero);
    return found.ToArray();
  }
}
'@
$owned=@($env:T11_OWNED_PIDS -split ',' | ForEach-Object {[int]$_})
[T11WindowQuery]::Find($owned) | ConvertTo-Json -Compress -Depth 4`;
  const text = await ps(command, {T11_OWNED_PIDS: owned.map(process => process.ProcessId).join(',')});
  const value = JSON.parse(text || '[]');
  return Array.isArray(value) ? value : [value];
}
async function dialogAction(action, screenshot) {
  const command = `${uiaPrelude}
if(-not $dialog){throw 'Native folder dialog is absent'}
if($env:T11_DIALOG_SCREEN) {
  Add-Type -AssemblyName System.Drawing
  $r=$dialog.Current.BoundingRectangle
  $bitmap=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {$graphics.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bitmap.Size);$bitmap.Save($env:T11_DIALOG_SCREEN)} finally {$graphics.Dispose();$bitmap.Dispose()}
}
if($env:T11_DIALOG_ACTION -eq 'capture'){exit}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class T11DialogControls {
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr dialog, int id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr hwnd, string text);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
}
'@
$handle=[IntPtr]$dialog.Current.NativeWindowHandle
[void][T11DialogControls]::SetForegroundWindow($handle)
if($env:T11_DIALOG_ACTION -eq 'cancel') {
  $cancel=[T11DialogControls]::GetDlgItem($handle,2)
  if($cancel -eq [IntPtr]::Zero){throw 'Windows Cancel control #2 is missing'}
  [void][T11DialogControls]::SendMessage($cancel,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)
  exit
}
Add-Type -AssemblyName System.Windows.Forms
$dialog.SetFocus()
[System.Windows.Forms.SendKeys]::SendWait('^l')
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait($env:T11_FOLDER)
Start-Sleep -Milliseconds 750
Write-Output ('TYPED_TARGET_LENGTH='+$env:T11_FOLDER.Length)
Start-Sleep -Milliseconds 250
if($env:T11_TYPED_SCREEN){
  Add-Type -AssemblyName System.Drawing
  $r=$dialog.Current.BoundingRectangle
  $bitmap=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {$graphics.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bitmap.Size);$bitmap.Save($env:T11_TYPED_SCREEN)} finally {$graphics.Dispose();$bitmap.Dispose()}
}
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 850
if($env:T11_ENTER_SCREEN){
  Add-Type -AssemblyName System.Drawing
  $r=$dialog.Current.BoundingRectangle
  $bitmap=New-Object System.Drawing.Bitmap([int]$r.Width,[int]$r.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  try {$graphics.CopyFromScreen([int]$r.X,[int]$r.Y,0,0,$bitmap.Size);$bitmap.Save($env:T11_ENTER_SCREEN)} finally {$graphics.Dispose();$bitmap.Dispose()}
}
$select=[T11DialogControls]::GetDlgItem($handle,1)
if($select -eq [IntPtr]::Zero){throw 'Windows Select Folder control #1 is missing'}
[void][T11DialogControls]::SendMessage($select,0xF5,[IntPtr]::Zero,[IntPtr]::Zero)`;
  const diagnostic = await ps(command, {T11_NATIVE_PID: String(child.pid), T11_OWNED_PIDS: owned.map(process => process.ProcessId).join(','), T11_DIALOG_ACTION: action, T11_FOLDER: folder, T11_DIALOG_SCREEN: screenshot || '', T11_TYPED_SCREEN: action === 'choose' ? path.join(output, 'native-typed-address.png') : '', T11_ENTER_SCREEN: action === 'choose' ? path.join(output, 'native-after-enter.png') : ''});
  if (action === 'choose' && diagnostic) console.log(diagnostic);
}
async function launch() {
  const existing = (await processSnapshot()).filter(process => process.Name?.toLowerCase() === 'sciencescope-desktop.exe');
  assert.equal(existing.length, 0, `Refusing to launch beside an existing ScienceScope client: ${JSON.stringify(existing)}`);
  const executable = path.join(fixture, 'sciencescope-desktop.exe');
  await copyFile(path.resolve('.sciencescope-local/build/tauri/debug/sciencescope-desktop.exe'), executable);
  diagnosticPort = await freePort();
  child = spawn(executable, [], {cwd: fixture, windowsHide: true, stdio: 'ignore', env: {
    ...process.env, SCIENCESCOPE_NODE: process.execPath,
    SCIENCESCOPE_HOST_SCRIPT: path.resolve('scripts/native-fixture-host.mjs'),
    SCIENCESCOPE_TEST_HOST_URL: server.url, SCIENCESCOPE_TEST_API_TOKEN: server.apiToken,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${diagnosticPort}`,
    TEMP: fixture, TMP: fixture,
  }});
  for (let attempt = 0; attempt < 60; attempt++) {
    try {browser = await chromium.connectOverCDP(`http://127.0.0.1:${diagnosticPort}`); break;}
    catch {await pause(500);}
  }
  assert.ok(browser, 'owned native WebView2 diagnostic connection required');
  page = await poll(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith(server.url) && !candidate.url().includes('surface=')), Boolean, 'actual native main page');
  assert.ok(await page.evaluate(() => !!window.__TAURI__?.core?.invoke), 'real Tauri bridge required');
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {if(new URL(request.url()).origin === 'http://ipc.localhost') nativeIpc.push(request.url());});
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopeCreation);
  owned = await ownedProcesses();
  assert.ok(owned.some(process => process.Name === 'node.exe'), 'native owns fixture readiness host');
  assert.ok(owned.some(process => /webview2/i.test(process.Name)), 'real WebView2 descendants exist');
}

try {
  phase = 'fixture server';
  server = await createDesktopServer({dataRoot, outputDir: path.join(fixture, 'assets'), runtimeHost,
    pythonOptions: {runner: fakeUv}, pythonBootstrap: false});
  const env = await request('python/envs', {action: 'create', name: 'Native Python A', version: '3.14.7'});
  await request('python/settings', {defaultEnvId: env.id});
  phase = 'owned native launch';
  await launch();
  assert.equal((await request('status')).features.folderPicker, true, 'fixture exposes the real native picker control');
  if (process.argv.includes('--probe-invoke')) {
    const probe = await page.evaluate(() => Promise.race([
      window.__TAURI__.core.invoke('pick_folder', {title: 'Native IPC probe'}).then(value => ({state: 'resolved', value}), error => ({state: 'rejected', error: String(error)})),
      new Promise(resolve => setTimeout(() => resolve({state: 'pending'}), 2000)),
    ]));
    owned = await ownedProcesses();
    const windows = await dialogSnapshot();
    const win32 = await win32Snapshot();
    await captureOwnedWindow(path.join(output, 'probe-owned-window.png'));
    if (windows.dialog) await dialogAction('cancel');
    throw new Error(`Native direct picker probe: ${JSON.stringify({probe, windows, win32})}`);
  }
  phase = 'real Windows folder picker';
  await page.evaluate(() => window.ScienceScopeCreation.newChat(null));
  await page.waitForSelector('#modal .creation-dialog #chat-python');
  assert.equal(await page.locator('#chat-python').inputValue(), env.id);
  await page.locator('input[name="chat-folder"][value="existing"]').check();
  assert.equal(await page.locator('[data-creation-pick]').isVisible(), true);
  await page.locator('[data-creation-pick]').click();
  await page.waitForTimeout(500);
  owned = await ownedProcesses();
  const toast = await page.locator('.toast').allInnerTexts();
  await captureOwnedWindow(path.join(output, 'clicked-owned-window.png'));
  const opened = await poll(dialogSnapshot, state => !!state.dialog, `actual Windows folder dialog; immediate toast=${JSON.stringify(toast)}`, 15000);
  await writeFile(path.join(output, 'dialog-controls.json'), JSON.stringify(opened, null, 2));
  await dialogAction('capture', path.join(output, 'native-folder-dialog.png'));
  screenshots.push(path.join(output, 'native-folder-dialog.png'));
  if (process.argv.includes('--inspect-dialog')) {
    console.log(JSON.stringify({inspection: true, dialog: opened, screenshot: screenshots[0]}));
    await dialogAction('cancel');
  } else {
    await dialogAction('choose');
    await page.waitForTimeout(500);
    await captureOwnedWindow(path.join(output, 'native-after-choose.png'));
    await writeFile(path.join(output, 'dialog-after-choose.json'), JSON.stringify(await dialogSnapshot(), null, 2));
    await poll(() => page.locator('#chat-folder-path').inputValue(), value => value.toLowerCase() === folder.toLowerCase(), 'native picker chose fixture folder');
    await page.locator('[data-creation-pick]').click();
    await poll(dialogSnapshot, state => !!state.dialog, 'actual Windows folder dialog for cancellation');
    await dialogAction('cancel');
    await poll(dialogSnapshot, state => !state.dialog, 'native folder dialog cancelled');
    assert.equal((await page.locator('#chat-folder-path').inputValue()).toLowerCase(), folder.toLowerCase(), 'cancel keeps the chosen folder');

    phase = 'secondary window permission boundary';
    const label = await page.evaluate(() => window.__TAURI__.core.invoke('open_secondary_window', {request: {surface: 'map'}}));
    assert.equal(label, 'secondary-map');
    const secondary = await poll(async () => browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().includes('surface=map')), Boolean, 'real secondary map window');
    await secondary.waitForFunction(() => !!window.__TAURI__?.core?.invoke);
    const refusal = await secondary.evaluate(async () => {
      try {return {accepted: await window.__TAURI__.core.invoke('pick_folder', {title: 'must be denied'})};}
      catch (error) {return {denied: String(error)};}
    });
    assert.ok(refusal.denied && /denied|not allowed|FOLDER_PICKER_MAIN_WINDOW_ONLY|permission/i.test(refusal.denied), `secondary picker must be structurally denied: ${JSON.stringify(refusal)}`);
    await secondary.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {});

    phase = 'native project-page folder binding';
    await page.evaluate(() => {document.getElementById('modal')?.remove(); go('project-new');});
    await page.waitForSelector('#new-project-path');
    await page.waitForSelector('#new-project-python');
    assert.equal(await page.locator('[data-action="pick-project-folder"]').isVisible(), true);
    await page.locator('#new-project-name').fill('Native fixture project');
    await page.locator('[data-action="pick-project-folder"]').click();
    await poll(dialogSnapshot, state => !!state.dialog, 'actual project-page Windows folder dialog');
    await dialogAction('choose');
    await poll(() => page.locator('#new-project-path').inputValue(), value => value.toLowerCase() === folder.toLowerCase(), 'project picker chose exact fixture folder');
    assert.equal((await page.locator('#new-project-path').inputValue()).toLowerCase(), folder.toLowerCase(), 'do not submit a non-fixture project path');
    await page.locator('[data-action="create-project"]').click();
    const projectId = await poll(() => page.evaluate(() => S.projects.find(project => project.name === 'Native fixture project')?.id), Boolean, 'native project created');
    await poll(() => request(`workbench?projectId=${encodeURIComponent(projectId)}`), value => value.folder?.toLowerCase() === folder.toLowerCase(), 'native project bound to exact fixture folder');
    assert.equal((await request(`python/resolve?projectId=${encodeURIComponent(projectId)}`)).envId, env.id);
    await poll(() => page.locator('.wb-path').getAttribute('title'), value => value?.toLowerCase() === folder.toLowerCase(), 'native workbench displays bound fixture folder');
    const projectShot = path.join(output, 'native-project-bound.png');
    await page.screenshot({path: projectShot}); screenshots.push(projectShot);

    phase = 'native bilingual screenshots';
    await page.evaluate(() => window.ScienceScopeCreation.newChat(null));
    await page.waitForSelector('#modal .creation-dialog #chat-python');
    for (const [language, theme] of [['zh-CN', 'light'], ['zh-CN', 'dark'], ['en', 'light'], ['en', 'dark']]) {
      await page.evaluate(({language, theme}) => {window.ScienceScopeI18n.setLanguage(language); document.documentElement.dataset.theme = theme;}, {language, theme});
      await page.waitForTimeout(250);
      const file = path.join(output, `native-creation-${language}-${theme}.png`);
      await page.screenshot({path: file}); screenshots.push(file);
    }
    assert.deepEqual(errors, []);
    assert.ok(nativeIpc.length > 0, 'folder picker and window calls used real native IPC');
  }

  phase = 'owned process-tree shutdown';
  await page.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(error => {if(!/closed/i.test(error.message)) throw error;});
  await poll(() => child.exitCode, value => value !== null, 'owned native main exits');
  assert.equal(child.exitCode, 0);
  await poll(async () => {const all = await processSnapshot(); return owned.filter(process => all.some(item => item.ProcessId === process.ProcessId));}, value => value.length === 0, 'all owned native descendants exit');
  const result = {passed: true, native: true, pickerOpened: true, ...(process.argv.includes('--inspect-dialog') ? {} : {fixtureFolderSelected: true, cancelPreservedSelection: true, secondaryDenied: true, projectFolderBound: true}),
    mainPid: child.pid, mainExitCode: child.exitCode, ownedProcessesExited: true, diagnosticPort, screenshots};
  await writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  await page?.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
  const details = {phase, message: error.message, screenshot: path.join(output, 'failure.png'), errors};
  await writeFile(path.join(output, 'failure.json'), JSON.stringify(details, null, 2));
  console.error(JSON.stringify(details));
  throw error;
} finally {
  if(child?.exitCode === null) {await page?.evaluate(() => window.__TAURI__.window.getCurrentWindow().close()).catch(() => {}); await pause(1000); if(child.exitCode === null) child.kill();}
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  if(previousFeatures === undefined) delete process.env.SCIENCESCOPE_NATIVE_FEATURES; else process.env.SCIENCESCOPE_NATIVE_FEATURES = previousFeatures;
  assert.equal(path.dirname(fixture), output, 'cleanup target must be exactly the owned fixture beneath project temp');
  await rm(fixture, {recursive: true, force: true, maxRetries: 6, retryDelay: 500});
  assert.equal(path.dirname(folder), folderBase, 'selected folder cleanup stays in project temp');
  await rm(folder, {recursive: true, force: true, maxRetries: 6, retryDelay: 500});
}
