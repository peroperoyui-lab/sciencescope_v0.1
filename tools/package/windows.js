// Resources preserve Node's module resolution and readable application sources.
// Sidecars suit single binaries; DSH, native modules and document assets need
// their complete neighbouring package trees instead.
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateNotices } from './notices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const local = path.join(root, '.sciencescope-local');
const stage = path.join(local, 'package/runtime-bundle');
const npm = process.env.npm_execpath;
const registry = process.env.SCIENCESCOPE_BUILD_REGISTRY || 'https://registry.npmmirror.com';

function run(command, args, cwd = root, successCodes = [0]) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) =>
      successCodes.includes(code) ? resolve() : reject(new Error(`${command} exited ${code}`)),
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

async function locateUv() {
  if (process.env.SCIENCESCOPE_UV) return process.env.SCIENCESCOPE_UV;
  const target = path.join(local, 'runtimes/uv/uv.exe');
  const pinned = 'f94eddb81f3addca6ef8f2361a70c3edde31adcbd1000a55fc6674306ae0b1e7';
  try {
    await access(target);
    await access(path.join(local, 'runtimes/uv/LICENSE-MIT'));
    await access(path.join(local, 'runtimes/uv/LICENSE-APACHE'));
  } catch {
    const folder = path.join(local, 'downloads/uv-0.12.19');
    await mkdir(folder, { recursive: true });
    const response = await fetch(
      'https://pypi.tuna.tsinghua.edu.cn/packages/c2/5d/8e0b84503b77ead843ef57e4f9305eb32a95cac6806c0e0d54b9404a5f7b/uv-0.12.19-py3-none-win_amd64.whl',
    );
    if (!response.ok) throw new Error(`uv HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      createHash('sha256').update(bytes).digest('hex') !==
      'dcbc531a96762569bbfe9639b4f45f00aabff51f427540711f63e7c23f225fdf'
    )
      throw new Error('uv wheel checksum mismatch');
    const { default: JSZip } = await import('jszip');
    const archive = await JSZip.loadAsync(bytes);
    const entry = Object.values(archive.files).find((file) => file.name.endsWith('/uv.exe'));
    if (!entry) throw new Error('uv executable missing from wheel');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, await entry.async('nodebuffer'));
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) {
      const license = Object.values(archive.files).find((file) =>
        file.name.endsWith('/licenses/' + name),
      );
      if (!license) throw new Error(`uv license missing: ${name}`);
      await writeFile(path.join(path.dirname(target), name), await license.async('nodebuffer'));
    }
  }
  if (
    createHash('sha256')
      .update(await readFile(target))
      .digest('hex') !== pinned
  )
    throw new Error(
      'uv checksum mismatch; use SCIENCESCOPE_UV only for an explicit build override',
    );
  return target;
}

if (process.platform !== 'win32' || process.arch !== 'x64')
  throw new Error('Package requires Windows x64');
if (!npm) throw new Error('Run using npm run package');
await mkdir(stage, { recursive: true });
await mkdir(path.join(local, 'dist'), { recursive: true });
const manifestHash = createHash('sha256');
for (const file of ['package.json', 'package-lock.json', '.npmrc'])
  manifestHash.update(await readFile(path.join(root, file)));
const dependencyHash = manifestHash.digest('hex');
const stamp = path.join(local, 'package/production-dependencies.sha256');
const previousHash = await readFile(stamp, 'utf8').catch(() => '');
for (const file of ['package.json', 'package-lock.json', '.npmrc', 'LICENSE'])
  await cp(path.join(root, file), path.join(stage, file));
if (previousHash !== dependencyHash) {
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
  await writeFile(stamp, dependencyHash);
}
// onnxruntime-node's tarball includes other architectures even after npm's
// platform selection. Keep only the Windows x64 native payload in this bundle.
const nativeRoot = path.join(stage, 'node_modules/onnxruntime-node/bin/napi-v6');
for (const relative of ['linux', 'darwin', 'win32/arm64']) {
  const target = path.resolve(nativeRoot, relative);
  if (!target.startsWith(nativeRoot + path.sep)) throw new Error('Invalid native staging path');
  await rm(target, { recursive: true, force: true });
}
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
await cp(await locateUv(), path.join(stage, 'runtime/uv.exe'));
const nodeLicense = path.join(local, 'downloads/node-22.22.2/LICENSE');
try {
  await access(nodeLicense);
} catch {
  // The binary mirror does not publish the complete dependency notices separately.
  // Fetch this small text from the exact upstream release, never another version.
  const response = await fetch('https://raw.githubusercontent.com/nodejs/node/v22.22.2/LICENSE');
  if (!response.ok) throw new Error(`Node license HTTP ${response.status}`);
  await writeFile(nodeLicense, await response.text());
}
await generateNotices(path.join(stage, 'node_modules'), path.join(stage, 'THIRD_PARTY_NOTICES'), [
  {
    name: 'Node.js',
    version: '22.22.2',
    license: 'MIT and bundled dependency licenses',
    repository: 'https://github.com/nodejs/node/tree/v22.22.2',
    texts: [await readFile(nodeLicense, 'utf8')],
  },
  {
    name: 'uv',
    version: '0.12.19',
    license: 'MIT OR Apache-2.0',
    repository: 'https://github.com/astral-sh/uv/tree/0.12.19',
    texts: [
      await readFile(path.join(local, 'runtimes/uv/LICENSE-MIT'), 'utf8'),
      await readFile(path.join(local, 'runtimes/uv/LICENSE-APACHE'), 'utf8'),
    ],
  },
]);
// Tauri copies every resource serially during its build script. Pre-stage with
// Windows' parallel copy, then reference the exact destination so tauri-build
// skips redundant copies. Data is never part of either staging directory.
// Each folder is mirrored on its own: /MIR drops files deleted since the last
// build, and the release root itself also holds Cargo's output, so it is not mirrored.
const release = path.join(local, 'build/tauri/release');
const folders = ['app', 'python', 'models', 'reference', 'runtime', 'node_modules'];
const files = ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES'];
await mkdir(release, { recursive: true });
for (const folder of folders)
  await run(
    path.join(process.env.SystemRoot || 'C:/Windows', 'System32/robocopy.exe'),
    [
      path.join(stage, folder),
      path.join(release, folder),
      '/MIR',
      '/MT:16',
      '/R:1',
      '/W:1',
      '/NFL',
      '/NDL',
      '/NJH',
      '/NJS',
      '/NP',
    ],
    root,
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
for (const file of files) await cp(path.join(stage, file), path.join(release, file));
const resources = {};
for (const folder of folders) resources[path.join(release, folder) + '/'] = folder + '/';
for (const file of files) resources[path.join(release, file)] = file;
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
        useLocalToolsDir: true,
        targets: ['nsis'],
        publisher: 'peroperoyui',
        resources,
        windows: {
          nsis: {
            installerHooks: path.join(root, 'src-tauri/installer-hooks.nsh'),
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
