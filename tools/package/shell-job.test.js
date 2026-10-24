import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { compileShellJob } from './shell-job.js';

const execute = promisify(execFile);

test(
  'installed shell uses its precompiled Job owner without compiling source at first use',
  { skip: process.platform !== 'win32' },
  async () => {
    const parent = path.resolve('.sciencescope-local/temp/r6c/shell-job');
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'case-'));
    const moduleDirectory = path.join(root, 'app/services/builtin-tools');
    const output = path.join(root, 'installed');
    try {
      await mkdir(moduleDirectory, { recursive: true });
      await writeFile(
        path.join(moduleDirectory, 'windows-shell-job.cs'),
        'using System; class Entry { static void Main() { Console.WriteLine("packaged-owner"); } }',
      );
      const executable = await compileShellJob(root, output);
      assert.equal((await execute(executable)).stdout.trim(), 'packaged-owner');
      const installed = path.join(output, 'app/services/builtin-tools');
      await mkdir(installed, { recursive: true });
      await cp(
        path.resolve('app/services/builtin-tools/windows-shell-job.js'),
        path.join(installed, 'windows-shell-job.js'),
      );
      await writeFile(path.join(output, 'package.json'), '{"type":"module"}');
      const { windowsShellJob } = await import(
        pathToFileURL(path.join(installed, 'windows-shell-job.js')).href
      );
      const temporary = path.join(root, 'must-not-compile');
      assert.equal(await windowsShellJob(temporary), executable);
      assert.equal(
        await access(temporary).then(
          () => true,
          () => false,
        ),
        false,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
