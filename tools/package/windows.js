// Resources preserve Node's module resolution and readable application sources.
// Sidecars suit single binaries; DSH, native modules and document assets need
// their complete neighbouring package trees instead.
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const local = path.join(root, '.sciencescope-local');
const stage = path.join(local, 'package/runtime-bundle');
const npm = process.env.npm_execpath;
const registry = process.env.SCIENCESCOPE_BUILD_REGISTRY || 'https://registry.npmmirror.com';

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

async function downloadNode() {
  const folder = path.join(local, 'downloads/node-22.22.2');
  const target = path.join(folder, 'node.exe');
  const base = 'https://npmmirror.com/mirrors/node/v22.22.2/';
  await mkdir(folder, { recursive: true });
  const sums = await fetch(base + 'SHASUMS256.txt').then((response) => {
    if (!response.ok) throw new Error(`Node checksums HTTP ${response.status}`);
    return response.text();
  });
  const expected = sums
    .split('\n')
    .find((line) => line.endsWith('  win-x64/node.exe'))
    ?.split(' ')[0];
  if (!expected) throw new Error('Node Windows x64 checksum missing');
  try {
    await access(target);
  } catch {
    const response = await fetch(base + 'win-x64/node.exe');
    if (!response.ok) throw new Error(`Node HTTP ${response.status}`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
  const digest = createHash('sha256')
    .update(await readFile(target))
    .digest('hex');
  const pinned = 'ae1a50511be58e987483fdbc12125407443926d2d394669ade2352776e920dd3';
  if (digest !== expected || digest !== pinned)
    throw new Error('Node checksum mismatch; no alternate source used');
  return target;
}

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Package requires Windows x64');
if (!npm) throw new Error('Run using npm run package');
await mkdir(stage, { recursive: true });
await mkdir(path.join(local, 'dist'), { recursive: true });
for (const file of ['package.json', 'package-lock.json', '.npmrc', 'LICENSE'])
  await cp(path.join(root, file), path.join(stage, file));
await run(
  process.execPath,
  [
    npm,
    'ci',
    '--omit=dev',
    '--registry=' + registry,
    '--cache=' + path.join(local, 'npm-cache'),
    '--prefer-offline',
    '--no-audit',
    '--no-fund',
  ],
  stage,
);
for (const folder of ['app', 'python', 'models']) {
  // Remove only the checked, fixed staging subdirectory; updates must not retain
  // a deleted program file from a prior build. This directory never contains data.
  const target = path.resolve(stage, folder);
  if (path.dirname(target) !== stage) throw new Error('Invalid staging directory');
  await rm(target, { recursive: true, force: true });
  await cp(path.join(root, folder), path.join(stage, folder), {
    recursive: true,
    filter: (source) => !source.endsWith('.test.js') && !source.endsWith('testing.js'),
  });
}
await mkdir(path.join(stage, 'reference'), { recursive: true });
await cp(
  path.join(root, 'reference/ScienceScope_Logo.png'),
  path.join(stage, 'reference/ScienceScope_Logo.png'),
);
await mkdir(path.join(stage, 'runtime'), { recursive: true });
await cp(await downloadNode(), path.join(stage, 'runtime/node.exe'));
await cp(
  process.env.SCIENCESCOPE_UV || path.join(local, 'runtimes/uv/uv.exe'),
  path.join(stage, 'runtime/uv.exe'),
);
const resources = {};
for (const folder of ['app', 'python', 'models', 'reference', 'runtime', 'node_modules'])
  resources[path.join(stage, folder) + '/'] = folder + '/';
resources[path.join(stage, 'package.json')] = 'package.json';
resources[path.join(stage, 'LICENSE')] = 'LICENSE';
const config = path.join(local, 'package/tauri-package.json');
await mkdir(path.join(local, 'package/frontend'), { recursive: true });
await writeFile(
  path.join(local, 'package/frontend/index.html'),
  '<!doctype html><title>ScienceScope</title>',
);
await writeFile(
  config,
  JSON.stringify(
    {
      build: { frontendDist: path.join(local, 'package/frontend') },
      bundle: {
        active: true,
        targets: ['nsis'],
        publisher: 'peroperoyui',
        resources,
        windows: {
          nsis: {
            installMode: 'currentUser',
            displayLanguageSelector: true,
            languages: ['SimpChinese', 'English'],
          },
        },
      },
    },
    null,
    2,
  ),
);
await run(
  path.join(
    process.env.SystemRoot || 'C:/Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  ),
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'tools/package/build-native.ps1'),
    '-Config',
    config,
  ],
);
const output = path.join(local, 'build/tauri/release/bundle/nsis');
await cp(output, path.join(local, 'dist'), { recursive: true });
console.log('Installer output: ' + path.join(local, 'dist'));
