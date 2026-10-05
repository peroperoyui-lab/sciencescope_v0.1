import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { validateWorkFolder } from '../scripts/workspace-folders.mjs';

test('working folders: real user directories only', async () => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'work-folders-'));
  try {
    const dataRoot = path.join(root, 'app');
    await mkdir(path.join(dataRoot, '.sciencescope-local', 'state'), { recursive: true });
    const project = path.join(root, 'research', '项目A'); await mkdir(project, { recursive: true });
    await writeFile(path.join(root, 'file.txt'), 'x');
    assert.deepEqual(await validateWorkFolder(project, { dataRoot }), { folder: project });
    await assert.rejects(validateWorkFolder('relative/path', { dataRoot }), /完整路径/);
    await assert.rejects(validateWorkFolder(path.join(root, 'missing'), { dataRoot }), /不存在/);
    await assert.rejects(validateWorkFolder(path.join(root, 'file.txt'), { dataRoot }), /文件夹/);
    await assert.rejects(validateWorkFolder(path.join(dataRoot, '.sciencescope-local', 'state'), { dataRoot }), /数据目录/);
    await assert.rejects(validateWorkFolder(dataRoot, { dataRoot }), /数据目录/, 'a folder containing the app data is refused');
    await assert.rejects(validateWorkFolder(path.parse(root).root, { dataRoot }), /整个磁盘/);
    if (process.platform !== 'win32') await assert.rejects(validateWorkFolder('/etc', { dataRoot }), /系统目录/);
    assert.match((await validateWorkFolder(os.homedir(), { dataRoot })).warning ?? '', /整个用户目录/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
