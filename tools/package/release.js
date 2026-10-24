// Generate local release material only. Uploading and publishing remain a human
// release step; signature files are public updater signatures, never key files.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePackageVersion } from './version.js';

const execute = promisify(execFile);
const repository = 'peroperoyui-lab/sciencescope_v0.1';

/**
 * @param {string} log
 * @param {string|null} [previous]
 * @returns {string}
 */
export function releaseNotes(log, previous = null) {
  // Git blobs use LF while a Windows checkout may use CRLF for the same entry.
  const entries = log
    .replace(/\r\n?/gu, '\n')
    .split(/(?=^## )/mu)
    .filter((entry) => entry.startsWith('## '));
  if (!previous) return entries.join('\n').trim();
  const old = new Set(
    previous
      .replace(/\r\n?/gu, '\n')
      .split(/(?=^## )/mu)
      .map((entry) => entry.trim()),
  );
  return entries
    .filter((entry) => !old.has(entry.trim()))
    .join('\n')
    .trim();
}

/**
 * @param {{
 * root:string,
 * artifact:string,
 * signature?:string,
 * output:string,
 * previousVersion?:string,
 * since?:string,
 * date?:string,
 * url?:string
 * }} options
 * @returns {Promise<{version:string,notes:string,pub_date:string,platforms:object}>}
 */
export async function generateRelease({
  root,
  artifact,
  signature = `${artifact}.sig`,
  output,
  previousVersion,
  since,
  date = new Date().toISOString(),
  url,
}) {
  const { version } = await preparePackageVersion(root);
  if (!(await stat(artifact)).isFile()) throw new Error('Release artifact must be a file');
  const signed = (await readFile(signature, 'utf8')).trim();
  if (!signed) throw new Error('Updater signature is empty');
  const relativeLog = 'docs/log/IMPLEMENTATION_LOG.md';
  const log = await readFile(path.join(root, relativeLog), 'utf8');
  let base = since || (previousVersion ? `v${previousVersion}` : null);
  if (!base) {
    // A repository without release tags is the first local release draft.
    // Only version tags count: the old line's `v0-prototype` tag is not a release.
    base = await execute(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*'],
      {
        cwd: root,
        windowsHide: true,
      },
    ).then(
      (result) => result.stdout.trim(),
      () => null,
    );
  }
  let previous = null;
  if (base)
    previous = (
      await execute('git', ['show', `${base}:${relativeLog}`], { cwd: root, windowsHide: true })
    ).stdout;
  const notes =
    releaseNotes(log, previous) || '本版本没有新增实施记录。 / No new implementation log entries.';
  const published = new Date(date).toISOString();
  const download =
    url ||
    `https://github.com/${repository}/releases/download/v${version}/${encodeURIComponent(path.basename(artifact))}`;
  const latest = {
    version,
    notes,
    pub_date: published,
    platforms: { 'windows-x86_64': { signature: signed, url: download } },
  };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');
  await writeFile(
    path.join(output, '发布说明.md'),
    `# ScienceScope ${version}\n\n发布时间：${published}\n\n${notes}\n\n## 发布核对\n\n- 本地草稿，尚未上传或创建 Release。\n- 将安装包、同名 .sig 和 latest.json 上传至 v${version}；alpha 发布不勾选 pre-release。\n- 安装包：${path.basename(artifact)}\n- 下载：${download}\n- Authenticode 尚未签名：Windows SmartScreen 可能显示未知发布者/未识别应用提示。\n`,
  );
  return latest;
}

/**
 * @param {string[]} args
 * @returns {Record<string,string>}
 */
function argumentsOf(args) {
  const parsed = {};
  const names = {
    '--artifact': 'artifact',
    '--signature': 'signature',
    '--output': 'output',
    '--previous-version': 'previousVersion',
    '--since': 'since',
    '--date': 'date',
    '--url': 'url',
  };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1])
      throw new Error(
        'Usage: node tools/package/release.js --artifact <installer.exe> [--signature <installer.exe.sig>] [--output <folder>] [--previous-version <version> | --since <git-ref>] [--date <ISO>] [--url <download URL>]',
      );
    parsed[names[args[i]]] = args[i + 1];
  }
  if (!parsed.artifact) throw new Error('--artifact is required');
  return parsed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const input = argumentsOf(process.argv.slice(2));
  const result = await generateRelease({
    root,
    output: path.join(root, '.sciencescope-local/dist'),
    ...input,
  });
  console.log(`Generated local release material for ${result.version}`);
}
