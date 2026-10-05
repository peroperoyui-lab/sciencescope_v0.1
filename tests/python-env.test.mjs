import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createPythonEnvironmentService, PythonEnvironmentError } from '../scripts/python-env/environments.mjs';
import { createUvCommand } from '../scripts/python-env/uv.mjs';
async function fakeInterpreter(args){if(args[0]!=='venv')return;const directory=path.join(args.at(-1),process.platform==='win32'?'Scripts':'bin');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,process.platform==='win32'?'python.exe':'python'),'fixture interpreter');}

test('python environment create, bindings, resolution, settings and package validation', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-env-${randomUUID()}`);
  await mkdir(fixtureRoot, { recursive: true });
  const db = new DatabaseSync(path.join(fixtureRoot, 'test.sqlite'));
  const calls = [];
  const service = createPythonEnvironmentService({
    database: db, dataRoot: fixtureRoot, uvPath: 'fake-uv',
    runner: async (command, args, options) => {
      await fakeInterpreter(args);
      const call = { command, args, env: options.env };
      calls.push(call);
      if (args[0] === '--version') return { code: 0, stdout: 'Python 3.14.7\n', stderr: '' };
      if (args[1] === 'compile') {
        const outputPath = args[args.indexOf('--output-file') + 1];
        try { call.previousLock = await readFile(outputPath, 'utf8'); } catch { call.previousLock = ''; }
        const manifest = await readFile(args[2], 'utf8');
        await writeFile(outputPath, manifest, 'utf8');
      }
      return { code: 0, stdout: '', stderr: '' };
    },
    getChat: async () => ({ projectId: 'project-1' }),
  });
  try {
    const created = await service.operate({ action: 'create', name: 'Analysis', version: '3.14' });
    assert.equal(created.status, 'ready');
    assert.equal(created.version, '3.14.7');
    assert.equal((await service.resolve({ chatId: 'chat-1', projectId: 'project-1' })).kind, 'system');
    await service.bind({ scope: 'project', targetId: 'project-1', envId: created.id });
    assert.equal((await service.resolve({ chatId: 'chat-1', projectId: 'project-1' })).envId, created.id);
    await service.bind({ scope: 'chat', targetId: 'chat-1', envId: 'system' });
    assert.equal((await service.resolve({ chatId: 'chat-1', projectId: 'project-1' })).kind, 'system');
    await service.bind({ scope: 'chat', targetId: 'chat-1', envId: null });
    assert.equal((await service.resolve({ chatId: 'chat-1', projectId: 'project-1' })).envId, created.id);
    assert.equal((await service.list()).envs[0].usageCount, 1);
    await service.updateSettings({ indexUrl: 'https://pypi.org/simple', autoApproveFull: true });
    assert.deepEqual(await service.getSettings(), { defaultEnvId: null, indexUrl: 'https://pypi.org/simple', autoApproveFull: true });
    await assert.rejects(service.updateSettings({ autoApproveFull: 'false' }), (error) => error.code === 'INVALID_SETTING');
    assert.deepEqual(await service.validatePackages(['numpy>=1.0,<3', 'pandas[performance]==2.0']), ['numpy>=1.0,<3', 'pandas[performance]==2.0']);
    await assert.rejects(service.validatePackages(['-e .']), (error) => error instanceof PythonEnvironmentError && error.code === 'INVALID_PACKAGE_SPEC');
    const added = await service.packages({ envId: created.id, action: 'add', packages: ['numpy>=2'], actor: 'assistant', reason: 'array calculations' });
    assert.deepEqual(added.packages, ['numpy>=2']);
    await service.packages({ envId: created.id, action: 'sync', packages: ['numpy==2.0', 'pandas'], reason: 'reproducible set' });
    const compileCalls = calls.filter((call) => call.args[1] === 'compile');
    assert.match(compileCalls[1].previousLock, /numpy>=2/u, 'existing versions seed the next resolution');
    assert.match(await service.exportManifest(created.id), /numpy==2\.0/u);
    const copy = await service.operate({ action: 'copy', envId: created.id, name: 'Copy' });
    assert.deepEqual(copy.packages, ['numpy==2.0', 'pandas']);
    await assert.rejects(service.operate({ action: 'remove', envId: created.id }), (error) => error.code === 'ENVIRONMENT_IN_USE' && error.status === 409);
    await service.bind({ scope: 'project', targetId: 'project-1', envId: null });
    assert.equal((await service.operate({ action: 'remove', envId: created.id })).removed, true);
    assert.ok((await service.getLogs(copy.id)).length >= 1);
    assert.deepEqual(calls.map((call) => call.args[0] === '--version' ? 'python --version' : call.args.slice(0, 2).join(' ')), ['venv --managed-python', 'python --version', 'pip compile', 'pip sync', 'pip compile', 'pip sync', 'venv --managed-python', 'python --version', 'pip sync']);
    assert.equal(calls[0].env.UV_NO_CONFIG, '1');
    assert.ok(calls[0].env.PIP_CONFIG_FILE);
  } finally {
    await service.close(); db.close(); await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('uv config is isolated and retries hardlink failures with copy mode', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-uv-${randomUUID()}`);
  const inherited = { UV_INDEX_URL: process.env.UV_INDEX_URL, PIP_INDEX_URL: process.env.PIP_INDEX_URL,
    HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, APPDATA: process.env.APPDATA };
  await mkdir(path.join(fixtureRoot, 'appdata', 'uv'), { recursive: true });
  await mkdir(path.join(fixtureRoot, 'appdata', 'pip'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'appdata', 'uv', 'uv.toml'), '[broken\nthis is invalid');
  await writeFile(path.join(fixtureRoot, 'appdata', 'pip', 'pip.ini'), '[global]\nindex-url=https://invalid.example/simple\n');
  process.env.UV_INDEX_URL = 'https://invalid.example/simple';
  process.env.PIP_INDEX_URL = 'https://invalid.example/pip';
  process.env.HOME = path.join(fixtureRoot, 'home');
  process.env.USERPROFILE = path.join(fixtureRoot, 'home');
  process.env.APPDATA = path.join(fixtureRoot, 'appdata');
  const calls = [];
  try {
    const uv = createUvCommand({ dataRoot: fixtureRoot, uvPath: 'fake-uv', runner: async (_command, _args, options) => {
      calls.push({ env: { ...options.env } });
      if (calls.length === 1) throw new Error('hardlink operation failed');
      return { code: 0, stdout: '', stderr: '' };
    } });
    await uv.run(['pip', 'sync']);
    assert.equal(calls[0].env.UV_INDEX_URL, undefined);
    assert.equal(calls[0].env.PIP_INDEX_URL, undefined);
    assert.equal(calls[0].env.UV_NO_CONFIG, '1');
    assert.equal(calls[0].env.PIP_CONFIG_FILE, os.devNull);
    assert.equal(calls[0].env.UV_LINK_MODE, 'hardlink');
    assert.equal(calls[1].env.UV_LINK_MODE, 'copy');
  } finally {
    if (inherited.UV_INDEX_URL === undefined) delete process.env.UV_INDEX_URL; else process.env.UV_INDEX_URL = inherited.UV_INDEX_URL;
    if (inherited.PIP_INDEX_URL === undefined) delete process.env.PIP_INDEX_URL; else process.env.PIP_INDEX_URL = inherited.PIP_INDEX_URL;
    if (inherited.HOME === undefined) delete process.env.HOME; else process.env.HOME = inherited.HOME;
    if (inherited.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = inherited.USERPROFILE;
    if (inherited.APPDATA === undefined) delete process.env.APPDATA; else process.env.APPDATA = inherited.APPDATA;
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('close waits for an in-flight uv operation', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-close-${randomUUID()}`);
  await mkdir(fixtureRoot, { recursive: true });
  const db = new DatabaseSync(path.join(fixtureRoot, 'test.sqlite'));
  let markStarted;
  let finish;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const blocked = new Promise((resolve) => { finish = resolve; });
  const service = createPythonEnvironmentService({ database: db, dataRoot: fixtureRoot, uvPath: 'fake-uv',
    runner: async () => { markStarted(); await blocked; return { code: 0, stdout: '', stderr: '' }; } });
  try {
    const operation = service.operate({ action: 'create', name: 'Closing' });
    await started;
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    finish();
    await assert.rejects(operation, (error) => error instanceof PythonEnvironmentError && error.code === 'UV_OPERATION_FAILED');
    await closing;
    assert.equal(closed, true);
    assert.ok(db.prepare("SELECT 1 FROM python_env_logs WHERE action='create' AND status='failed'").get());
  } finally { db.close(); await rm(fixtureRoot, { recursive: true, force: true }); }
});

test('builtin install keeps a stable environment id and retries only failed direct packages', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-builtin-${randomUUID()}`);
  await mkdir(path.join(fixtureRoot, 'python'), { recursive: true });
  await writeFile(path.join(fixtureRoot, 'python', 'builtin.json'), JSON.stringify({ pythonVersion: '3.14.7', uvVersion: '0.12.19', platform: 'win32-x64', requirementsFile: 'builtin.lock' }));
  await writeFile(path.join(fixtureRoot, 'python', 'builtin.in'), 'numpy\npandas\n');
  await writeFile(path.join(fixtureRoot, 'python', 'builtin.lock'), '# locked\nnumpy==1.0\npandas==1.0\n');
  const db = new DatabaseSync(path.join(fixtureRoot, 'test.sqlite'));
  let failBulk = true;
  let failNumpy = true;
  let failFreeze = true;
  let releaseVenv;
  let startedVenv;
  const venvStarted = new Promise((resolve) => { startedVenv = resolve; });
  const venvGate = new Promise((resolve) => { releaseVenv = resolve; });
  const calls = [];
  const service = createPythonEnvironmentService({ database: db, dataRoot: fixtureRoot, uvPath: 'fake-uv', runner: async (_command, args) => {
    calls.push(args);
    if (args[0] === 'venv') { startedVenv(); await venvGate; }
    if (args[0] === '--version') return { code: 0, stdout: 'Python 3.14.7\n', stderr: '' };
    if (args[1] === 'sync' && failBulk) { failBulk = false; throw new Error('fixture bulk sync failure'); }
    if (args[1] === 'install' && args.includes('numpy') && failNumpy) { failNumpy = false; throw new Error('fixture numpy wheel failure'); }
    if (args[1] === 'freeze' && failFreeze) { failFreeze = false; throw new Error('fixture lock capture failure'); }
    if (args[1] === 'freeze') return { code: 0, stdout: 'pandas==1.0\n', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  } });
  try {
    const firstInstall = service.ensureBuiltin();
    await venvStarted;
    const concurrentInstall = service.ensureBuiltin();
    releaseVenv();
    const [partial, concurrentResult] = await Promise.all([firstInstall, concurrentInstall]);
    assert.equal(concurrentResult.id, partial.id);
    assert.equal(partial.id, 'builtin-science');
    assert.equal(partial.status, 'partial');
    assert.equal(partial.failedPackages[0].package, 'numpy');
    assert.equal(partial.failedPackages[1].package, '<lock-capture>');
    assert.deepEqual(partial.lock, []);
    assert.equal((await service.getSettings()).defaultEnvId, 'builtin-science');
    const beforeRetry = calls.length;
    const ready = await service.ensureBuiltin();
    assert.equal(ready.id, partial.id);
    assert.equal(ready.status, 'ready');
    assert.equal(calls.slice(beforeRetry).some((args) => args[1] === 'venv'), false);
    assert.deepEqual(calls.slice(beforeRetry).filter((args) => args[1] === 'install').map((args) => args.at(-1)), ['numpy']);
    const beforeNoop = calls.length;
    await service.ensureBuiltin();
    assert.equal(calls.length, beforeNoop);
  } finally { await service.close(); db.close(); await rm(fixtureRoot, { recursive: true, force: true }); }
});

test('same-environment writes serialize while another environment proceeds', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-serial-${randomUUID()}`);
  await mkdir(fixtureRoot, { recursive: true });
  const db = new DatabaseSync(path.join(fixtureRoot, 'test.sqlite'));
  let releaseA;
  let markA;
  let markB;
  const blockA = new Promise((resolve) => { releaseA = resolve; });
  const startedA = new Promise((resolve) => { markA = resolve; });
  const startedB = new Promise((resolve) => { markB = resolve; });
  let aCompileCount = 0;
  let envAId;
  let envBId;
  const service = createPythonEnvironmentService({ database: db, dataRoot: fixtureRoot, uvPath: 'fake-uv', runner: async (_command, args) => {
    if (args[0] === '--version') return { code: 0, stdout: 'Python 3.14.7\n', stderr: '' };
    if (args[1] === 'compile') {
      const interpreter = args[args.indexOf('--python') + 1];
      if (interpreter.includes(envAId)) { aCompileCount += 1; markA(); if (aCompileCount === 1) await blockA; }
      if (interpreter.includes(envBId)) markB();
      await writeFile(args[args.indexOf('--output-file') + 1], await readFile(args[2], 'utf8'), 'utf8');
    }
    return { code: 0, stdout: '', stderr: '' };
  } });
  try {
    const envA = await service.operate({ action: 'create', name: 'A' });
    const envB = await service.operate({ action: 'create', name: 'B' });
    envAId = envA.id;
    envBId = envB.id;
    const firstA = service.packages({ envId: envA.id, action: 'add', packages: ['numpy'] });
    await startedA;
    const secondA = service.packages({ envId: envA.id, action: 'add', packages: ['pandas'] });
    const writeB = service.packages({ envId: envB.id, action: 'add', packages: ['sympy'] });
    await startedB;
    assert.equal(aCompileCount, 1, 'second write to A stays queued');
    releaseA();
    await Promise.all([firstA, secondA, writeB]);
    assert.equal(aCompileCount, 2);
  } finally { releaseA(); await service.close(); db.close(); await rm(fixtureRoot, { recursive: true, force: true }); }
});

test('a copied environment cannot be selected before its packages finish installing', async () => {
  const root=path.resolve('.sciencescope-local/temp',`python-copy-ready-${randomUUID()}`);
  await mkdir(root,{recursive:true});const db=new DatabaseSync(path.join(root,'test.sqlite'));
  let release,started;const hold=new Promise(resolve=>release=resolve),syncStarted=new Promise(resolve=>started=resolve);
  const service=createPythonEnvironmentService({database:db,dataRoot:root,runner:async(_command,args)=>{
    if(args[0]==='--version')return {stdout:'Python 3.14.7'};
    if(args[1]==='sync'){started();await hold;}
    return {stdout:''};
  }});
  try{
    const source=await service.operate({action:'create',name:'Source'});
    db.prepare('UPDATE python_envs SET packages_json=?,lock_json=? WHERE id=?').run('["numpy"]','["numpy==2.5.3"]',source.id);
    const copying=service.operate({action:'copy',envId:source.id,name:'Copy'});await syncStarted;
    const row=db.prepare("SELECT id,status FROM python_envs WHERE name='Copy'").get();
    assert.equal(row.status,'creating');
    await assert.rejects(service.bind({scope:'chat',targetId:'copy-chat',envId:row.id}),error=>error.code==='ENVIRONMENT_UNAVAILABLE');
    release();assert.equal((await copying).status,'ready');
  }finally{release();await service.close();db.close();await rm(root,{recursive:true,force:true});}
});

test('project and chat bindings survive service close and database reopen', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-reopen-${randomUUID()}`);
  await mkdir(fixtureRoot, { recursive: true });
  const dbPath = path.join(fixtureRoot, 'test.sqlite');
  const fakeRunner = async (_command, args) => {await fakeInterpreter(args);return args[0] === '--version'
    ? { code: 0, stdout: 'Python 3.14.7\n', stderr: '' }
    : { code: 0, stdout: '', stderr: '' };};
  const firstDb = new DatabaseSync(dbPath);
  const firstService = createPythonEnvironmentService({ database: firstDb, dataRoot: fixtureRoot, uvPath: 'fake-uv', runner: fakeRunner,
    getChat: async () => ({ projectId: 'project-1' }) });
  let environment;
  try {
    environment = await firstService.operate({ action: 'create', name: 'Persistent' });
    await firstService.bind({ scope: 'project', targetId: 'project-1', envId: environment.id });
    await firstService.bind({ scope: 'chat', targetId: 'chat-1', envId: 'system' });
    await firstService.close();
  } finally { firstDb.close(); }
  const secondDb = new DatabaseSync(dbPath);
  const secondService = createPythonEnvironmentService({ database: secondDb, dataRoot: fixtureRoot, uvPath: 'fake-uv', runner: fakeRunner,
    getChat: async () => ({ projectId: 'project-1' }) });
  try {
    assert.equal((await secondService.resolve({ chatId: 'chat-2' })).envId, environment.id);
    assert.equal((await secondService.resolve({ chatId: 'chat-1' })).kind, 'system');
    const executable=path.join(fixtureRoot,'.sciencescope-local/python/envs',environment.id,process.platform==='win32'?'Scripts/python.exe':'bin/python');
    await rm(executable);
    await assert.rejects(secondService.resolve({chatId:'chat-2'}),error=>error.code==='ENVIRONMENT_UNAVAILABLE'&&error.status===409,'missing interpreter never falls back to system Python');
  } finally { await secondService.close(); secondDb.close(); await rm(fixtureRoot, { recursive: true, force: true }); }
});

