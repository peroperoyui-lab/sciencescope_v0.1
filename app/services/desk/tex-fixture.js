// Executable fixtures live only in the caller's temporary directory. Both the
// detector and compiler exercise ordinary child processes without installed TeX.
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} folder
 * @param {string[]} names
 * @param {any} [initial]
 */
export async function fakeTex(folder, names, initial = {}) {
  await mkdir(folder, { recursive: true });
  const config = path.join(folder, 'config.json');
  const calls = path.join(folder, 'calls.jsonl');
  const script = path.join(folder, 'fake.cjs');
  await writeFile(config, JSON.stringify(initial));
  await writeFile(
    script,
    `
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const [configFile, name, ...commandArgs] = process.argv.slice(2);
const args = process.env.SCIENCESCOPE_FAKE_TEX_ARGS ? JSON.parse(process.env.SCIENCESCOPE_FAKE_TEX_ARGS) : commandArgs;
const config = JSON.parse(fs.readFileSync(configFile));
if (args.includes('--version')) {
  console.log(name + ' ' + (config.version || '(MiKTeX 25.12)'));
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ name, args, cwd:process.cwd(),
  noInstall:process.env.MIKTEX_MPM_AUTOINSTALL, pid:process.pid })+'\\n');
if (config.hang) {
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
  fs.writeFileSync(config.childPid,String(child.pid));
  setInterval(()=>{},1000);
} else if (name==='bibtex'||name==='biber') {
  fs.writeFileSync(args[0]+'.bbl','Numbered reference [1]');
} else {
  const arg=args.find(a=>a.startsWith('-output-directory=')||a.startsWith('-outdir='));
  const output=arg.slice(arg.indexOf('=')+1);
  const root=args.at(-1);
  const job=path.basename(root,'.tex');
  fs.mkdirSync(output,{recursive:true});
  const saved=fs.readFileSync(root,'utf8');
  if (config.failure) {
    fs.writeFileSync(path.join(output,job+'.log'),root+':7: Undefined control sequence.\\n');
    process.exitCode=1;
  } else {
    fs.writeFileSync(path.join(output,job+'.log'),'Output written on '+job+'.pdf\\n');
    fs.writeFileSync(path.join(output,job+'.pdf'),'%PDF-1.4\\n'+saved);
    if(config.bibliography==='biber') fs.writeFileSync(path.join(output,job+'.bcf'),'biblatex');
    if(config.bibliography==='bibtex') {
      fs.mkdirSync(path.join(output,'chapters'),{recursive:true});
      fs.writeFileSync(path.join(output,'chapters/one.aux'),'\\\\citation{evidence}');
      fs.writeFileSync(path.join(output,job+'.aux'),'\\\\@input{chapters/one.aux}');
    }
  }
}
`,
  );
  const files = {};
  for (const name of names) {
    const file = path.join(folder, name + (process.platform === 'win32' ? '.ps1' : ''));
    const quote = (value) =>
      "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'";
    await writeFile(
      file,
      process.platform === 'win32'
        ? '\uFEFF$env:SCIENCESCOPE_FAKE_TEX_ARGS = ConvertTo-Json -InputObject @($args) -Compress\n& ' +
            [process.execPath, script, config, name].map(quote).join(' ') +
            '\nexit $LASTEXITCODE\n'
        : '#!/bin/sh\nexec ' +
            [process.execPath, script, config, name].map(quote).join(' ') +
            ' "$@"\n',
    );
    if (process.platform !== 'win32') await chmod(file, 0o755);
    files[name] = file;
  }
  return {
    files,
    calls,
    config,
    set: (value) => writeFile(config, JSON.stringify(value)),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
      ),
      PATH: folder,
    },
    folder,
  };
}
