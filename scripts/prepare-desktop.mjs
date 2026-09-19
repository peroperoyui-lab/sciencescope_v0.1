import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultRoot = path.resolve(here, "..");
export const defaultOutputDir = path.join(defaultRoot, ".sciencescope-local", "desktop-dist");

export async function prepareDesktop({ root = defaultRoot, outputDir = path.join(root, ".sciencescope-local", "desktop-dist") } = {}) {
  const source = path.join(root, "ScienceScope.html");
  const bytes = await readFile(source);
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "index.html"), bytes);
  return { source, output: path.join(outputDir, "index.html"), bytes: bytes.length };
}

const invokedAsCli = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedAsCli) {
  prepareDesktop().then((result) => {
    console.log(`Desktop build ready: ${result.output} (${result.bytes} bytes)`);
  }).catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
