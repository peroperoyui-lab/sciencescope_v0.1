import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, lstat, writeFile } from 'node:fs/promises';
import { dirname, basename, join, resolve, sep } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';
import { isSkillName } from '@deepseek-ai/dsh-skill';

const MAX_BYTES = 128 * 1024;

export class SkillManagerError extends Error {
  constructor(message, status = 400, options) {
    super(message, options);
    this.name = 'SkillManagerError';
    this.status = status;
  }
}

const asError = (error, status = 400) => error instanceof SkillManagerError
  ? error
  : new SkillManagerError(error?.message || String(error), status, { cause: error });

function inside(root, target) {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(`${r}${sep}`);
}

async function ensureRealPath(path, root) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new SkillManagerError('symbolic links are not allowed', 400);
  if (!inside(root, path)) throw new SkillManagerError('path escapes skill root', 400);
  return info;
}

async function checkTree(path, root) {
  const info = await ensureRealPath(path, root);
  if (!info.isDirectory()) return;
  for (const entry of await readdir(path)) await checkTree(join(path, entry), root);
}

async function atomicWrite(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, data, { flag: 'wx' });
  try { await rename(temp, path); } catch (error) { await rm(temp, { force: true }); throw error; }
}

function displayName(path, isDirectory) {
  const value = isDirectory ? basename(path) : basename(path, '.md');
  return value || '(unnamed)';
}

