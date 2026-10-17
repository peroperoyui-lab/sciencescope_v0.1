// Reference: pi-coding-agent 1.0.0 core/tools/{read,write,edit,find,grep}, MIT.
// Uses Node file/glob APIs, exact edits and a shared mutation queue, without
// upstream rendering code or external rg/fd downloads. Absolute paths are
// intentional: user confirmed this scope for P1b on 2026-10-17.
import { glob, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../core/errors.js';
import { presentOutput } from './output.js';

async function canonical(file) {
  try {
    return await realpath(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) return file;
    return path.join(await canonical(parent), path.basename(file));
  }
}

/**
 * Resolve the existing credential boundary, including directory aliases.
 * @param {string} workFolder
 * @param {string} requested
 * @param {string} secretDirectory
 */
export async function filePath(workFolder, requested, secretDirectory) {
  if (typeof requested !== 'string' || !requested.trim())
    throw new AppError('FILE_PATH_REQUIRED', 'A file path is required.');
  const file = await canonical(path.resolve(workFolder, requested));
  const secret = await canonical(secretDirectory);
  const relative = path.relative(secret, file);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
    throw new AppError('CREDENTIAL_PATH', 'Credential files cannot be read or written by tools.');
  return file;
}

function decode(bytes, file) {
  if (/\.(pdf|docx?|odt)$/i.test(file))
    throw new AppError(
      'RESEARCH_DOCUMENT',
      'Import this document into the research library and use research_read.',
    );
  if (bytes.includes(0))
    throw new AppError('BINARY_FILE', 'This is a binary file; read_file accepts text.');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new AppError(
      'BINARY_FILE',
      'This is binary or non-UTF-8 content; convert it to UTF-8 text first.',
    );
  }
}

/**
 * @param {{secret:string,temp:string}} paths
 */
export function createFileTools(paths) {
  const mutations = new Map();
  async function mutate(file, operation) {
    const previous = mutations.get(file) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    mutations.set(file, next);
    try {
      return await next;
    } finally {
      if (mutations.get(file) === next) mutations.delete(file);
    }
  }
  async function candidates(root, pattern, signal) {
    const result = [];
    for await (const entry of glob(pattern, {
      cwd: root,
      exclude: ['**/.git', '**/.git/**', '**/node_modules', '**/node_modules/**'],
    })) {
      signal?.throwIfAborted();
      try {
        const file = await filePath(root, entry, paths.secret);
        if ((await stat(file)).isFile()) result.push({ file, relative: path.relative(root, file) });
      } catch (error) {
        if (error.code !== 'CREDENTIAL_PATH') throw error;
      }
    }
    return result.sort((left, right) => left.relative.localeCompare(right.relative));
  }
  return async function run(name, args, { workFolder, signal }) {
    signal?.throwIfAborted();
    const file = await filePath(workFolder, args.path ?? '.', paths.secret);
    if (name === 'read_file') {
      const text = decode(await readFile(file, { signal }), file);
      const lines = text.split(/\r?\n/);
      const offset = args.offset ?? 1;
      if (
        !Number.isInteger(offset) ||
        offset < 1 ||
        (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1))
      )
        throw new AppError('INVALID_PAGE', 'offset and limit must be positive line counts.');
      const selected = lines.slice(
        offset - 1,
        args.limit == null ? undefined : offset - 1 + args.limit,
      );
      return {
        path: file,
        offset,
        totalLines: lines.length,
        lines: selected.length,
        ...(await presentOutput(selected.join('\n'), paths.temp)),
      };
    }
    if (name === 'write_file' || name === 'edit_file')
      return mutate(file, async () => {
        signal?.throwIfAborted();
        let content = args.content;
        if (name === 'edit_file') {
          content = decode(await readFile(file, { signal }), file);
          if (
            typeof args.oldText !== 'string' ||
            !args.oldText.length ||
            typeof args.newText !== 'string'
          )
            throw new AppError('INVALID_EDIT', 'Supply nonempty oldText and a string newText.');
          const first = content.indexOf(args.oldText);
          if (first < 0)
            throw new AppError(
              'EDIT_NOT_FOUND',
              'oldText was not found; read the file and provide exact text.',
            );
          if (content.indexOf(args.oldText, first + 1) >= 0)
            throw new AppError(
              'EDIT_AMBIGUOUS',
              'oldText occurs more than once; include more surrounding text.',
            );
          content =
            content.slice(0, first) + args.newText + content.slice(first + args.oldText.length);
        }
        if (typeof content !== 'string')
          throw new AppError('INVALID_CONTENT', 'content must be text.');
        await mkdir(path.dirname(file), { recursive: true });
        signal?.throwIfAborted();
        await writeFile(file, content, { signal });
        return { path: file, bytes: Buffer.byteLength(content) };
      });
    const entries = (await stat(file)).isDirectory()
      ? await candidates(
          file,
          name === 'list_files' ? (args.pattern ?? '**/*') : (args.glob ?? '**/*'),
          signal,
        )
      : [{ file, relative: path.basename(file) }];
    if (name === 'list_files')
      return {
        count: entries.length,
        ...(await presentOutput(entries.map((entry) => entry.relative).join('\n'), paths.temp)),
      };
    const expression = new RegExp(args.pattern, args.ignoreCase ? 'iu' : 'u');
    const matches = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      let text;
      try {
        text = decode(await readFile(entry.file, { signal }), entry.file);
      } catch (error) {
        if (['BINARY_FILE', 'RESEARCH_DOCUMENT'].includes(error.code)) continue;
        throw error;
      }
      text.split(/\r?\n/).forEach((line, index) => {
        if (expression.test(line)) matches.push(`${entry.relative}:${index + 1}:${line}`);
      });
    }
    return { matches: matches.length, ...(await presentOutput(matches.join('\n'), paths.temp)) };
  };
}
