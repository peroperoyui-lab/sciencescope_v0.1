// Preserve installed dependency license texts, including native binary notices.
// The catalog follows actual production files rather than the full development
// lockfile, so it describes what the installer distributes.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {string} modules Production node_modules directory.
 * @param {string} output Notice file to distribute beside LICENSE.
 * @param {{name:string,version:string,license:string,repository:string,texts:string[]}[]} [runtimes]
 * @returns {Promise<number>} Number of installed packages documented.
 */
export async function generateNotices(modules, output, runtimes = []) {
  const packages = [...runtimes];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const folder = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        await visit(folder);
        continue;
      }
      const manifest = await readFile(path.join(folder, 'package.json'), 'utf8').catch(() => null);
      if (!manifest) continue;
      const metadata = JSON.parse(manifest);
      const files = await readdir(folder);
      const texts = [];
      for (const file of files.filter(
        (name) =>
          /^(?:licen[cs]e|copying|notice)(?:[.-]|$)/iu.test(name) ||
          (metadata.name.startsWith('@img/sharp-') && name === 'README.md'),
      )) {
        const text = await readFile(path.join(folder, file), 'utf8').catch(() => null);
        if (text) texts.push(`### ${file}\n${text}`);
      }
      packages.push({
        name: metadata.name,
        version: metadata.version,
        license: metadata.license || 'See upstream license',
        repository: metadata.repository?.url || metadata.repository || '',
        texts,
      });
      const nested = path.join(folder, 'node_modules');
      if (files.includes('node_modules')) await visit(nested);
    }
  }
  await visit(modules);
  packages.sort((left, right) => left.name.localeCompare(right.name));
  const text = [
    '# THIRD_PARTY_NOTICES',
    'ScienceScope is MIT licensed. The following production packages retain their own licenses.',
    ...packages.map(
      (entry) =>
        `## ${entry.name} ${entry.version}\nLicense: ${typeof entry.license === 'string' ? entry.license : JSON.stringify(entry.license)}\nSource: ${entry.repository}\n${entry.texts.join('\n')}`,
    ),
  ].join('\n\n');
  await writeFile(output, text);
  return packages.length;
}
