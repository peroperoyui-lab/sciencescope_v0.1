// Remove development-only files after notices have captured original licenses.
// Runtime assets and every licence remain independent of directory names.
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

function removalReason(name, removedPackage, npmDevelopment) {
  if (removedPackage) return 'onnxruntime-web';
  if (/^(?:licen[cs]e|copying|notice)(?:[._-]|$)/iu.test(name)) return null;
  if (npmDevelopment) return 'npm-development';
  if (/\.map$/iu.test(name)) return 'source-map';
  if (/\.d\.(?:ts|mts|cts)$/iu.test(name)) return 'declaration';
  if (/\.(?:ts|mts|cts)$/iu.test(name)) return 'typescript';
  if (/\.md$/iu.test(name)) return 'markdown';
  return null;
}

/**
 * @param {string} modules Staged production node_modules, never the development tree.
 * @returns {Promise<{files: number, bytes: number, reasons: Record<string, number>}>}
 */
export async function pruneProductionModules(modules) {
  const result = { files: 0, bytes: 0, reasons: {} };
  async function visit(directory, removedPackage = false, npmTree = false, npmDevelopment = false) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const isPackage = path.basename(directory) === 'node_modules';
        const remove = removedPackage || (isPackage && entry.name === 'onnxruntime-web');
        const inNpm = npmTree || (isPackage && entry.name === 'npm');
        // npm executes its lib/commands/test.js, but published dependency test
        // and example directories are not part of package installation itself.
        const development =
          npmDevelopment ||
          (inNpm && /^(?:tests?|examples?|docs|man|benchmarks?)$/u.test(entry.name));
        await visit(filename, remove, inNpm, development);
        // Empty directories have no runtime payload, and are cheap to omit.
        if ((await readdir(filename)).length === 0) await rm(filename, { recursive: true });
        continue;
      }
      if (!entry.isFile()) continue;
      const reason = removalReason(entry.name, removedPackage, npmDevelopment);
      if (!reason) continue;
      const metadata = await stat(filename);
      await rm(filename);
      result.files++;
      result.bytes += metadata.size;
      result.reasons[reason] = (result.reasons[reason] ?? 0) + 1;
    }
  }
  await visit(path.resolve(modules));
  return result;
}
