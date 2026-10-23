import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';

const clean = (text) => text.replace(/(?<!\\)%[^\r\n]*/g, '');
function magic(text, name) {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() && !line.trimStart().startsWith('%')) break;
    const match = line.match(new RegExp(`^\\s*%\\s*!TEX\\s+${name}\\s*=\\s*(.+)$`, 'i'));
    if (match) return match[1].trim();
  }
}
const document = (text) => /\\documentclass(?:\s*\[[^\]]*\])?\s*\{/.test(clean(text));

/**
 * @param {string} folder
 * @param {string[]} [exclude]
 * @returns {Promise<string[]>}
 */
export async function texFiles(folder, exclude = []) {
  const result = [];
  async function visit(relative) {
    for (const entry of await readdir(path.join(folder, relative), { withFileTypes: true })) {
      if (
        entry.name.startsWith('.') ||
        entry.name === 'node_modules' ||
        (!relative && exclude.includes(entry.name))
      )
        continue;
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.tex$/i.test(file)) result.push(file.split(path.sep).join('/'));
    }
  }
  await visit('');
  return result.sort();
}

/**
 * @param {string} project
 * @param {string} source
 * @param {string} [requested]
 * @param {string[]} [exclude]
 */
export async function selectTexRoot(project, source, requested, exclude = []) {
  const read = async (file) =>
    readFile(path.join(project, file), 'utf8').catch(() => {
      throw new AppError('DESK_TEX_ROOT', '无法读取项目里的 TeX 文件，请确认路径正确。');
    });
  const text = await read(source);
  const directive = magic(text, 'root');
  let root =
    requested ??
    (directive ? path.join(path.dirname(source), directive.replace(/^['"]|['"]$/g, '')) : null);
  if (!root && document(text)) root = source;
  if (!root) {
    const candidates = [];
    for (const file of await texFiles(project, exclude)) {
      const content = clean(await readFile(path.join(project, file), 'utf8'));
      if (!document(content)) continue;
      const included = [
        ...content.matchAll(/\\(?:input|include|subfile)\s*(?:\{([^}]+)\}|([^\s{}]+))/g),
      ];
      if (
        included.some((match) => {
          const target = match[1] ?? match[2];
          const name = /\.tex$/i.test(target) ? target : target + '.tex';
          return (
            path.resolve(project, name) === path.resolve(project, source) ||
            path.resolve(project, path.dirname(file), name) === path.resolve(project, source)
          );
        })
      )
        candidates.push(file);
    }
    if (candidates.length !== 1)
      throw Object.assign(new AppError('DESK_TEX_ROOT', '请选择要编译的主文件。', 409), {
        details: { candidates },
      });
    root = candidates[0];
  }
  const relative = path.relative(project, path.resolve(project, root));
  if (
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative) ||
    !/\.tex$/i.test(relative)
  )
    throw new AppError('DESK_TEX_ROOT', '主文件必须是项目文件夹里的 TeX 文件。');
  return { root: relative.split(path.sep).join('/'), text: await read(relative), sourceText: text };
}

/**
 * @param {any[]} engines
 * @param {{text:string,sourceText:string}} source
 * @param {string} setting
 */
export function selectTexEngine(engines, source, setting) {
  const body = clean(source.text);
  const preferred =
    setting !== 'auto'
      ? setting
      : (magic(source.sourceText, 'program') ??
        magic(source.text, 'program') ??
        (/\b(?:ctex\w*|xeCJK|fontspec)\b/.test(body)
          ? 'xelatex'
          : /\b(?:luacode|luatexja)\b/.test(body)
            ? 'lualatex'
            : 'pdflatex'));
  return (
    engines.find((engine) => engine.id === preferred) ??
    ['xelatex', 'lualatex', 'pdflatex']
      .map((id) => engines.find((engine) => engine.id === id))
      .find(Boolean)
  );
}

/**
 * @param {string} log
 * @param {string} project
 * @param {string} root
 */
export function texDiagnostics(log, project, root) {
  const rawLines = log.split(/\r?\n/);
  const lines = [];
  // MiKTeX wraps long absolute paths at max_print_line, including in the middle
  // of a directory name. Rejoin the path before interpreting file:line errors.
  for (let index = 0; index < rawLines.length; index++) {
    let line = rawLines[index];
    if (/^\(?(?:[a-z]:[\\/]|\.?\/)/i.test(line))
      while (
        !/\.(?:tex|sty|cls)(?=[:\s)]|$)/i.test(line) &&
        index + 1 < rawLines.length &&
        rawLines[index + 1] &&
        !/^\(?(?:[a-z]:[\\/]|\.?\/)|^! |^l\.\d+/i.test(rawLines[index + 1])
      )
        line += rawLines[++index];
    lines.push(line);
  }
  const errors = [];
  let currentFile = root;
  for (const [index, line] of lines.entries()) {
    const opened = [...line.matchAll(/\((?:\.\/)?([^()\r\n]+\.tex)(?=\s|$|\))/g)].at(-1);
    if (opened)
      currentFile = path.isAbsolute(opened[1])
        ? path.relative(project, opened[1]).split(path.sep).join('/')
        : opened[1];
    const located = line.match(/^(.+?\.(?:tex|sty|cls)):(\d+):\s*(.+)$/i);
    if (located) {
      const file = path.isAbsolute(located[1])
        ? path.relative(project, located[1])
        : located[1].replace(/^\.\//, '');
      errors.push({
        file: file.split(path.sep).join('/'),
        line: Number(located[2]),
        message: located[3],
      });
    } else if (line.startsWith('! ')) {
      const following = lines.slice(index + 1);
      const boundary = following.findIndex((value) => value.startsWith('! '));
      const next = (boundary < 0 ? following : following.slice(0, boundary)).find((value) =>
        /^l\.\d+\s/.test(value),
      );
      errors.push({
        file: currentFile,
        line: next ? Number(next.match(/^l\.(\d+)/)[1]) : null,
        message: line.slice(2),
      });
    }
  }
  return {
    errors: errors.filter(
      (error, index) =>
        errors.findIndex(
          (other) =>
            other.file === error.file &&
            other.line === error.line &&
            other.message === error.message,
        ) === index,
    ),
    warnings: lines.filter((line) => /\bWarning\b|^(?:Overfull|Underfull) \\[hv]box/.test(line))
      .length,
    logTail: rawLines.slice(-40).join('\n'),
  };
}
