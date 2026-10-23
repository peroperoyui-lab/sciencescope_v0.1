import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { texFiles } from './tex-source.js';

/**
 * All compiler and bibliography outputs belong to the build directory. Include
 * auxiliaries keep their subdirectories relative to the main file's folder (the
 * compiler's working directory), which TeX does not create.
 * @param {string} project
 * @param {string} folder the main file's folder
 * @param {string} output
 * @param {string[]} [exclude]
 * @returns {Promise<void>}
 */
export async function prepareTexBuild(project, folder, output, exclude = []) {
  await mkdir(output, { recursive: true });
  for (const file of await texFiles(project, exclude)) {
    const relative = path.relative(folder, path.join(project, path.dirname(file)));
    if (!relative.startsWith('..') && !path.isAbsolute(relative))
      await mkdir(path.join(output, relative), { recursive: true });
  }
}

/**
 * Only child processes receive search paths; the user's TeX configuration stays
 * unchanged. The main file's folder is searched without recursion, so an older
 * copy elsewhere in the project never shadows a chapter; a trailing delimiter
 * keeps the distribution's built-in paths. Unwrapped log lines (TeX Live reads
 * max_print_line from the environment) keep messages whole for the parser.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} folder the main file's folder
 * @param {string} output
 * @param {(string|null)[]} programs
 * @returns {NodeJS.ProcessEnv}
 */
export function texBuildEnv(env, folder, output, programs) {
  const result = { ...env };
  const key = Object.keys(result).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  result[key] = [
    ...new Set(programs.filter(Boolean).map((file) => path.dirname(file))),
    result[key] ?? '',
  ].join(path.delimiter);
  for (const name of ['TEXINPUTS', 'BIBINPUTS', 'BSTINPUTS'])
    result[name] = [folder.replaceAll('\\', '/'), result[name] ?? '', ''].join(path.delimiter);
  result.TEXMFOUTPUT = output;
  result.max_print_line = '10000';
  result.error_line = '254';
  result.half_error_line = '238';
  return result;
}

/**
 * latexmk is an installed command, not a bundled dependency. -norc avoids
 * project/user rc commands changing the requested output or enabling shell escape.
 * @param {{id:string,path:string,distribution:string}} engine
 * @param {string|null} latexmk
 * @param {string} root
 * @param {string} output
 * @returns {{executable:string,args:string[]}}
 */
export function texCommand(engine, latexmk, root, output) {
  const flags = [
    '-interaction=nonstopmode',
    '-file-line-error',
    '-no-shell-escape',
    '-halt-on-error',
  ];
  const installer = engine.distribution === 'miktex' ? ['--disable-installer'] : [];
  if (!latexmk)
    return {
      executable: engine.path,
      args: [...installer, ...flags, `-output-directory=${output}`, root],
    };
  const command = `"${engine.path.replaceAll('\\', '/')}" ${installer.join(' ')} %O %S`;
  const perl = command.replaceAll('\\', '\\\\').replaceAll("'", "\\'");
  return {
    executable: latexmk,
    args: [
      '-norc',
      { xelatex: '-pdfxe', lualatex: '-pdflua', pdflatex: '-pdf' }[engine.id],
      '-e',
      `$${engine.id} = '${perl}';`,
      ...flags,
      `-outdir=${output}`,
      root,
    ],
  };
}

/**
 * Citation commands can live in an included chapter's .aux. A .bcf requests
 * biber; biblatex with backend=bibtex uses the ordinary .aux bibliography path.
 * @param {string} output
 * @param {string} job
 * @returns {Promise<'biber'|'bibtex'|null>}
 */
export async function bibliography(output, job) {
  const files = await readdir(output, { recursive: true });
  if (files.includes(job + '.bcf')) return 'biber';
  for (const file of files.filter((name) => name.endsWith('.aux')))
    if (
      /\\(?:citation|bibdata|abx@aux@cite)\b/.test(await readFile(path.join(output, file), 'utf8'))
    )
      return 'bibtex';
  return null;
}
