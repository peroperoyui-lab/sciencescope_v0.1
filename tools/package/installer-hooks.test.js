import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile, stat, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { writeProgramManifest } from './program-manifest.js';

const execute = promisify(execFile);

test('minimum requirements inspect actual host memory in a bilingual fixture without installing', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows NSIS compiler');
  const compiler = path.resolve(
    process.env.SCIENCESCOPE_MAKENSIS || '.sciencescope-local/build/tauri/.tauri/NSIS/makensis.exe',
  );
  if (
    !(await access(compiler).then(
      () => true,
      () => false,
    ))
  )
    return t.skip('Set SCIENCESCOPE_MAKENSIS to a cached compiler');
  const parent = path.resolve('.sciencescope-local/temp/r6b/installer-checks');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  try {
    const executable = path.join(root, 'fixture.exe');
    const source = path.join(root, 'fixture.nsi');
    const manifest = await writeProgramManifest(root, { mainBinary: 'test-app.exe' });
    await writeFile(
      source,
      '\uFEFF' +
        `
Unicode true
!include LogicLib.nsh
!include MUI2.nsh
Name "ScienceScope Install Test"
OutFile "${executable}"
InstallDir "$TEMP\\ScienceScope fixture"
RequestExecutionLevel user
SilentInstall silent
!define MAINBINARYNAME "test-app"
!define PRODUCTNAME "ScienceScope Install Test"
!define SCIENCESCOPE_INSTALL_TEST
!define SCIENCESCOPE_PROGRAM_MANIFEST "${manifest}"
Var PassiveMode
Var UpdateMode
!macro CheckIfAppIsRunning executablePath productName
!macroend
!include "${path.resolve('tools/package/installer-hooks.nsh')}"
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section
  !insertmacro NSIS_HOOK_PREINSTALL
  FileOpen $R0 "${root}\\detected-memory.txt" w
  FileWrite $R0 "$ScienceScopeMemory"
  FileClose $R0
  !insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
`,
    );
    await execute(compiler, ['/V2', source], { windowsHide: true });
    await execute(executable, [], {
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    });
    const detected = Number(await readFile(path.join(root, 'detected-memory.txt'), 'utf8'));
    const phases = await readFile(
      path.join(root, 'ScienceScope Install Test-install-phases.log'),
      'utf8',
    );
    assert.deepEqual(
      phases
        .trim()
        .split(/\r?\n/u)
        .map((line) => line.split(' ')[0]),
      ['preinstall', 'write-start', 'postinstall'],
    );
    const powershell = path.join(
      process.env.SystemRoot || 'C:/Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const expected = await execute(
      powershell,
      [
        '-NoProfile',
        '-Command',
        '[math]::Floor((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize / 1024)',
      ],
      { windowsHide: true },
    );
    assert.equal(
      detected,
      Number(expected.stdout.trim()),
      'NSIS GlobalMemoryStatusEx matches Windows visible physical memory',
    );
    t.diagnostic(`NSIS and Windows visible physical memory: ${detected} MiB`);
  } finally {
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
});

