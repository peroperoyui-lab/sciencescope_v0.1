import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createUvCommand } from './uv.mjs';

export class PythonEnvironmentError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'PythonEnvironmentError';
    this.code = code;
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const idPattern = /^[A-Za-z0-9_-]{1,160}$/u;
const checkId = (value, label = 'id') => {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new PythonEnvironmentError('INVALID_ID', `Invalid ${label}`);
  return value;
};
const toJson = (value) => JSON.stringify(value ?? {});
const fromJson = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const normalizedPackageName = (spec) => spec.match(/^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/u)?.[1].toLowerCase().replace(/[-_.]/gu, '-');
const isWin = process.platform === 'win32';
const usableStatus = (status) => status === 'ready' || status === 'partial';
const clip = (value) => String(value ?? '').slice(0, 5000);
const errorDetail = (error) => ({ message: String(error?.message ?? error), stdout: clip(error?.stdout), stderr: clip(error?.stderr) });

function databaseHandle(database) {
  const db = database?.db ?? database;
  if (!db?.prepare || !db?.exec) throw new TypeError('database must be a node:sqlite DatabaseSync or an application database exposing .db');
  return db;
}

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS python_envs (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, version TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT, packages_json TEXT NOT NULL DEFAULT '[]', lock_json TEXT NOT NULL DEFAULT '[]',
      failed_packages_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS python_env_bindings (
      scope TEXT NOT NULL CHECK(scope IN ('chat','project')), target_id TEXT NOT NULL,
      env_id TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(scope,target_id)
    );
    CREATE TABLE IF NOT EXISTS python_env_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), settings_json TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS python_env_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, env_id TEXT, actor TEXT, action TEXT NOT NULL,
      detail_json TEXT NOT NULL, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL
    );
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(python_envs)').all().map((column) => column.name));
  if (!columns.has('lock_json')) db.exec("ALTER TABLE python_envs ADD COLUMN lock_json TEXT NOT NULL DEFAULT '[]'");
  if (!columns.has('failed_packages_json')) db.exec("ALTER TABLE python_envs ADD COLUMN failed_packages_json TEXT NOT NULL DEFAULT '[]'");
  db.prepare('INSERT OR IGNORE INTO python_env_settings(id,settings_json,updated_at) VALUES(1,?,?)')
    .run(toJson({ defaultEnvId: null, indexUrl: null, autoApproveFull: false }), now());
}

function validIndexUrl(value) {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed = new URL(String(value));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
    return parsed.href.replace(/\/$/u, '');
  } catch { throw new PythonEnvironmentError('INVALID_INDEX_URL', '镜像源必须是无凭据的 HTTPS URL。'); }
}

async function directorySize(root, { exclusive = false } = {}) {
  let total = 0;
  const visit = async (directory) => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) { try { const info = await stat(file); if (!exclusive || Number(info.nlink) <= 1) total += info.size; } catch {} }
    }
  };
  await visit(root);
  return total;
}

