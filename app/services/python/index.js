import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../core/errors.js';
import { createUv } from './uv.js';
import { createInstaller } from './installer.js';
import { directorySize, requirements, validatePackages } from './files.js';

const BUILTIN = 'builtin-science';
const manifestRoot = fileURLToPath(new URL('../../../python/', import.meta.url));
const packageName = (spec) =>
  spec
    .match(/^[\w.-]+/u)[0]
    .toLowerCase()
    .replace(/[-_.]+/gu, '-');

/**
 * Durable manifests and bindings; uv owns all package/environment mechanics.
 * Operations serialize because cache pruning must never race an installation.
 * @param {import('../../core/index.js').Core} core
 * @param {{uvPath?:string,runner?:typeof import('./uv.js').runProcess}} [options]
 */
export function createPython(core, options = {}) {
  const { db, paths, events } = core;
  const root = paths.python;
  const uv = createUv(root, options);
  let queue = Promise.resolve();
  let closed = false;
  const now = () => new Date().toISOString();
  const settings = async () =>
    (await core.workspace.read({ resource: 'settings', key: 'app' })).value.python;
  const rows = () => db.prepare('SELECT * FROM python_environments ORDER BY updated_at,id').all();
  const decode = (row) => ({
    id: row.id,
    name: row.name,
    version: row.version,
    status: row.status,
    error: row.error,
    packages: JSON.parse(row.packages_json),
    lock: JSON.parse(row.lock_json),
    failedPackages: JSON.parse(row.failed_json),
  });
  function get(id) {
    const row = db.prepare('SELECT * FROM python_environments WHERE id=?').get(id);
    if (!row) throw new AppError('ENVIRONMENT_NOT_FOUND', '环境不存在。', 404);
    return decode(row);
  }
  const envPath = (id) => path.join(root, 'envs', get(id).id);
  const interpreter = (id) =>
    path.join(envPath(id), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  function changed(action, id = null) {
    events.record('python.changed', { action, id });
  }
  function update(id, values) {
    db.transaction(() => {
      const columns = Object.keys(values);
      db.prepare(
        `UPDATE python_environments SET ${columns.map((key) => key + '=?').join(',')},updated_at=? WHERE id=?`,
      ).run(...Object.values(values), now(), id);
      changed('environment', id);
    });
  }
  function log(id, action, actor, reason, status, detail) {
    db.transaction(() => {
      db.prepare(
        'INSERT INTO python_operations(environment_id,actor_id,action,reason,status,detail_json,created_at) VALUES(?,?,?,?,?,?,?)',
      ).run(id, actor, action, reason, status, JSON.stringify(detail), now());
      changed('operation', id);
    });
  }
  for (const row of rows().filter((entry) => entry.status === 'preparing')) {
    update(row.id, { status: 'failed', error: '上次准备被中断，请重试。' });
    log(row.id, 'recovery', 'system', '', 'failed', {
      message: 'Installation interrupted by shutdown',
    });
  }
  function serialized(operation) {
    if (closed) return Promise.reject(new AppError('SERVICE_CLOSED', 'Python 服务已关闭。'));
    const task = queue.then(() => {
      if (closed) throw new AppError('SERVICE_CLOSED', 'Python 服务已关闭。');
      return operation();
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  async function command(args, signal) {
    const current = await settings();
    return uv.run(args, current.indexUrl, current.installMirror, signal);
  }
  const { sync, prepare } = createInstaller({
    root,
    get,
    update,
    log,
    uv,
    command,
    envPath,
    interpreter,
  });
  function insert(id, name, version, packages = [], lock = []) {
    if (!name?.trim()) throw new AppError('INVALID_NAME', '请输入环境名称。');
    if (!/^3\.\d+(?:\.\d+)?$/u.test(version))
      throw new AppError('INVALID_VERSION', '请输入 Python 3.x 版本。');
    db.transaction(() => {
      db.prepare(
        "INSERT INTO python_environments(id,name,version,status,packages_json,lock_json,updated_at) VALUES(?,?,?,'new',?,?,?)",
      ).run(id, name.trim(), version, JSON.stringify(packages), JSON.stringify(lock), now());
      changed('created', id);
    });
  }
  async function ensureBuiltin(signal = null) {
    signal?.throwIfAborted();
    const existing = rows().find((row) => row.id === BUILTIN);
    if (existing?.status === 'ready') return decode(existing);
    const meta = JSON.parse(await readFile(path.join(manifestRoot, 'builtin.json'), 'utf8'));
    const packages = requirements(await readFile(path.join(manifestRoot, 'builtin.in'), 'utf8'));
    const lock = requirements(await readFile(path.join(manifestRoot, 'builtin.lock'), 'utf8'));
    if (!existing) insert(BUILTIN, '内置 · 科学分析', meta.pythonVersion, packages, lock);
    return prepare(
      BUILTIN,
      packages,
      lock,
      'system',
      'Prepare builtin scientific environment',
      signal,
    );
  }
  function bindings(id) {
    return db
      .prepare('SELECT scope,target_id AS targetId FROM python_bindings WHERE environment_id=?')
      .all(id)
      .map((binding) => ({
        ...binding,
        name:
          binding.scope === 'project'
            ? core.projects.get(binding.targetId).name
            : core.meetings.get(binding.targetId).title,
      }));
  }
  async function selected(meetingId, override) {
    if (override != null) return override;
    const meeting = meetingId ? core.meetings.get(meetingId) : null;
    const binding = (scope, id) =>
      id
        ? db
            .prepare(
              'SELECT environment_id AS id FROM python_bindings WHERE scope=? AND target_id=?',
            )
            .get(scope, id)?.id
        : null;
    return (
      binding('meeting', meeting?.id) ??
      binding('project', meeting?.projectId) ??
      (await settings()).defaultEnvironment ??
      'system'
    );
  }
  async function resolve(meetingId, override = null, signal = null) {
    signal?.throwIfAborted();
    const id = await selected(meetingId, override);
    if (id === 'system') return { id, name: '系统 Python', env: {} };
    if (id === BUILTIN) await serialized(() => ensureBuiltin(signal));
    const environment = get(id);
    if (
      !['ready', 'partial'].includes(environment.status) ||
      !(await stat(interpreter(id)).catch(() => null))
    )
      throw new AppError(
        'ENVIRONMENT_UNAVAILABLE',
        '所选 Python 环境未就绪，请在设置中重试。',
        409,
      );
    const bin = path.dirname(interpreter(id));
    return {
      id,
      name: environment.name,
      env: { PATH: bin + path.delimiter + (process.env.PATH ?? ''), VIRTUAL_ENV: envPath(id) },
    };
  }
  async function changePackages(
    id,
    action,
    requested,
    actor = 'person_user',
    reason = '',
    signal = null,
  ) {
    const specs = validatePackages(requested);
    return serialized(async () => {
      signal?.throwIfAborted();
      const current = get(id);
      const names = new Set(specs.map(packageName));
      const next =
        action === 'sync'
          ? specs
          : current.packages
              .filter((item) => !names.has(packageName(item)))
              .concat(action === 'add' ? specs : []);
      if (!['sync', 'add', 'remove'].includes(action))
        throw new AppError('INVALID_ACTION', '包操作无效。');
      update(id, { status: 'preparing', error: null });
      try {
        const result = await sync(id, next, null, signal);
        update(id, {
          status: 'ready',
          packages_json: JSON.stringify(next),
          lock_json: JSON.stringify(result.lock),
          failed_json: '[]',
        });
        log(id, action, actor, reason, 'success', { packages: specs, details: result.details });
        return { environment: id, name: current.name, packages: specs, reason, status: 'success' };
      } catch (error) {
        update(id, { status: current.status, error: '软件包安装失败，请检查包名和镜像源后重试。' });
        log(id, action, actor, reason, 'failed', {
          packages: specs,
          message: error.message,
          stdout: error.stdout,
          stderr: error.stderr,
        });
        throw new AppError(
          'UV_OPERATION_FAILED',
          '软件包安装失败，请检查包名和镜像源后重试。',
          500,
        );
      }
    });
  }
  async function operate(input) {
    return serialized(async () => {
      const { action, id, actor = 'person_user' } = input;
      if (action === 'builtin') return ensureBuiltin();
      if (action === 'create' || action === 'copy') {
        const source = input.template || (action === 'copy' ? id : null);
        if (source === BUILTIN) await ensureBuiltin();
        const template = source ? get(source) : null;
        const next = 'py-' + randomUUID();
        const initial = validatePackages(input.packages ?? template?.packages ?? []);
        insert(
          next,
          input.name,
          template?.version ?? input.version ?? '3.14',
          initial,
          template?.lock ?? [],
        );
        return prepare(next, initial, template?.lock ?? null, actor, action);
      }
      const current = get(id);
      if (action === 'retry')
        return id === BUILTIN
          ? ensureBuiltin()
          : prepare(id, current.packages, current.lock.length ? current.lock : null, actor, action);
      if (action === 'rename') {
        if (!input.name?.trim()) throw new AppError('INVALID_NAME', '请输入环境名称。');
        update(id, { name: input.name.trim() });
      } else if (action === 'remove') {
        const affected = bindings(id);
        const destination = path.resolve(envPath(id));
        if (path.dirname(destination) !== path.resolve(root, 'envs'))
          throw new Error('Unexpected environment directory');
        await rm(destination, { recursive: true, force: true });
        if ((await settings()).defaultEnvironment === id)
          await core.workspace.edit({
            resource: 'settings',
            key: 'app',
            op: 'patch',
            args: { changes: { python: { defaultEnvironment: 'system' } } },
          });
        db.transaction(() => {
          db.prepare('DELETE FROM python_bindings WHERE environment_id=?').run(id);
          db.prepare('DELETE FROM python_environments WHERE id=?').run(id);
          changed('removed', id);
        });
        log(id, action, actor, '', 'success', { affected });
        return { removed: true, affected };
      } else throw new AppError('INVALID_ACTION', '环境操作无效。');
      log(id, action, actor, '', 'success', { name: input.name });
      return get(id);
    });
  }
  function bind(scope, targetId, id) {
    if (!['meeting', 'project'].includes(scope))
      throw new AppError('INVALID_SCOPE', '环境归属无效。');
    if (scope === 'meeting') core.meetings.get(targetId);
    else core.projects.get(targetId);
    if (id && !['system', BUILTIN].includes(id)) get(id);
    return db.transaction(() => {
      if (id)
        db.prepare(
          'INSERT INTO python_bindings VALUES(?,?,?) ON CONFLICT(scope,target_id) DO UPDATE SET environment_id=excluded.environment_id',
        ).run(scope, targetId, id);
      else
        db.prepare('DELETE FROM python_bindings WHERE scope=? AND target_id=?').run(
          scope,
          targetId,
        );
      changed('binding');
      return { scope, targetId, id };
    });
  }
  return {
    get,
    selected,
    resolve,
    bind,
    operate,
    packages: changePackages,
    bindings,
    binding(scope, targetId) {
      return (
        db
          .prepare('SELECT environment_id AS id FROM python_bindings WHERE scope=? AND target_id=?')
          .get(scope, targetId)?.id ?? null
      );
    },
    async list() {
      const currentSettings = settings();
      return {
        environments: await Promise.all(
          rows().map(async (row) => {
            // Disk scanning can finish after a client disconnects and the
            // application closes SQLite. Capture catalog state first.
            const environment = { ...decode(row), bindings: bindings(row.id) };
            const location = envPath(row.id);
            return { ...environment, ...(await directorySize(location)) };
          }),
        ),
        settings: await currentSettings,
        cache: await directorySize(path.join(root, 'cache')),
        interpreters: await directorySize(path.join(root, 'interpreters')),
      };
    },
    async detectSystem() {
      try {
        const result = await uv.python('python', [
          '-c',
          'import sys,json;print(json.dumps({"path":sys.executable,"version":sys.version.split()[0]}))',
        ]);
        return { available: true, ...JSON.parse(result.stdout) };
      } catch {
        return { available: false };
      }
    },
    async install(context, args) {
      const environment = await resolve(
        context.meetingId,
        args.environment ?? context.environmentId,
        context.signal,
      );
      if (environment.id === 'system')
        throw new AppError('SYSTEM_PYTHON', '请先为此对话选择受管 Python 环境。');
      return changePackages(
        environment.id,
        'add',
        args.packages,
        context.participantId,
        args.reason,
        context.signal,
      );
    },
    exportManifest(id) {
      const entry = get(id);
      return '# ' + entry.name + '\n' + entry.lock.join('\n') + '\n';
    },
    importManifest(id, text) {
      return changePackages(id, 'sync', requirements(text));
    },
    prune() {
      return serialized(async () => {
        const result = await command(['cache', 'prune']);
        log(null, 'prune', 'person_user', '', 'success', result);
        return { pruned: true };
      });
    },
    operations() {
      return db.prepare('SELECT * FROM python_operations ORDER BY id DESC').all();
    },
    async close() {
      closed = true;
      uv.close();
      await queue;
    },
  };
}