test('NSIS overlay removes only obsolete program files and preserves shared files and data', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows NSIS integration');
  const compiler = path.resolve(
    process.env.SCIENCESCOPE_MAKENSIS || '.sciencescope-local/build/tauri/.tauri/NSIS/makensis.exe',
  );
  if (
    !(await access(compiler).then(
      () => true,
      () => false,
    ))
  )
    return t.skip('Run npm run package once or set SCIENCESCOPE_MAKENSIS');
  const parent = path.resolve('.sciencescope-local/temp/installer-hooks');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'case-'));
  const target = path.join(root, '中文安装目录');
  const folders = ['app', 'node_modules', 'runtime', 'python', 'models', 'reference'];
  const files = ['package.json', 'LICENSE', 'THIRD_PARTY_NOTICES', 'test-app.exe'];
  const keep = ['data/标记.txt', 'data/sciencescope.sqlite', '自己的资料/稿件.md', 'notes.txt'];
  try {
    const longFile = 'node_modules/' + 'long-segment/'.repeat(18) + 'obsolete.js';
    const shared = ['app/keep.js', 'runtime/node.exe', 'test-app.exe', 'LICENSE'];
    for (const file of [
      ...folders.map((folder) => folder + '/obsolete.txt'),
      ...files,
      ...keep,
      ...shared,
      longFile,
    ]) {
      await mkdir(path.dirname(path.join(target, file)), { recursive: true });
      await writeFile(path.join(target, file), 'original ' + file);
    }
    const before = new Map(
      await Promise.all(
        shared.map(async (file) => [file, (await stat(path.join(target, file))).mtimeMs]),
      ),
    );
    // A user-added junction must not turn legacy enumeration into data removal.
    await symlink(path.join(target, 'data'), path.join(target, 'app', 'linked-data'), 'junction');
    const manifest = path.join(root, 'new-files.txt');
    await writeFile(
      manifest,
      [...shared, 'package.json', 'THIRD_PARTY_NOTICES', 'program-files.txt'].join('\r\n') + '\r\n',
    );
    const source = path.join(root, 'fixture.nsi');
    const executable = path.join(root, 'fixture.exe');
    await writeFile(
      source,
      '\uFEFF' +
        `
Unicode true
!include LogicLib.nsh
Name "ScienceScope cleanup fixture"
OutFile "${executable}"
InstallDir "${target}"
RequestExecutionLevel user
SilentInstall silent
!define MAINBINARYNAME "test-app"
!define PRODUCTNAME "ScienceScope cleanup fixture"
!define SCIENCESCOPE_PROGRAM_MANIFEST "${manifest}"
Var PassiveMode
Var UpdateMode
!macro CheckIfAppIsRunning executablePath productName
!macroend
!include "${path.resolve('tools/package/installer-hooks.nsh')}"
Section
  SetOutPath $INSTDIR
  !insertmacro NSIS_HOOK_PREINSTALL
SectionEnd
`,
    );
    await execute(compiler, ['/V2', source], { windowsHide: true });
    await execute(executable, [], {
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    });
    for (const entry of [...folders.map((folder) => folder + '/obsolete.txt'), longFile])
      assert.equal(
        await access(path.join(target, entry)).then(
          () => true,
          () => false,
        ),
        false,
      );
    for (const file of keep)
      assert.equal(await readFile(path.join(target, file), 'utf8'), 'original ' + file);
    for (const file of shared) {
      assert.equal(await readFile(path.join(target, file), 'utf8'), 'original ' + file);
      assert.equal((await stat(path.join(target, file))).mtimeMs, before.get(file));
    }
    const firstCleanup = JSON.parse(
      (
        await readFile(path.join(root, 'ScienceScope cleanup fixture-cleanup.json'), 'utf8')
      ).replace(/^\uFEFF/, ''),
    );
    assert.equal(firstCleanup.removedFiles, folders.length + 1);
    // Subsequent versions use the old manifest, leaving unlisted user additions.
    await writeFile(path.join(target, 'app/old-only.js'), 'obsolete');
    await writeFile(path.join(target, 'app/unlisted.txt'), 'user addition');
    await writeFile(
      path.join(target, 'program-files.txt'),
      [...shared, 'app/old-only.js', 'app/linked-data/标记.txt'].join('\r\n'),
    );
    await execute(executable, [], {
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    });
    assert.equal(
      await access(path.join(target, 'app/old-only.js')).then(
        () => true,
        () => false,
      ),
      false,
    );
    assert.equal(await readFile(path.join(target, 'app/unlisted.txt'), 'utf8'), 'user addition');
    assert.equal(
      await readFile(path.join(target, 'data/标记.txt'), 'utf8'),
      'original data/标记.txt',
    );
    // With no old executable, a destination containing user files is left alone.
    await rm(path.join(target, 'test-app.exe'));
    await mkdir(path.join(target, 'app'), { recursive: true });
    await writeFile(path.join(target, 'app/personal.txt'), 'not an installation');
    await execute(executable, [], {
      windowsHide: true,
      env: { ...process.env, TEMP: root, TMP: root },
    });
    assert.equal(
      await readFile(path.join(target, 'app/personal.txt'), 'utf8'),
      'not an installation',
    );
  } finally {
    // root is created by mkdtemp beneath the fixed test directory above.
    assert.equal(path.dirname(root), parent);
    await rm(root, { recursive: true, force: true });
  }
});