export async function createSkillManager({ home, ctx } = {}) {
  if (!home) throw new SkillManagerError('home is required', 400);
  const root = resolve(home);
  const enabled = join(root, 'skills');
  const disabled = join(root, 'disabled-skills');
  const removed = join(root, 'removed-skills');
  const staging = join(root, 'management-temp');
  await Promise.all([enabled, disabled, removed, staging].map((p) => mkdir(p, { recursive: true })));

  const context = ctx ?? new Context();
  const control = new AbortController();
  const provider = new FileSystemSkillProvider(context, {
    signal: control.signal,
    invalidate() {}
  }, { includeDefaultRoots: false, customSkillDirs: [enabled], watch: false });
  const disabledProvider = new FileSystemSkillProvider(context, {
    signal: control.signal,
    invalidate() {}
  }, { includeDefaultRoots: false, customSkillDirs: [disabled], watch: false });
  let chain = Promise.resolve();
  const mutate = (fn) => { const result = chain.then(fn, fn); chain = result.catch(() => {}); return result; };

  async function candidates() {
    const output = await provider.list({ signal: control.signal });
    return Array.isArray(output) ? output : output.candidates;
  }
  async function find(name, where = enabled) {
    if (!isSkillName(name)) throw new SkillManagerError('invalid skill name', 400);
    const path = join(where, name);
    if (!inside(where, path)) throw new SkillManagerError('invalid skill path', 400);
    try { await ensureRealPath(path, where); } catch (error) {
      if (error?.code === 'ENOENT') throw new SkillManagerError('skill not found', 404);
      throw error;
    }
    return path;
  }
  async function locate(name) {
    try { return { path: await find(name, enabled), enabled: true }; } catch (error) {
      if (!(error instanceof SkillManagerError) || error.status !== 404) throw error;
      return { path: await find(name, disabled), enabled: false };
    }
  }

  const manager = {
    enabledDirectory: enabled,
    async list() {
      const valid = new Map();
      for (const candidate of await candidates()) {
        if (!inside(enabled, candidate.locator?.directory ?? '')) continue;
        valid.set(candidate.name, candidate);
      }
      const skills = [];
      for (const entry of await readdir(enabled, { withFileTypes: true })) {
        if (entry.name === '.system' || entry.name.startsWith('.')) continue;
        const path = join(enabled, entry.name);
        if (entry.isSymbolicLink()) { skills.push({ name: entry.name, description: '', enabled: true, path, valid: false }); continue; }
        const candidate = valid.get(entry.name);
        skills.push(candidate
          ? { name: candidate.name, description: candidate.description, enabled: true, path, valid: true }
          : { name: displayName(path, entry.isDirectory()), description: '', enabled: true, path, valid: false });
      }
      const disabledResult=await disabledProvider.list({signal:control.signal});
      const disabledRows=Array.isArray(disabledResult)?disabledResult:disabledResult.candidates;
      for (const entry of await readdir(disabled, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(disabled, entry.name);
        const candidate = disabledRows.find((row) => resolve(row.locator?.directory ?? '') === resolve(path));
        skills.push(candidate
          ? { name: candidate.name, description: candidate.description, enabled: false, path, valid: true }
          : { name: displayName(path, entry.isDirectory()), description: '', enabled: false, path, valid: false });
      }
      skills.sort((a, b) => a.name.localeCompare(b.name));
      return { skills, directory: enabled };
    },
    async read({ name }) {
      const located = await locate(name);
      const path = located.path;
      const file = join(path, 'SKILL.md');
      try { await ensureRealPath(file, path); } catch (error) { if (error?.code === 'ENOENT') throw new SkillManagerError('skill not found', 404); throw error; }
      return { name, markdown: await readFile(file, 'utf8'), enabled: located.enabled };
    },
    async save({ markdown, name: suppliedName } = {}) {
      return mutate(async () => {
        if (typeof markdown !== 'string' || Buffer.byteLength(markdown, 'utf8') > MAX_BYTES) throw new SkillManagerError('markdown must be at most 128 KiB', 400);
        if (suppliedName !== undefined && !isSkillName(suppliedName)) throw new SkillManagerError('invalid skill name', 400);
        const id = randomUUID();
        const folder = join(staging, id, 'skill');
        await mkdir(folder, { recursive: true });
        const stagedFile = join(folder, 'SKILL.md');
        try {
        await atomicWrite(stagedFile, markdown);
        let discovered;
        try {
          const stagedControl = new AbortController();
          const stagedProvider = new FileSystemSkillProvider(context, { signal: stagedControl.signal, invalidate() {} }, { includeDefaultRoots: false, customSkillDirs: [dirname(folder)], watch: false });
          try {
            const found = await stagedProvider.list({ signal: stagedControl.signal });
            const rows = Array.isArray(found) ? found : found.candidates;
            const ours = rows.filter((candidate) => resolve(candidate.locator?.directory ?? '') === resolve(folder));
            if (ours.length !== 1) throw new SkillManagerError('markdown must contain exactly one valid skill', 400);
            discovered = ours[0];
          } finally { stagedControl.abort(); await stagedProvider.dispose(); }
        } catch (error) { throw asError(error); }
        const name = discovered.name;
        if (suppliedName !== undefined && suppliedName !== name) throw new SkillManagerError('supplied name does not match markdown name', 400);
        const existing = join(enabled, name);
        let oldState = 'new';
        try { await ensureRealPath(existing, enabled); oldState = 'enabled'; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        const disabledPath = join(disabled, name);
        if (oldState === 'new') { try { await ensureRealPath(disabledPath, disabled); oldState = 'disabled'; } catch (error) { if (error?.code !== 'ENOENT') throw error; } }
        if (oldState !== 'new' && suppliedName === undefined) throw new SkillManagerError('skill already exists; open it to edit', 409);
        if (oldState === 'new' && suppliedName !== undefined) throw new SkillManagerError('skill to edit no longer exists', 404);
        if (oldState === 'new') await rename(folder, existing);
        else {
          const target = oldState === 'enabled' ? existing : disabledPath;
          await checkTree(target, oldState === 'enabled' ? enabled : disabled);
          await atomicWrite(join(target, 'SKILL.md'), markdown);
        }
        provider.observeHostMutation(join(enabled, name, 'SKILL.md'));
        return { name, enabled: oldState !== 'disabled' };
        } finally {
          await rm(join(staging, id), { recursive: true, force: true });
        }
      });
    },
    async setEnabled({ name, enabled: wantEnabled }) {
      return mutate(async () => {
        if (typeof wantEnabled !== 'boolean') throw new SkillManagerError('enabled must be boolean', 400);
        const from = wantEnabled ? disabled : enabled;
        const to = wantEnabled ? enabled : disabled;
        const source = await find(name, from);
        const target = join(to, name);
        try { await lstat(target); throw new SkillManagerError('skill already exists', 409); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
        await checkTree(source, from);
        await rename(source, target);
        return { name, enabled: !!wantEnabled };
      });
    },
    async remove({ name }) {
      return mutate(async () => {
        const located = await locate(name);
        const source = located.path;
        await checkTree(source, located.enabled ? enabled : disabled);
        const recoveryPath = join(removed, randomUUID(), name);
        await mkdir(dirname(recoveryPath), { recursive: true });
        await rename(source, recoveryPath);
        return { removed: true, recoveryPath };
      });
    },
    async close() { control.abort(); await provider.dispose(); await disabledProvider.dispose(); }
  };
  return manager;
}

export default createSkillManager;
