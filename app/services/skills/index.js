import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { AppError } from '../../core/errors.js';
import { readSkill, unpackSkill } from './files.js';

const builtinDirectory = fileURLToPath(new URL('../../resources/skills/', import.meta.url));

/** @type {import('../../runtime/port.js').ToolSpec} */
export const USE_SKILL_SPEC = {
  name: 'use_skill',
  description:
    'Read an enabled skill and follow its instructions. Returns its Markdown body and absolute directory; resolve relative reference and script paths against that directory.',
  parameters: { name: { type: 'string', required: true } },
};

/**
 * Skill files remain the source of truth; edits and switches apply next turn.
 * @param {import('../../core/index.js').Core} core
 * @param {{builtins?:string}} [options]
 */
export function createSkills(core, { builtins = builtinDirectory } = {}) {
  async function scan(root, source) {
    const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const result = [];
    for (const entry of entries.filter(
      (item) => item.isDirectory() && !item.name.startsWith('.import-'),
    )) {
      const directory = path.join(root, entry.name);
      try {
        result.push({ ...(await readSkill(directory)), source, directory });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
        result.push({
          name: entry.name,
          description: '',
          metadata: {},
          body: '',
          source,
          directory,
          error: error.message,
        });
      }
    }
    return result;
  }

  async function catalog() {
    const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
    const disabled = new Set(settings.skills.disabled);
    const rows = new Map();
    for (const skill of [
      ...(await scan(builtins, 'builtin')),
      ...(await scan(core.paths.skills, 'user')),
    ])
      rows.set(skill.name, { ...skill, enabled: !skill.error && !disabled.has(skill.name) });
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async function list() {
    const participants = await Promise.all(
      core.participants.list().map((item) => core.participants.get(item.id)),
    );
    return (await catalog()).map(({ body: _body, ...skill }) => ({
      ...skill,
      boundRoles: participants
        .filter((item) => item.definition?.skills?.includes(skill.name))
        .map((item) => ({ id: item.id, name: item.name })),
    }));
  }

  async function read(name) {
    const skill = (await catalog()).find((item) => item.name === name);
    if (!skill) throw new AppError('SKILL_NOT_FOUND', '找不到这个技能。', 404);
    return skill;
  }

  async function use(name) {
    const skill = (await catalog()).find((item) => item.name === name);
    if (!skill) return { message: '找不到这个技能。' };
    if (!skill.enabled) return { message: skill.error ?? '这个技能已停用。' };
    return { name: skill.name, body: skill.body, directory: skill.directory };
  }

  async function prompt(bound = [], { catalog: showCatalog = true } = {}) {
    const enabled = (await catalog()).filter((item) => item.enabled);
    if (!enabled.length) return '';
    const lines = enabled.map((item) => `${item.name}：${item.description}`);
    const bodies = enabled
      .filter((item) => bound.includes(item.name))
      .map((item) => `### ${item.name}\n技能文件夹：${item.directory}\n${item.body}`);
    return (
      (showCatalog
        ? `\n\n## 可用技能\n${lines.join('\n')}\n需要时用 use_skill 读正文，再照着做。`
        : '') + (bodies.length ? `\n\n## 已绑定技能\n${bodies.join('\n\n')}` : '')
    );
  }

  async function importSkill(input) {
    await mkdir(core.paths.skills, { recursive: true });
    const temporary = await mkdtemp(path.join(core.paths.skills, '.import-'));
    try {
      const folder = await unpackSkill(input, path.join(temporary, 'content'));
      const skill = await readSkill(folder);
      const destination = path.join(core.paths.skills, skill.name);
      // mkdir is the exclusive claim, including case-insensitive Windows names.
      try {
        await mkdir(destination);
      } catch (error) {
        if (error.code === 'EEXIST')
          throw new AppError('SKILL_EXISTS', '已有同名用户技能，请先改名。', 409);
        throw error;
      }
      try {
        await cp(folder, destination, { recursive: true });
      } catch (error) {
        await rm(destination, { recursive: true, force: true });
        throw error;
      }
      return read(skill.name);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  async function copyBuiltin(name) {
    const original = (await scan(builtins, 'builtin')).find((item) => item.name === name);
    if (!original) throw new AppError('SKILL_NOT_FOUND', '找不到这个技能。', 404);
    return importSkill({ path: original.directory });
  }

  async function remove(name) {
    const skill = await read(name);
    if (skill.source !== 'user')
      throw new AppError('BUILTIN_SKILL', '内置技能不能删除，请先复制为用户技能。');
    // Renaming excludes a deleting skill from concurrent catalog reads.
    const removed = await mkdtemp(path.join(core.paths.skills, '.import-'));
    try {
      await rename(skill.directory, path.join(removed, 'deleted'));
    } finally {
      await rm(removed, { recursive: true, force: true });
    }
    return { deleted: true };
  }

  return { list, read, use, prompt, import: importSkill, copyBuiltin, remove };
}
