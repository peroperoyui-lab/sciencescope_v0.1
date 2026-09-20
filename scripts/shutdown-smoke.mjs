// End-to-end owned-process shutdown smoke. It is opt-in and requires a built client.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceExe = path.join(root, '.sciencescope-local', 'build', 'tauri', 'debug', 'sciencescope-desktop.exe');
const fixture = path.join(root, '.sciencescope-local', 'temp', `shutdown-smoke-${process.pid}`);
const exe = path.join(fixture, 'sciencescope-desktop.exe');
const readyFile = path.join(fixture, 'host-ready.json');
if (!process.env.SCOPESCOPE_RUN_NATIVE_SHUTDOWN_SMOKE) {
  console.log(JSON.stringify({skipped:true,reason:'set SCOPESCOPE_RUN_NATIVE_SHUTDOWN_SMOKE=1 to run the native smoke'}));
  process.exit(0);
}
try { await readFile(sourceExe); } catch { console.log(JSON.stringify({skipped:true,reason:'native debug executable is not built'})); process.exit(0); }
await mkdir(fixture, { recursive: true });
await copyFile(sourceExe, exe);
const hostCode = `
  import { spawn } from 'node:child_process';
  import { writeFile } from 'node:fs/promises';
  import path from 'node:path';
  import { createDesktopServer } from ${JSON.stringify(pathToFileURL(path.join(root, 'scripts', 'preview-desktop.mjs')).href)};
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {cwd: process.env.SCOPESCOPE_ROOT, stdio: 'ignore'});
  const desktop = await createDesktopServer({dataRoot: process.env.SCOPESCOPE_ROOT, outputDir: path.join(process.env.SCOPESCOPE_ROOT, 'desktop-dist')});
  await writeFile(process.env.SCOPESCOPE_READY, JSON.stringify({hostPid:process.pid, childPid: child.pid}));
  console.log(JSON.stringify({url:desktop.url,shutdownPath:desktop.shutdownPath,shutdownToken:desktop.shutdownToken}));
  process.on('SIGTERM', () => void desktop.close());
`;
const hostScript=path.join(fixture,'host.mjs');await writeFile(hostScript,hostCode);
const native = spawn(exe, [], {cwd: fixture, env: {...process.env, SCIENCESCOPE_NODE: process.execPath, SCIENCESCOPE_HOST_SCRIPT: hostScript, SCOPESCOPE_ROOT: fixture, SCOPESCOPE_READY: readyFile}, stdio: 'ignore'});
const nativeExit=new Promise(resolve=>native.once('exit',resolve));
const isAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { try { return JSON.parse(await readFile(readyFile, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 100)); } }
  throw new Error('timed out waiting for native-launched host');
};
const waitExit = child => new Promise(resolve => child.once('exit', resolve));
const sendClose = async pid => {
  const script = '$p=Get-Process -Id ' + pid + ' -ErrorAction Stop; if($p.MainWindowHandle -eq 0){exit 2}; Add-Type \'using System; using System.Runtime.InteropServices; public static class W { [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }\'; [W]::SendMessage($p.MainWindowHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero) | Out-Null';
  const result = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {stdio: 'ignore'});
  assert.equal(await waitExit(result), 0, 'native main window was closed via WM_CLOSE');
};
try {
  const ready = await waitFor();
  assert.equal(isAlive(ready.childPid), true, 'fixture host spawned the controlled descendant');
  await sendClose(native.pid);
  await Promise.race([nativeExit, new Promise((_, reject) => setTimeout(() => reject(new Error('native client did not exit')), 10_000))]);
  const deadline = Date.now() + 5000;
  while (isAlive(ready.childPid) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(isAlive(native.pid), false, 'native main PID is gone');
  assert.equal(isAlive(ready.hostPid), false, 'host PID is gone');
  assert.equal(isAlive(ready.childPid), false, 'host-owned descendant PID is gone');
  console.log(JSON.stringify({nativeClose:true, nativePid:native.pid, hostDescendantPid:ready.childPid, ownedPidsGone:true}));
} finally {
  if (native.exitCode === null) native.kill();
  try { await rm(fixture, {recursive:true, force:true, maxRetries:10, retryDelay:100}); } catch {}
}