test('startup marks an interrupted creating environment failed and records recovery', async () => {
  const fixtureRoot = path.resolve('.sciencescope-local/temp', `python-interrupted-${randomUUID()}`);
  await mkdir(fixtureRoot, { recursive: true });
  const dbPath = path.join(fixtureRoot, 'test.sqlite');
  const runner = async (_command, args) => args[0] === '--version'
    ? { code: 0, stdout: 'Python 3.14.7\n', stderr: '' }
    : { code: 0, stdout: '', stderr: '' };
  const firstDb = new DatabaseSync(dbPath);
  const firstService = createPythonEnvironmentService({ database: firstDb, dataRoot: fixtureRoot, uvPath: 'fake-uv', runner });
  let environment;
  try {
    environment = await firstService.operate({ action: 'create', name: 'Interrupted' });
    firstDb.prepare("UPDATE python_envs SET status='creating' WHERE id=?").run(environment.id);
    await firstService.close();
  } finally { firstDb.close(); }
  const secondDb = new DatabaseSync(dbPath);
  const secondService = createPythonEnvironmentService({ database: secondDb, dataRoot: fixtureRoot, uvPath: 'fake-uv', runner });
  try {
    const row = (await secondService.list()).envs.find((entry) => entry.id === environment.id);
    assert.equal(row.status, 'failed');
    assert.match(row.error, /中断/u);
    assert.ok((await secondService.getLogs(environment.id)).some((entry) => entry.action === 'startupRecovery'));
  } finally { await secondService.close(); secondDb.close(); await rm(fixtureRoot, { recursive: true, force: true }); }
});
