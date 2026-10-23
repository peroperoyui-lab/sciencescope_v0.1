import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { runTexProcess } from './tex-process.js';

const ids = ['xelatex', 'lualatex', 'pdflatex'];
const entries = async (folder) => readdir(folder, { withFileTypes: true }).catch(() => []);

/**
 * @param {{env?:NodeJS.ProcessEnv,platform?:string,miktexDirs?:string[],texliveRoots?:string[],
 * extraDirs?:string[],probeTimeoutMs?:number,run?:typeof runTexProcess}} [options]
 */
export function createTexEngines({
  env = process.env,
  platform = process.platform,
  miktexDirs,
  texliveRoots,
  extraDirs = [],
  probeTimeoutMs = 5000,
  run = runTexProcess,
} = {}) {
  let cached;
  async function detect() {
    const windows = platform === 'win32';
    const pathValue = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? '';
    const directories = pathValue.split(windows ? ';' : ':').filter(Boolean);
    directories.push(
      ...(miktexDirs ??
        (windows
          ? [
              env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs/MiKTeX/miktex/bin/x64'),
              env.ProgramFiles && path.join(env.ProgramFiles, 'MiKTeX/miktex/bin/x64'),
            ].filter(Boolean)
          : [])),
    );
    for (const root of texliveRoots ?? (windows ? ['C:/texlive'] : ['/usr/local/texlive'])) {
      const years = (await entries(root))
        .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name));
      for (const year of years) {
        const bin = path.join(root, year.name, 'bin');
        const platforms = (await entries(bin)).filter((entry) => entry.isDirectory());
        const bins = windows ? ['windows', 'win64', 'win32'] : platforms.map((entry) => entry.name);
        const found = bins.filter((name) => platforms.some((entry) => entry.name === name));
        if (found.length) {
          directories.push(...found.map((name) => path.join(bin, name)));
          break;
        }
      }
    }
    directories.push(...(platform === 'darwin' ? ['/Library/TeX/texbin'] : []), ...extraDirs);
    const programs = {};
    for (const name of [...ids, 'latexmk', 'biber', 'bibtex']) {
      for (const folder of [...new Set(directories)]) {
        for (const extension of windows ? ['.exe', '.ps1'] : ['']) {
          const file = path.join(folder.replace(/^"|"$/g, ''), name + extension);
          if (
            !(await access(file, windows ? constants.F_OK : constants.X_OK).then(
              () => true,
              () => false,
            ))
          )
            continue;
          try {
            const result = await run(file, ['--version'], { env, timeoutMs: probeTimeoutMs });
            if (result.aborted || result.code !== 0) continue;
            const version = (result.stdout ?? result.output).trim().split(/\r?\n/)[0];
            programs[name] = {
              id: name,
              path: file,
              version,
              distribution: /miktex/i.test(version)
                ? 'miktex'
                : /tex live/i.test(version)
                  ? 'texlive'
                  : 'other',
            };
            break;
          } catch {
            /* An absent dependency or broken executable is not an available engine. */
          }
        }
        if (programs[name]) break;
      }
    }
    return {
      engines: ids.flatMap((id) => (programs[id] ? [programs[id]] : [])),
      latexmk: programs.latexmk?.path ?? null,
      biber: programs.biber?.path ?? null,
      bibtex: programs.bibtex?.path ?? null,
    };
  }
  return {
    /**
     * @param {boolean} [refresh]
     */
    get(refresh = false) {
      if (refresh || !cached) cached = detect();
      return cached;
    },
  };
}
