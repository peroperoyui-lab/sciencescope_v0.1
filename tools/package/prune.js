// Remove development-only files after notices have captured original licenses.
// Do not infer anything from directory names: DSH Markdown can be live prompts.
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

function removalReason(name, removedPackage, deepseek) {
  if (removedPackage) return 'onnxruntime-web';
  if (/^(?:licen[cs]e|copying|notice)(?:[._-]|$)/iu.test(name)) return null;
  if (/\.map$/iu.test(name)) return 'source-map';
  if (/\.d\.(?:ts|mts|cts)$/iu.test(name)) return 'declaration';
  if (/\.(?:ts|mts|cts)$/iu.test(name)) return 'typescript';
  if (/\.md$/iu.test(name) && !deepseek) return 'markdown';
  return null;
}

/**
 * @param {string} modules Staged production node_modules, never the development tree.
 * @returns {Promise<{files: number, bytes: number, reasons: Record<string, number>}>}
 */
export async function pruneProductionModules(modules) {
  const result = { files: 0, bytes: 0, reasons: {} };
  async function visit(directory, removedPackage = false, deepseek = false) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const isPackage = path.basename(directory) === 'node_modules';
        const remove = removedPackage || (isPackage && entry.name === 'onnxruntime-web');
        const keepMarkdown = deepseek || entry.name === '@deepseek-ai';
        await visit(filename, remove, keepMarkdown);
        // Empty directories have no runtime payload, and are cheap to omit.
        if ((await readdir(filename)).length === 0) await rm(filename, { recursive: true });
        continue;
      }
      if (!entry.isFile()) continue;
      const reason = removalReason(entry.name, removedPackage, deepseek);
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
