import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);

test('NSIS overlay removes old program paths while preserving data and user files', async (t) => {
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
    for (const file of [...folders.map((folder) => folder + '/obsolete.txt'), ...files, ...keep]) {
      await mkdir(path.dirname(path.join(target, file)), { recursive: true });
      await writeFile(path.join(target, file), 'original ' + file);
    }
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
    await execute(executable, [], { windowsHide: true });
    for (const entry of [...folders, ...files])
      assert.equal(
        await access(path.join(target, entry)).then(
          () => true,
          () => false,
        ),
        false,
      );
    for (const file of keep)
      assert.equal(await readFile(path.join(target, file), 'utf8'), 'original ' + file);
    // With no old executable, a destination containing user files is left alone.
    await mkdir(path.join(target, 'app'));
    await writeFile(path.join(target, 'app/personal.txt'), 'not an installation');
    await execute(executable, [], { windowsHide: true });
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