/** SQLite-backed local Python environments, scoped bindings, and uv operations. */
export function createPythonEnvironmentService({ database, dataRoot, uvPath, runner, getChat, onChange } = {}) {
  if (!dataRoot) throw new TypeError('dataRoot is required');
  const db = databaseHandle(database);
  schema(db);
  const interruptedAt = now();
  const interruptedRows = db.prepare("SELECT id,name FROM python_envs WHERE status='creating'").all();
  for (const row of interruptedRows) {
    const message = '创建过程中应用关闭，环境安装已中断，可重试。';
    db.prepare("UPDATE python_envs SET status='failed',error=?,updated_at=? WHERE id=?").run(message, interruptedAt, row.id);
    db.prepare("INSERT INTO python_env_logs(env_id,actor,action,detail_json,status,error,created_at) VALUES(?, 'system', 'startupRecovery', ?, 'failed', ?, ?)")
      .run(row.id, toJson({ name: row.name, interrupted: true }), message, interruptedAt);
  }
  const root = path.join(path.resolve(dataRoot), '.sciencescope-local', 'python');
  const envRoot = path.join(root, 'envs');
  const uv = createUvCommand({ dataRoot, uvPath, runner });
  const queues = new Map();
  const ownedProcesses = new Set();
  const activeOperations = new Set();
  let closing = false;
  let revision = 0;
  let metricsCache = null;
  let systemCache = null;

  const notify = (event) => { revision += 1; metricsCache = null; try { onChange?.({ ...event, revision }); } catch {} };
  async function runUv(args, options) {
    if (closing) throw new PythonEnvironmentError('SERVICE_CLOSED', 'Python environment service is closed.', 503);
    const task = uv.run(args, options);
    ownedProcesses.add(task);
    try { return await task; } finally { ownedProcesses.delete(task); }
  }
  const trackOperation = (operation) => (...args) => {
    if (closing) return Promise.reject(new PythonEnvironmentError('SERVICE_CLOSED', 'Python environment service is closed.', 503));
    const task = Promise.resolve().then(() => operation(...args));
    activeOperations.add(task);
    task.then(() => activeOperations.delete(task), () => activeOperations.delete(task));
    return task;
  };
  const settingRow = () => fromJson(db.prepare('SELECT settings_json FROM python_env_settings WHERE id=1').get()?.settings_json, {});
  const writeSettings = (settings) => db.prepare('UPDATE python_env_settings SET settings_json=?,updated_at=? WHERE id=1').run(toJson(settings), now());
  const rowToEnv = (row) => row && ({ id: row.id, name: row.name, version: row.version, status: row.status,
    ...(row.error ? { error: row.error } : {}), failedPackages: fromJson(row.failed_packages_json, []),
    packages: fromJson(row.packages_json, []), lock: fromJson(row.lock_json, []), usageCount: 0, sizeBytes: 0 });
  const getEnvRow = (id) => db.prepare('SELECT * FROM python_envs WHERE id=?').get(id);
  const envPath = (id) => path.join(envRoot, checkId(id));
  const getSettingsValue = () => ({ defaultEnvId: null, indexUrl: null, autoApproveFull: false, ...settingRow() });

  async function serialized(id, operation) {
    const previous = queues.get(id) ?? Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    const queued = previous.then(() => next);
    queues.set(id, queued);
    await previous;
    try { if (closing) throw new PythonEnvironmentError('SERVICE_CLOSED', 'Python environment service is closed.', 503); return await operation(); }
    finally { release(); if (queues.get(id) === queued) queues.delete(id); }
  }

  async function list() {
    if (metricsCache && Date.now() - metricsCache.at < 30_000) return { ...metricsCache.value, envs: metricsCache.value.envs.map((env) => ({ ...env, packages: [...env.packages], lock: [...env.lock], failedPackages: [...env.failedPackages] })) };
    const rows = db.prepare('SELECT * FROM python_envs ORDER BY created_at,id').all();
    const usage = new Map(db.prepare('SELECT env_id,COUNT(*) AS n FROM python_env_bindings WHERE env_id IS NOT NULL GROUP BY env_id').all().map((r) => [r.env_id, Number(r.n)]));
    const envs = await Promise.all(rows.map(async (row) => ({ ...rowToEnv(row), usageCount: usage.get(row.id) ?? 0, sizeBytes: await directorySize(envPath(row.id), { exclusive: true }) })));
    const settings = getSettingsValue();
    const value = { envs, defaultEnvId: settings.defaultEnvId, settings, system: await detectSystem(), cacheSizeBytes: await directorySize(path.join(root, 'cache')) };
    metricsCache = { at: Date.now(), value };
    return value;
  }

  function log({ envId = null, actor = 'user', action, detail = {}, status, error = null }) {
    db.prepare('INSERT INTO python_env_logs(env_id,actor,action,detail_json,status,error,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(envId, String(actor), action, toJson(detail), status, error, now());
  }

  async function detectSystem() {
    if (systemCache && Date.now() - systemCache.at < 60_000) return { ...systemCache.value };
    const command = isWin ? path.join(process.env.SystemRoot||'C:/Windows','System32/where.exe') : 'which';
    try {
      const result = await new Promise((resolve, reject) => {
        const child = (runner?.system ? runner.system : null);
        if (child) return Promise.resolve(child(command, ['python'])).then(resolve, reject);
        const p = import('node:child_process').then(({ execFile }) => execFile(command, ['python'], { windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout.trim().split(/\r?\n/u)[0])));
        p.catch(reject);
      });
      const executable = String(result).split(/\r?\n/u)[0].trim();
      const details = await new Promise((resolve, reject) => {
        import('node:child_process').then(({ execFile }) => execFile(executable, ['--version'], { windowsHide: true }, (error, stdout, stderr) => error ? reject(error) : resolve((stdout || stderr).trim()))).catch(reject);
      });
      systemCache = { at: Date.now(), value: { available: true, path: executable, version: details.replace(/^Python\s+/u, '') } };
    } catch { systemCache = { at: Date.now(), value: { available: false, path: null, version: null } }; }
    return { ...systemCache.value };
  }

  async function resolve({ chatId, projectId, envId: override } = {}) {
    const bindings = (scope, targetId) => targetId ? db.prepare('SELECT env_id FROM python_env_bindings WHERE scope=? AND target_id=?').get(scope, targetId)?.env_id : undefined;
    let selected;
    if (override !== undefined) selected = override;
    else if (chatId && (selected = bindings('chat', chatId)) !== undefined) { /* chat binding wins */ }
    else {
      let resolvedProjectId = projectId;
      if (!resolvedProjectId && chatId) {
        try {
          const chat = getChat ? await getChat(chatId) : db.prepare('SELECT project_id AS projectId FROM chats WHERE id=?').get(chatId);
          resolvedProjectId = chat?.projectId ?? chat?.project_id ?? null;
        } catch { resolvedProjectId = null; }
      }
      const projectBinding = bindings('project', resolvedProjectId);
      selected = projectBinding !== undefined ? projectBinding : getSettingsValue().defaultEnvId;
    }
    if (!selected || selected === 'system') return { envId: selected === 'system' ? 'system' : null, kind: 'system', name: '系统 Python', pathPrepend: [], env: {}, revision };
    const row = getEnvRow(checkId(selected, 'envId'));
    if (!row || !usableStatus(row.status)) throw new PythonEnvironmentError('ENVIRONMENT_UNAVAILABLE', '所选 Python 环境不存在或尚未就绪。', 404);
    const location = envPath(row.id);
    const scripts = path.join(location, isWin ? 'Scripts' : 'bin');
    const interpreter=path.join(scripts,isWin?'python.exe':'python');
    if(!await stat(interpreter).then(info=>info.isFile(),()=>false))throw new PythonEnvironmentError('ENVIRONMENT_UNAVAILABLE','所选 Python 环境的解释器文件缺失，请修复环境或重新选择。',409);
    return { envId: row.id, kind: 'managed', name: row.name, path: location,
      pathPrepend: [scripts], env: { VIRTUAL_ENV: location }, revision };
  }

  async function bind({ scope, targetId, envId }) {
    if (!['chat', 'project'].includes(scope)) throw new PythonEnvironmentError('INVALID_SCOPE', 'scope must be chat or project');
    checkId(targetId, 'targetId');
    if (envId !== null && envId !== undefined && envId !== 'system') {
      const row = getEnvRow(checkId(envId, 'envId'));
      if (!row || !usableStatus(row.status)) throw new PythonEnvironmentError('ENVIRONMENT_UNAVAILABLE', '所选 Python 环境不存在或尚未就绪。', 404);
    }
    if (envId === null || envId === undefined) db.prepare('DELETE FROM python_env_bindings WHERE scope=? AND target_id=?').run(scope, targetId);
    else db.prepare(`INSERT INTO python_env_bindings(scope,target_id,env_id,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(scope,target_id) DO UPDATE SET env_id=excluded.env_id,updated_at=excluded.updated_at`)
      .run(scope, targetId, envId, now());
    notify({ type: 'binding', scope, targetId, envId: envId ?? null });
    return { scope, targetId, envId: envId ?? null };
  }

  async function getSettings() { return getSettingsValue(); }
  async function updateSettings(input = {}) {
    const old = getSettingsValue();
    const next = { ...old };
    if (Object.hasOwn(input, 'defaultEnvId')) {
      const value = input.defaultEnvId;
      if (value !== null && value !== 'system') {
        const row = getEnvRow(checkId(value, 'defaultEnvId'));
        if (!row || !usableStatus(row.status)) throw new PythonEnvironmentError('ENVIRONMENT_UNAVAILABLE', '默认环境不存在或尚未就绪。', 404);
      }
      next.defaultEnvId = value;
    }
    if (Object.hasOwn(input, 'indexUrl')) next.indexUrl = validIndexUrl(input.indexUrl);
    if (Object.hasOwn(input, 'autoApproveFull')) {
      if (typeof input.autoApproveFull !== 'boolean') throw new PythonEnvironmentError('INVALID_SETTING', '完全接管自动批准必须是布尔值。');
      next.autoApproveFull = input.autoApproveFull;
    }
    writeSettings(next);
    notify({ type: 'settings' });
    return next;
  }

  async function validatePackages(packages) {
    if (!Array.isArray(packages) || packages.length > 200) throw new PythonEnvironmentError('INVALID_PACKAGES', '软件包必须是最多 200 项的数组。');
    return packages.map((entry) => {
      if (typeof entry !== 'string' || entry.length > 240) throw new PythonEnvironmentError('INVALID_PACKAGE_SPEC', '软件包格式无效。');
      const value = entry.trim();
      // Intentionally support only PEP 508 name/extras plus version clauses.
      // Reject markers, direct URLs, local paths, pip options and whitespace tricks.
      const match = value.match(/^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(\[[A-Za-z0-9_,.-]+\])?(?:\s*((?:(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9][A-Za-z0-9.*+!-]*(?:\s*,\s*(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9][A-Za-z0-9.*+!-]*)*)))?$/u);
      if (!match || value.startsWith('-') || /[;@/\\:#]/u.test(value)) throw new PythonEnvironmentError('INVALID_PACKAGE_SPEC', `不支持的软件包格式：${value}`);
      return `${match[1]}${match[2] ?? ''}${match[3] ? match[3].replace(/\s+/gu, '') : ''}`;
    });
  }

  const pythonExe = (id) => path.join(envPath(id), isWin ? 'Scripts/python.exe' : 'bin/python');
  async function actualPythonVersion(id, requestedVersion) {
    const result = await uv.runPython(pythonExe(id), ['--version'], { indexUrl: getSettingsValue().indexUrl });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const version = output.match(/Python\s+(3\.\d+\.\d+)/u)?.[1];
    if (!version) throw new PythonEnvironmentError('PYTHON_VERSION_UNKNOWN', '无法确认受管 Python 的实际版本。', 500);
    const requested = String(requestedVersion);
    if (requested.split('.').length === 3 ? version !== requested : !version.startsWith(`${requested}.`)) {
      throw new PythonEnvironmentError('PYTHON_VERSION_MISMATCH', `创建的 Python 版本 ${version} 与请求版本 ${requested} 不一致。`, 500);
    }
    return version;
  }
  async function compileAndSync(envId, requirements, existingLock = []) {
    const directory = path.join(root, 'tmp');
    await mkdir(directory, { recursive: true });
    const manifestPath = path.join(directory, `requirements-${randomUUID()}.in`);
    const lockPath = path.join(directory, `requirements-${randomUUID()}.lock`);
    await writeFile(manifestPath, requirements.join('\n') + (requirements.length ? '\n' : ''), { encoding: 'utf8', flag: 'wx' });
    if (existingLock.length) await writeFile(lockPath, existingLock.join('\n') + '\n', { encoding: 'utf8', flag: 'wx' });
    try {
      const compiled = await runUv(['pip', 'compile', manifestPath, '--python', pythonExe(envId), '--output-file', lockPath, '--no-header', '--no-annotate'], { indexUrl: getSettingsValue().indexUrl });
      const lockText = await readFile(lockPath, 'utf8');
      const lock = lockText.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
      const synced = await runUv(['pip', 'sync', '--python', pythonExe(envId), lockPath], { indexUrl: getSettingsValue().indexUrl });
      return { lock, stdout: clip([compiled.stdout, synced.stdout].filter(Boolean).join('\n')), stderr: clip([compiled.stderr, synced.stderr].filter(Boolean).join('\n')) };
    } catch (error) {
      error.detail = errorDetail(error);
      throw error;
    } finally {
      await Promise.all([rm(manifestPath, { force: true }), rm(lockPath, { force: true })]);
    }
  }
  async function syncFixedLock(envId, lock) {
    const lockPath = path.join(root, 'tmp', `requirements-${randomUUID()}.lock`);
    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, lock.join('\n') + (lock.length ? '\n' : ''), { encoding: 'utf8', flag: 'wx' });
    try { await runUv(['pip', 'sync', '--python', pythonExe(envId), lockPath], { indexUrl: getSettingsValue().indexUrl }); }
    finally { await rm(lockPath, { force: true }); }
  }
  async function packages({ envId, action, packages: requested = [], actor = 'user', reason = '' } = {}) {
    if (envId === 'system') throw new PythonEnvironmentError('SYSTEM_ENVIRONMENT_READ_ONLY', '不能向系统 Python 安装或移除软件包。');
    checkId(envId, 'envId');
    const specs = await validatePackages(requested);
    return serialized(envId, async () => {
      const row = getEnvRow(envId);
      if (!row || !usableStatus(row.status)) throw new PythonEnvironmentError('ENVIRONMENT_UNAVAILABLE', '所选 Python 环境不存在或尚未就绪。', 404);
      let updated = fromJson(row.packages_json, []);
      if (action === 'sync') updated = specs;
      else if (action === 'add') {
        const incomingNames = new Set(specs.map(normalizedPackageName));
        updated = [...updated.filter((item) => !incomingNames.has(normalizedPackageName(item))), ...specs];
      }
      else if (action === 'remove') {
        const removedNames = new Set(specs.map(normalizedPackageName));
        updated = updated.filter((item) => !removedNames.has(normalizedPackageName(item)));
      } else throw new PythonEnvironmentError('INVALID_ACTION', '包操作必须是 add、remove 或 sync。');
      try {
        const existingLock = fromJson(row.lock_json, []);
        const result = await compileAndSync(envId, updated, existingLock);
        db.prepare('UPDATE python_envs SET packages_json=?,lock_json=?,updated_at=? WHERE id=?').run(toJson(updated), toJson(result.lock), now(), envId);
        log({ envId, actor, action, detail: { packages: specs, reason, resolvedCount: result.lock.length, stdout: result.stdout, stderr: result.stderr }, status: 'success' });
      } catch (error) {
        const detail = error.detail ?? errorDetail(error);
        log({ envId, actor, action, detail: { packages: specs, reason, ...detail }, status: 'failed', error: detail.message });
        throw new PythonEnvironmentError('UV_OPERATION_FAILED', detail.message, 500);
      }
      notify({ type: 'packages', action, envId });
      return { envId, action, packages: updated };
    });
  }

  async function createEnv({ name, version = '3.14', actor = 'user', action = 'create', packages: initialPackages = [], initialLock = null } = {}) {
    const id = `py-${randomUUID()}`;
    name = String(name ?? '').trim();
    if (!name || name.length > 100) throw new PythonEnvironmentError('INVALID_NAME', '环境名称必须为 1–100 个字符。');
    version = String(version);
    if (!/^3\.\d+(?:\.\d+)?$/u.test(version)) throw new PythonEnvironmentError('INVALID_PYTHON_VERSION', 'Python 版本必须是 3.x 数字版本。');
    const destination = envPath(id);
    await mkdir(envRoot, { recursive: true });
    db.prepare('INSERT INTO python_envs(id,name,version,status,packages_json,lock_json,created_at,updated_at) VALUES(?,?,?,\'creating\',\'[]\',\'[]\',?,?)').run(id, name, version, now(), now());
    try {
      await runUv(['venv', '--managed-python', '--python', version, destination], { indexUrl: getSettingsValue().indexUrl });
      const actualVersion = await actualPythonVersion(id, version);
      db.prepare('UPDATE python_envs SET version=?,updated_at=? WHERE id=?').run(actualVersion, now(), id);
      if (initialLock) {
        await syncFixedLock(id, initialLock);
        db.prepare('UPDATE python_envs SET packages_json=?,lock_json=?,updated_at=? WHERE id=?').run(toJson(initialPackages), toJson(initialLock), now(), id);
      } else if (initialPackages.length) {
        const requirements=await validatePackages(initialPackages);
        const result=await compileAndSync(id,requirements,{actor,reason:'Create environment manifest'});
        db.prepare('UPDATE python_envs SET packages_json=?,lock_json=?,updated_at=? WHERE id=?').run(toJson(requirements),toJson(result.lock),now(),id);
      }
      db.prepare('UPDATE python_envs SET status=\'ready\',updated_at=? WHERE id=?').run(now(),id);
      log({ envId: id, actor, action, detail: { name, version }, status: 'success' });
      notify({ type: 'environment', action, envId: id });
      return rowToEnv(getEnvRow(id));
    } catch (error) {
      db.prepare('UPDATE python_envs SET status=\'failed\',error=?,updated_at=? WHERE id=?').run(String(error.message), now(), id);
      log({ envId: id, actor, action, detail: { name, version }, status: 'failed', error: String(error.message) });
      if (error instanceof PythonEnvironmentError) throw error;
      throw new PythonEnvironmentError('UV_OPERATION_FAILED', error.message, 500);
    }
  }

  async function operate(input = {}) {
    const { action } = input;
    if (action === 'create') return createEnv(input);
    const id = checkId(input.envId, 'envId');
    if (action === 'rename') {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 100) throw new PythonEnvironmentError('INVALID_NAME', '环境名称必须为 1–100 个字符。');
      if (!getEnvRow(id)) throw new PythonEnvironmentError('ENVIRONMENT_NOT_FOUND', '环境不存在。', 404);
      db.prepare('UPDATE python_envs SET name=?,updated_at=? WHERE id=?').run(name, now(), id);
      log({ envId: id, actor: input.actor, action, detail: { name }, status: 'success' }); notify({ type: 'environment', action, envId: id });
      return rowToEnv(getEnvRow(id));
    }
    if (action === 'copy') {
      const source = getEnvRow(id);
      if (!source || !usableStatus(source.status)) throw new PythonEnvironmentError('ENVIRONMENT_UNAVAILABLE', '源环境不存在或尚未就绪。', 404);
      return createEnv({ name: input.name || `${source.name} 副本`, version: source.version, actor: input.actor, action,
        packages: fromJson(source.packages_json, []), initialLock: fromJson(source.lock_json, []).length ? fromJson(source.lock_json, []) : null });
    }
    if (action === 'remove') return serialized(id, async () => {
      const row = getEnvRow(id);
      if (!row) throw new PythonEnvironmentError('ENVIRONMENT_NOT_FOUND', '环境不存在。', 404);
      const bound = db.prepare('SELECT scope,target_id FROM python_env_bindings WHERE env_id=? LIMIT 1').get(id);
      if (bound || getSettingsValue().defaultEnvId === id) throw new PythonEnvironmentError('ENVIRONMENT_IN_USE', '环境仍被默认设置或任务使用。', 409);
      const location = envPath(id);
      if (path.dirname(location) !== envRoot) throw new PythonEnvironmentError('INVALID_ENV_PATH', '环境目录校验失败。', 400);
      await rm(location, { recursive: true, force: true });
      db.prepare('DELETE FROM python_envs WHERE id=?').run(id);
      log({ envId: id, actor: input.actor, action, status: 'success' }); notify({ type: 'environment', action, envId: id });
      return { id, removed: true };
    });
    throw new PythonEnvironmentError('INVALID_ACTION', '环境操作必须是 create、copy、rename 或 remove。');
  }

  let builtinTask = null;
  async function ensureBuiltin() {
    if (builtinTask) return builtinTask;
    builtinTask = installBuiltin().finally(() => { builtinTask = null; });
    return builtinTask;
  }

  async function installBuiltin() {
    const metadataPath = path.resolve(dataRoot, 'python', 'builtin.json');
    const lockPath = path.resolve(dataRoot, 'python', 'builtin.lock');
    let metadata; let lock;
    try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); lock = await readFile(lockPath, 'utf8'); }
    catch { throw new PythonEnvironmentError('BUILTIN_MANIFEST_MISSING', '内置 Python 清单文件缺失。', 500); }
    if (typeof metadata.pythonVersion !== 'string' || !/^3\.\d+(?:\.\d+)?$/u.test(metadata.pythonVersion)) throw new PythonEnvironmentError('BUILTIN_MANIFEST_INVALID', '内置 Python 版本配置无效。', 500);
    let builtinInputs;
    try { builtinInputs = (await readFile(path.resolve(dataRoot, 'python', 'builtin.in'), 'utf8')).split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')); }
    catch { throw new PythonEnvironmentError('BUILTIN_MANIFEST_MISSING', '内置 Python 输入清单文件缺失。', 500); }
    const id = 'builtin-science';
    const existing = getEnvRow(id);
    if (existing?.status === 'ready') {
      if (!getSettingsValue().defaultEnvId) await updateSettings({ defaultEnvId: existing.id });
      return rowToEnv(existing);
    }
    const lockSpecs = lock.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
    const destination = envPath(id);
    const retryPartial = existing?.status === 'partial';
    const retryNames = retryPartial ? fromJson(existing.failed_packages_json, []).map((entry) => entry.package).filter((name) => builtinInputs.includes(name)) : builtinInputs;
    if (!existing) db.prepare('INSERT INTO python_envs(id,name,version,status,packages_json,created_at,updated_at) VALUES(?,?,?,\'creating\',?, ?,?)')
      .run(id, '内置 · 科学分析', metadata.pythonVersion, toJson(builtinInputs), now(), now());
    else db.prepare('UPDATE python_envs SET status=\'creating\',error=NULL,updated_at=? WHERE id=?').run(now(), id);
    notify({ type: 'environment', action: 'builtin-installing', envId: id });
    let failedPackages = [];
    try {
      await mkdir(envRoot, { recursive: true });
      if (!retryPartial) {
        if (existing?.status === 'failed') await rm(destination, { recursive: true, force: true });
        await runUv(['venv', '--managed-python', '--python', metadata.pythonVersion, destination], { indexUrl: getSettingsValue().indexUrl });
        const actualVersion = await actualPythonVersion(id, metadata.pythonVersion);
        if (actualVersion !== metadata.pythonVersion) throw new PythonEnvironmentError('PYTHON_VERSION_MISMATCH', `内置 Python 版本 ${actualVersion} 与锁定版本 ${metadata.pythonVersion} 不一致。`, 500);
      }
      const lockCopy = path.join(root, 'tmp', `builtin-${randomUUID()}.lock`);
      await mkdir(path.dirname(lockCopy), { recursive: true });
      await writeFile(lockCopy, lock, { encoding: 'utf8', flag: 'wx' });
      try {
        if (retryPartial) {
          for (const requirement of retryNames) {
            try { await runUv(['pip', 'install', '--python', pythonExe(id), '--constraint', lockCopy, requirement], { indexUrl: getSettingsValue().indexUrl }); }
            catch (error) { failedPackages.push({ package: requirement, ...errorDetail(error) }); }
          }
        } else {
          try { await runUv(['pip', 'sync', '--python', pythonExe(id), lockCopy], { indexUrl: getSettingsValue().indexUrl }); }
          catch (syncError) {
            log({ envId: id, actor: 'system', action: 'ensureBuiltin', detail: { stage: 'bulk-sync', ...errorDetail(syncError) }, status: 'failed', error: String(syncError.message) });
            for (const requirement of builtinInputs) {
              try { await runUv(['pip', 'install', '--python', pythonExe(id), '--constraint', lockCopy, requirement], { indexUrl: getSettingsValue().indexUrl }); }
              catch (error) { failedPackages.push({ package: requirement, ...errorDetail(error) }); }
            }
          }
        }
      } finally { await rm(lockCopy, { force: true }); }
      let installedLock = lockSpecs;
      if (retryPartial || failedPackages.length) {
        try {
          const result = await runUv(['pip', 'freeze', '--python', pythonExe(id)], { indexUrl: getSettingsValue().indexUrl });
          installedLock = String(result.stdout ?? '').split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
        } catch (error) {
          failedPackages.push({ package: '<lock-capture>', ...errorDetail(error) });
          installedLock = [];
        }
      }
      const failedDirectNames = new Set(failedPackages.map((entry) => entry.package).filter((name) => builtinInputs.includes(name)));
      const installedCount = Math.max(0, builtinInputs.length - failedDirectNames.size);
      const status = failedPackages.length === 0 ? 'ready' : installedCount > 0 ? 'partial' : 'failed';
      const errorText = failedPackages.length ? `${failedPackages.length} 个内置软件包安装失败。` : null;
      db.prepare('UPDATE python_envs SET status=?,error=?,packages_json=?,lock_json=?,failed_packages_json=?,updated_at=? WHERE id=?')
        .run(status, errorText, toJson(builtinInputs), toJson(installedLock), toJson(failedPackages), now(), id);
      if (usableStatus(status) && !getSettingsValue().defaultEnvId) await updateSettings({ defaultEnvId: id });
      log({ envId: id, actor: 'system', action: 'ensureBuiltin', detail: { pythonVersion: metadata.pythonVersion, packageCount: builtinInputs.length, failedPackages }, status: failedPackages.length ? 'partial' : 'success' });
      notify({ type: 'environment', action: 'builtin-ready', envId: id });
      return rowToEnv(getEnvRow(id));
    } catch (error) {
      db.prepare('UPDATE python_envs SET status=\'failed\',error=?,updated_at=? WHERE id=?').run(String(error.message), now(), id);
      log({ envId: id, actor: 'system', action: 'ensureBuiltin', status: 'failed', error: String(error.message) });
      throw new PythonEnvironmentError('UV_OPERATION_FAILED', error.message, 500);
    }
  }

  async function cachePrune() {
    await Promise.allSettled([...queues.values()]);
    try { const result = await runUv(['cache', 'prune'], { indexUrl: getSettingsValue().indexUrl }); notify({ type: 'cache-pruned' }); return { pruned: true, output: result.stdout ?? '' }; }
    catch (error) { throw new PythonEnvironmentError('UV_OPERATION_FAILED', error.message, 500); }
  }
  async function getLogs(envId) {
    const rows = envId === undefined
      ? db.prepare('SELECT * FROM python_env_logs ORDER BY id DESC LIMIT 500').all()
      : envId === null ? db.prepare('SELECT * FROM python_env_logs ORDER BY id DESC LIMIT 500').all()
        : db.prepare('SELECT * FROM python_env_logs WHERE env_id=? ORDER BY id DESC LIMIT 500').all(checkId(envId, 'envId'));
    return rows.map((row) => ({ id: row.id, envId: row.env_id, actor: row.actor, action: row.action,
      detail: fromJson(row.detail_json, {}), status: row.status, error: row.error, createdAt: row.created_at }));
  }
  async function exportManifest(envId) {
    const row = getEnvRow(checkId(envId, 'envId'));
    if (!row) throw new PythonEnvironmentError('ENVIRONMENT_NOT_FOUND', '环境不存在。', 404);
    const locked = fromJson(row.lock_json, []);
    const packages = locked.length ? locked : fromJson(row.packages_json, []);
    const label = locked.length ? row.name : `${row.name} · 未锁定清单`;
    return `# ${label}\n${packages.join('\n')}${packages.length ? '\n' : ''}`;
  }
  async function close() {
    closing = true;
    uv.close?.();
    while (activeOperations.size) await Promise.allSettled([...activeOperations]);
    await Promise.allSettled([...queues.values(), ...ownedProcesses]);
  }

  return {
    list: trackOperation(list), operate: trackOperation(operate), packages: trackOperation(packages),
    bind: trackOperation(bind), resolve: trackOperation(resolve), getSettings: trackOperation(getSettings),
    updateSettings: trackOperation(updateSettings), detectSystem: trackOperation(detectSystem),
    cachePrune: trackOperation(cachePrune), getLogs: trackOperation(getLogs),
    exportManifest: trackOperation(exportManifest), validatePackages: trackOperation(validatePackages),
    ensureBuiltin: trackOperation(ensureBuiltin), close,
  };
}
