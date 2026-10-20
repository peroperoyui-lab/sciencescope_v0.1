import path from 'node:path';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import YAML from 'yaml';
import JSZip from 'jszip';
import { AppError } from '../../core/errors.js';

/**
 * Keep the complete YAML metadata and unmodified Markdown body.
 * @param {string} text
 * @returns {{name:string,description:string,metadata:Record<string,any>,body:string}}
 */
export function parseSkill(text) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  let metadata;
  try {
    metadata = match && YAML.parse(match[1]);
  } catch {
    throw new AppError('INVALID_SKILL_HEADER', 'SKILL.md 的 YAML 头格式不正确。');
  }
  if (
    !metadata ||
    typeof metadata.name !== 'string' ||
    !metadata.name.trim() ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim()
  )
    throw new AppError('INVALID_SKILL_HEADER', 'SKILL.md 的 YAML 头需要 name 和 description。');
  const name = metadata.name.trim();
  // The declared name becomes a directory on Windows as well as Unix.
  if (name === '.' || name === '..' || /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name))
    throw new AppError('INVALID_SKILL_NAME', '技能名称不能用作文件夹名。');
  return { name, description: metadata.description, metadata, body: text.slice(match[0].length) };
}

/**
 * @param {string} directory
 * @returns {Promise<ReturnType<typeof parseSkill>>}
 */
export async function readSkill(directory) {
  try {
    return parseSkill(await readFile(path.join(directory, 'SKILL.md'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT')
      throw new AppError('SKILL_FILE_MISSING', '这个文件夹里没有 SKILL.md。');
    throw error;
  }
}

/**
 * A ZIP may contain SKILL.md at its root or one enclosing skill folder.
 * @param {{path?:string,dataBase64?:string}} input
 * @param {string} destination
 * @returns {Promise<string>}
 */
export async function unpackSkill(input, destination) {
  if (input.path && !input.path.toLowerCase().endsWith('.zip')) {
    await cp(path.resolve(input.path), destination, { recursive: true });
    return destination;
  }
  let zip;
  try {
    const bytes = input.path
      ? await readFile(input.path)
      : Buffer.from(input.dataBase64 ?? '', 'base64');
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new AppError('INVALID_SKILL_ZIP', '无法读取技能 ZIP 文件。');
  }
  await mkdir(destination, { recursive: true });
  for (const entry of Object.values(zip.files)) {
    const target = path.resolve(destination, entry.name);
    const relative = path.relative(destination, target);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`))
      throw new AppError('INVALID_SKILL_ZIP', '无法读取技能 ZIP 文件。');
    if (entry.dir) await mkdir(target, { recursive: true });
    else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await entry.async('nodebuffer'));
    }
  }
  if (zip.file('SKILL.md')) return destination;
  const roots = (await readdir(destination, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  if (roots.length === 1) return path.join(destination, roots[0].name);
  throw new AppError('SKILL_FILE_MISSING', '这个文件夹里没有 SKILL.md。');
}
