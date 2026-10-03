import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { hostname } from 'node:os';

export const PROTECTED_PATH_MESSAGE = '该路径属于应用内部数据，不可访问。';

/** Normalize Windows aliases before canonical filesystem resolution. */
export function normalizePathSpelling(value, { platform = process.platform } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('A non-empty path is required');
  let result = value.trim().replace(/^['"]|['"]$/gu, '');
  if (platform !== 'win32') return result;
  result = result.replaceAll('/', '\\').replace(/^\\\\\?\\UNC\\/iu, '\\\\').replace(/^\\\\\?\\/u, '');
  const admin = result.match(/^\\\\([^\\]+)\\([a-z])\$\\(.*)$/iu);
  if (admin && ['localhost', '127.0.0.1', hostname().toLowerCase()].includes(admin[1].toLowerCase())) result = `${admin[2]}:\\${admin[3]}`;
  result = result.split('\\').map((part, index) => index === 0 && /^[a-z]:$/iu.test(part) ? part : part === '..' || part === '.' ? part : part.replace(/[. ]+$/gu, '')).join('\\');
  // Alternate data streams belong to the same protected file.
  const stream = result.indexOf(':', /^[a-z]:/iu.test(result) ? 2 : 0);
  return stream < 0 ? result : result.slice(0, stream);
}

export async function canonicalPath(value, { cwd = process.cwd(), platform = process.platform } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const absolute = paths.resolve(cwd, normalizePathSpelling(value, { platform }));
  if (platform !== process.platform) return absolute;
  let current = absolute; const suffix = [];
  for (;;) {
    try { return paths.join(await realpath(current), ...suffix); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
      const parent = paths.dirname(current);
      if (parent === current) return absolute;
      suffix.unshift(paths.basename(current)); current = parent;
    }
  }
}

export function pathContains(parent, child, { platform = process.platform } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const normalize = value => platform === 'win32' ? value.toLowerCase() : value;
  const relative = paths.relative(normalize(parent), normalize(child));
  return relative === '' || relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
}

export function expandCommandVariables(command, env = process.env) {
  const values = new Map(Object.entries(env).map(([key, value]) => [key.toLowerCase(), String(value)]));
  const lookup = (match, name) => values.get(name.toLowerCase()) ?? match;
  let result = command.replace(/%([a-z_][a-z0-9_]*)%/giu, lookup)
    .replace(/\$\{env:([a-z_][a-z0-9_]*)\}|\$env:([a-z_][a-z0-9_]*)/giu, (match, braces, plain) => lookup(match, braces ?? plain))
    .replace(/\$\{([a-z_][a-z0-9_]*)\}|\$([a-z_][a-z0-9_]*)/giu, (match, braces, plain) => lookup(match, braces ?? plain));
  result = result.replace(/(^|[\s'"=])~(?=[/\\]|[\s'";]|$)/gu, (_match, prefix) => prefix + (values.get('userprofile') ?? values.get('home') ?? '~'));
  return result;
}

/** Host-owned roots, used by the adapter before public tool dispatch. */
export function createProtectedPathPolicy({ protectedPaths, platform = process.platform, env = process.env, resolvePath } = {}) {
  if (!Array.isArray(protectedPaths) || protectedPaths.some(value => typeof value !== 'string' || !value.trim())) throw new TypeError('protectedPaths must contain absolute host paths');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (protectedPaths.some(value => !paths.isAbsolute(normalizePathSpelling(value, { platform })))) throw new TypeError('Protected paths must be absolute');
  const resolve = resolvePath ?? ((value, cwd) => canonicalPath(value, { cwd, platform }));
  const rootsPromise = Promise.all(protectedPaths.map(async value => ({ spelling: paths.resolve(normalizePathSpelling(value, { platform })), canonical: await resolve(value, process.cwd()) })));
  async function inspectPath(value, { cwd = process.cwd(), recursive = false } = {}) {
    const spelling = paths.resolve(cwd, normalizePathSpelling(value, { platform }));
    const canonical = await resolve(spelling, cwd);
    for (const root of await rootsPromise) {
      const matches = (a, b) => pathContains(a, b, { platform });
      if (matches(root.canonical, canonical) || matches(root.spelling, spelling)
        || recursive && (matches(canonical, root.canonical) || matches(spelling, root.spelling))) {
        return { protected: true, root: root.spelling, canonicalPath: canonical };
      }
    }
    return { protected: false, canonicalPath: canonical };
  }
  async function inspectShell({ command, workdir, cwd = process.cwd() } = {}) {
    const effectiveCwd = paths.resolve(cwd, normalizePathSpelling(workdir ?? cwd, { platform }));
    const cwdMatch = await inspectPath(effectiveCwd);
    if (cwdMatch.protected) return { protected: true, targetPaths: [cwdMatch.canonicalPath] };
    // Backticks in PowerShell commonly split a literal path's spelling while
    // preserving its value (for example, .sciencescope`-local).
    const expanded = expandCommandVariables(String(command ?? '').replace(/`(?=[a-z0-9_.\\/:-])/giu, ''), env);
    const fold = value => platform === 'win32' ? value.replaceAll('\\', '/').toLowerCase() : value;
    const text = fold(expanded); const matches = [];
    for (const root of await rootsPromise) {
      if ([root.spelling, root.canonical].some(value => {
        const needle = fold(value); let offset = text.indexOf(needle);
        while (offset >= 0) {
          const after = text[offset + needle.length];
          if (after === undefined || /[\/\s'";|&()<>,:]/u.test(after)) return true;
          offset = text.indexOf(needle, offset + 1);
        }
        return false;
      })) matches.push(root.spelling);
    }
    // A command reaches a protected root not only by naming it but also through
    // an ancestor (grep -r, find, cd, globs) or a path split by quotes or built
    // inside a code string. Each such reference is inspected as an ancestor.
    const references = new Set();
    for (const token of expanded.match(/"[^"]*"|'[^']*'|[^\s;|&()<>]+/gu) ?? []) {
      let value = token.replace(/^['"]|['"]$/gu, '');
      if (!/^['"]/u.test(token)) value = value.replace(/["']/gu, '');
      value = value.replace(/[;,]+$/gu, '').replace(/^[a-z_][a-z0-9_]*=/iu, '');
      if (value && !value.startsWith('-') && !/^(?:https?|ftp):/iu.test(value)) references.add(value);
      for (const fragment of value.matchAll(/(?<![\w.~$%}-])(?:[a-z]:)?(?:~|\.{1,2})?[\\/][^\s'"+(),;=|&<>`]*|(?<![\w.])\.\.(?![\w.])/giu)) {
        if (fragment[0].length < 2 || fragment[0].startsWith('//') && value[fragment.index - 1] === ':') continue;
        references.add(fragment[0]);
      }
    }
    for (let value of [...references].slice(0, 200)) {
      const wildcard = value.search(/[*?[]/u);
      if (wildcard >= 0) value = value.slice(0, Math.max(value.lastIndexOf('/', wildcard), value.lastIndexOf('\\', wildcard)) + 1) || '.';
      try { const match = await inspectPath(value, { cwd: effectiveCwd, recursive: true }); if (match.protected) matches.push(match.canonicalPath); }
      catch (error) { if (!['ENOENT', 'ENOTDIR', 'EINVAL'].includes(error.code)) throw error; }
    }
    // PowerShell's standard encoded-command spelling is cheap to recognize;
    // arbitrary constructed scripts remain outside text inspection guarantees.
    const encoded = expanded.match(/-(?:enc|encodedcommand)\s+([a-z0-9+/=]+)/iu);
    if (encoded) {
      const decoded = Buffer.from(encoded[1], 'base64').toString('utf16le');
      if (!/-encodedcommand|-enc\s/iu.test(decoded)) {
        const nested = await inspectShell({ command: decoded, cwd: effectiveCwd }); matches.push(...nested.targetPaths);
      }
    }
    return { protected: matches.length > 0, targetPaths: [...new Set(matches)] };
  }
  return { inspectPath, inspectShell };
}
