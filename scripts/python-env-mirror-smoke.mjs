// Opt-in real uv mirror acceptance against an owned T11 fixture; no model calls.
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createPythonEnvironmentService } from './python-env/environments.mjs';

const index = process.argv.indexOf('--root');
if (index < 0) throw new Error('Pass --root for an existing owned T11 acceptance fixture');
const root = path.resolve(process.argv[index + 1]);
assert.equal(path.dirname(root), path.resolve('.sciencescope-local/temp/t11-validation'));
const db = new DatabaseSync(path.join(root, '.sciencescope-local/state/sciencescope.sqlite'));
const service = createPythonEnvironmentService({ database: db, dataRoot: root, uvPath: path.resolve('.sciencescope-local/runtimes/uv/uv.exe') });
const evidence = { root, modelRequests: 0, startedAt: new Date().toISOString() };
const previous = await service.getSettings();
try {
  const mirror = 'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple';
  await service.updateSettings({ indexUrl: mirror });
  assert.equal((await service.getSettings()).indexUrl, mirror);
  const env = await service.operate({ action: 'create', name: 'Mirror acceptance C', version: '3.14.7' });
  await service.packages({ envId: env.id, action: 'add', packages: ['boltons==25.0.0'], actor: 'acceptance', reason: 'Test-only configured mirror download' });
  const python = path.join(root, '.sciencescope-local/python/envs', env.id, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const result = await promisify(execFile)(python, ['-c', 'import importlib.metadata; print(importlib.metadata.version("boltons"))'], { windowsHide: true });
  assert.equal(result.stdout.trim(), '25.0.0');
  evidence.envId = env.id;
  evidence.mirror = mirror;
  evidence.package = 'boltons==25.0.0';
  evidence.passed = true;
} catch (error) {
  evidence.failure = { name: error.name, code: error.code, message: error.message };
  process.exitCode = 1;
} finally {
  await service.updateSettings({ indexUrl: previous.indexUrl });
  evidence.settingsRestored = (await service.getSettings()).indexUrl === previous.indexUrl;
  await service.close();
  db.close();
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, `mirror-result-${Date.now()}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
