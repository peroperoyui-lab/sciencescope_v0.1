// Keep source-relative application resources at their original paths. Only
// dependency implementations move into shared chunks; development runs source.
import { readdir, readFile, mkdir, cp, access, writeFile } from 'node:fs/promises';
import path from 'node:path';

const externalPackages = [
  'npm',
  'esbuild',
  'pdfjs-dist',
  'sqlite-vec',
  'onnxruntime-node',
  'onnxruntime-common',
  '@napi-rs/canvas',
  '@huggingface/transformers',
];
const externalImports = new Set([...externalPackages, 'trash']);
const packageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
const slash = (file) => file.replaceAll('\\', '/');
const testingFile = (file) => /(?:\.test\.js|(?:^|[-/])testing\.js)$/u.test(slash(file));

async function filesIn(directory) {
  const files = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) files.push(file);
    }
  }
  await visit(directory);
  return files;
}

async function copyFile(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

async function copyBrowserAssets(modules, output) {
  const picks = {
    preact: ['dist/preact.mjs', 'hooks/dist/hooks.mjs'],
    htm: ['dist/htm.mjs'],
    marked: ['lib/marked.esm.js'],
    dompurify: ['dist/purify.es.mjs'],
    cytoscape: ['dist/cytoscape.esm.min.mjs'],
    katex: ['dist'],
    mathlive: ['mathlive.min.mjs'],
    '@fontsource-variable/noto-sans-sc': ['index.css', 'files'],
  };
  for (const [name, assets] of Object.entries(picks)) {
    const source = path.join(modules, name);
    const target = path.join(output, 'node_modules', name);
    for (const relative of assets) {
      await mkdir(path.dirname(path.join(target, relative)), { recursive: true });
      await cp(path.join(source, relative), path.join(target, relative), { recursive: true });
    }
    for (const file of await readdir(source)) {
      if (file === 'package.json' || /^(?:license|notice|copying)(?:[._-]|$)/iu.test(file))
        await copyFile(path.join(source, file), path.join(target, file));
    }
  }
  return Object.keys(picks).map((name) => path.join(modules, name));
}

async function findPackage(name, from) {
  let directory = from;
  while (true) {
    const candidate = path.join(directory, 'node_modules', name);
    try {
      await access(path.join(candidate, 'package.json'));
      return candidate;
    } catch {
      /* Node searches each ancestor's node_modules. */
    }
    const parent = path.dirname(directory);
    if (directory === parent) return null;
    directory = parent;
  }
}

function supportsWindows(metadata) {
  for (const [field, value] of [
    ['os', 'win32'],
    ['cpu', 'x64'],
  ]) {
    const choices = metadata[field];
    if (!Array.isArray(choices)) continue;
    if (choices.includes('!' + value)) return false;
    const positive = choices.filter((choice) => !choice.startsWith('!'));
    if (positive.length && !positive.includes(value)) return false;
  }
  return true;
}

/**
 * Copy package-owned files, retaining nested layouts needed by CLI launchers.
 * @param {string} modules
 * @param {string} output
 * @param {string[]} names
 * @returns {Promise<string[]>}
 */
export async function copyExternalClosure(modules, output, names) {
  const copied = new Set();
  async function visit(folder) {
    if (copied.has(folder)) return;
    const metadata = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
    if (!supportsWindows(metadata)) return;
    const alreadyCopied = [...copied].some((parent) => folder.startsWith(parent + path.sep));
    copied.add(folder);
    const relative = path.relative(modules, folder);
    if (relative.startsWith('..')) throw new Error('External package escaped dependency input');
    const destination = path.join(output, 'node_modules', relative);
    const filter = (source) => {
      const file = slash(path.relative(folder, source));
      if (metadata.name === '@huggingface/transformers') {
        return (
          !file ||
          ['dist', 'dist/transformers.node.mjs', 'package.json'].includes(file) ||
          /^(?:license|notice|copying)(?:[._-]|$)/iu.test(file)
        );
      }
      if (metadata.name === 'pdfjs-dist' && /^legacy\/(?:web|image_decoders)(?:\/|$)/u.test(file))
        return false;
      if (metadata.name === 'npm' && /^(?:docs|man)(?:\/|$)/u.test(file)) return false;
      if (metadata.name === 'onnxruntime-node') {
        if (/^bin\/napi-v6\/(?:linux|darwin|win32\/arm64)(?:\/|$)/u.test(file)) return false;
        if (
          file &&
          !/^(?:dist|bin)(?:\/|$)/u.test(file) &&
          file !== 'package.json' &&
          !/^(?:licen[cs]e|notice|copying)(?:[._-]|$)/iu.test(file)
        )
          return false;
      }
      return true;
    };
    if (!alreadyCopied) {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(folder, destination, { recursive: true, filter });
    }
    const required = Object.keys(metadata.dependencies ?? {});
    const optional = Object.keys(metadata.optionalDependencies ?? {});
    for (const name of new Set([...required, ...optional])) {
      // The existing Node-only transformer path never loads the browser backend.
      if (name === 'onnxruntime-web') continue;
      // These two helpers belong to onnxruntime-node's postinstall downloader;
      // its runtime dist imports only onnxruntime-common and the native binding.
      if (metadata.name === 'onnxruntime-node' && ['adm-zip', 'global-agent'].includes(name))
        continue;
      const dependency = await findPackage(name, folder);
      if (!dependency) {
        if (optional.includes(name)) continue;
        throw new Error(`Missing external dependency ${metadata.name} -> ${name}`);
      }
      await visit(dependency);
    }
  }
  for (const name of names) {
    const directory = path.join(modules, name);
    await visit(directory);
  }
  return [...copied].map((folder) => slash(path.relative(modules, folder)));
}

function inputPackages(inputs, root) {
  const directories = new Set();
  for (const input of Object.keys(inputs)) {
    const pieces = path.resolve(root, input).split(path.sep);
    const index = pieces.lastIndexOf('node_modules');
    if (index < 0) continue;
    const length = pieces[index + 1].startsWith('@') ? index + 3 : index + 2;
    directories.add(pieces.slice(0, length).join(path.sep));
  }
  return [...directories];
}

async function preserveLicenses(directories, modules, output) {
  for (const directory of directories) {
    const relative = path.relative(modules, directory);
    if (relative.startsWith('..')) throw new Error('License package escaped dependency input');
    const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    for (const file of await readdir(directory)) {
      if (
        /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/iu.test(file) ||
        (metadata.name.startsWith('@img/sharp-') && file === 'README.md')
      )
        await copyFile(
          path.join(directory, file),
          path.join(output, 'node_modules', relative, file),
        );
    }
  }
}

/**
 * Stage path-preserving application entries and bundled pure JS dependencies.
 * @param {{root:string,modules:string,output:string,build:Function}} options
 * @returns {Promise<{entries:number,external:string[],outputs:number,packages:string[]}>}
 */
export async function bundleRuntime({ root, modules, output, build }) {
  const application = path.join(root, 'app');
  const sources = (await filesIn(application)).filter((file) => !testingFile(file));
  const entries = {};
  for (const file of sources) {
    const relative = slash(path.relative(root, file));
    if (file.endsWith('.js') && !/^app\/(?:ui|shared)\//u.test(relative))
      entries[relative.slice(0, -3)] = file;
    else await copyFile(file, path.join(output, relative));
  }
  const pi = path.join(modules, '@earendil-works/pi-ai');
  const bedrockLazy = path.join(pi, 'dist/api/bedrock-converse-stream.lazy.js');
  const bedrockSpecifier = '@earendil-works/pi-ai/api/bedrock-converse-stream.lazy';
  for (const name of ['lazy', 'bedrock-converse-stream']) {
    entries[`node_modules/@earendil-works/pi-ai/dist/api/${name}`] = path.join(
      pi,
      `dist/api/${name}.js`,
    );
  }
  await copyFile(
    bedrockLazy,
    path.join(
      output,
      'node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.lazy.js',
    ),
  );
  for (const file of await filesIn(pi)) {
    if (!/\.(?:js|map|ts)$/u.test(file))
      await copyFile(
        file,
        path.join(output, 'node_modules/@earendil-works/pi-ai', path.relative(pi, file)),
      );
  }
  const trash = path.join(modules, 'trash');
  for (const file of await filesIn(trash)) {
    const relative = `node_modules/trash/${slash(path.relative(trash, file))}`;
    if (file.endsWith('.js')) entries[relative.slice(0, -3)] = file;
    else if (!/\.(?:map|ts)$/u.test(file)) await copyFile(file, path.join(output, relative));
  }
  const result = await build({
    entryPoints: entries,
    absWorkingDir: root,
    nodePaths: [modules],
    preserveSymlinks: true,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outdir: output,
    chunkNames: 'runtime/chunks/[name]-[hash]',
    metafile: true,
    sourcemap: false,
    banner: {
      js: "import { createRequire as __scienceCreateRequire } from 'node:module'; const require = __scienceCreateRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'retain-module-positions',
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, async (args) => {
            if (args.kind === 'entry-point') return;
            const relative = args.path.startsWith('.');
            const importer = path.resolve(args.importer);
            if (
              relative &&
              (importer.startsWith(application + path.sep) || importer.startsWith(trash + path.sep))
            )
              return { path: args.path, external: true };
            if (relative && path.resolve(path.dirname(importer), args.path) === bedrockLazy)
              return { path: bedrockSpecifier, external: true };
            if (!relative && externalImports.has(packageName(args.path)))
              return { path: args.path, external: true };
            return undefined;
          });
        },
      },
    ],
  });
  const reader = await build({
    entryPoints: [path.join(application, 'ui/readers/vendor.js')],
    nodePaths: [modules],
    preserveSymlinks: true,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    metafile: true,
    outfile: path.join(output, 'app/ui/readers/vendor.js'),
  });
  const external = await copyExternalClosure(modules, output, externalPackages);
  const browser = await copyBrowserAssets(modules, output);
  const packages = [
    ...new Set([
      ...inputPackages(result.metafile.inputs, root),
      ...inputPackages(reader.metafile.inputs, root),
      ...external.map((relative) => path.join(modules, relative)),
      ...browser,
      pi,
      trash,
    ]),
  ];
  await preserveLicenses(packages, modules, output);
  await writeFile(
    path.join(output, 'package.json'),
    await readFile(path.join(root, 'package.json')),
  );
  return {
    entries: Object.keys(entries).length,
    external,
    packages,
    outputs: Object.keys(result.metafile.outputs).length,
  };
}
