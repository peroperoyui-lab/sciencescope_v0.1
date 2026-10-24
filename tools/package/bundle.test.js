import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { bundleRuntime } from './bundle.js';

const execute = promisify(execFile);

async function put(root, name, value) {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, value);
}

async function fixture(root) {
  await put(root, 'package.json', JSON.stringify({ type: 'module' }));
  const metadata = { version: '1', main: 'index.js', type: 'module' };
  const names = [
    'npm',
    'esbuild',
    'pdfjs-dist',
    'sqlite-vec',
    'onnxruntime-node',
    'onnxruntime-common',
    '@napi-rs/canvas',
    '@huggingface/transformers',
    'trash',
    'ordinary',
    'eslint',
    'typescript',
    'playwright-core',
    '@earendil-works/pi-ai',
  ];
  for (const name of names) {
    const prefix = `node_modules/${name}`;
    await put(root, `${prefix}/package.json`, JSON.stringify({ ...metadata, name }));
    await put(root, `${prefix}/index.js`, 'export const value = 21;');
    await put(root, `${prefix}/LICENSE`, 'Original license');
  }
  await put(
    root,
    'node_modules/@huggingface/transformers/dist/transformers.node.mjs',
    'export const tokenizer = true;',
  );
  await put(
    root,
    'node_modules/@earendil-works/pi-ai/package.json',
    JSON.stringify({
      ...metadata,
      name: '@earendil-works/pi-ai',
      exports: { '.': './index.js', './api/*': './dist/api/*.js' },
    }),
  );
  await put(
    root,
    'node_modules/@earendil-works/pi-ai/index.js',
    'export {bedrock} from "./dist/api/bedrock-converse-stream.lazy.js";',
  );
  await put(
    root,
    'node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.lazy.js',
    'export const bedrock = () => import("./bedrock-converse-stream.js");',
  );
  await put(
    root,
    'node_modules/@earendil-works/pi-ai/dist/api/bedrock-converse-stream.js',
    'export const model = "bedrock-preserved";',
  );
  await put(
    root,
    'node_modules/@earendil-works/pi-ai/dist/api/lazy.js',
    'export const lazy = true;',
  );
  await put(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', 'export const pdf = true;');
  await put(root, 'node_modules/pdfjs-dist/legacy/web/pdf_viewer.mjs', 'duplicate');
  await put(root, 'node_modules/pdfjs-dist/cmaps/fixture.bcmap', 'cmap bytes');
  await put(root, 'node_modules/npm/docs/unused.html', 'docs');
  await put(root, 'node_modules/npm/bin/npm-cli.js', 'console.log("npm retained");');
  await put(root, 'node_modules/@napi-rs/canvas/fixture.node', 'native bytes');
  const browser = {
    preact: ['dist/preact.mjs', 'hooks/dist/hooks.mjs'],
    htm: ['dist/htm.mjs'],
    marked: ['lib/marked.esm.js'],
    dompurify: ['dist/purify.es.mjs'],
    cytoscape: ['dist/cytoscape.esm.min.mjs'],
    katex: ['dist/katex.mjs'],
    '@fontsource-variable/noto-sans-sc': ['index.css', 'files/fixture.woff2'],
  };
  for (const [name, files] of Object.entries(browser)) {
    await put(root, `node_modules/${name}/package.json`, JSON.stringify({ ...metadata, name }));
    for (const file of files) await put(root, `node_modules/${name}/${file}`, 'asset bytes');
  }
  await put(root, 'app/ui/index.html', '<main>fixture</main>');
  await put(root, 'app/ui/readers/vendor.js', 'export const reader = 42;');
  await put(root, 'app/asset.json', '{"value":"original asset"}');
  await put(root, 'app/helper.js', 'export const location = import.meta.url;');
  await put(root, 'app/shared/journal.js', 'export const shared = 42;');
  await put(
    root,
    'app/worker.js',
    'import {parentPort} from "node:worker_threads"; import {value} from "ordinary"; parentPort.postMessage(value * 2);',
  );
  await put(root, 'app/testing.js', 'throw new Error("must not ship");');
  await put(root, 'app/hidden.test.js', 'throw new Error("must not ship");');
  await put(
    root,
    'app/main.js',
    `
    import {readFile} from 'node:fs/promises';
    import {Worker} from 'node:worker_threads';
    import {bedrock} from '@earendil-works/pi-ai';
    import {location} from './helper.js';
    const asset = JSON.parse(await readFile(new URL('./asset.json', import.meta.url), 'utf8'));
    const worker = new Worker(new URL('./worker.js', import.meta.url));
    const reply = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
    console.log(JSON.stringify({asset, location, reply, model:(await bedrock()).model}));
  `,
  );
}

test('packaged entries preserve module and worker resource paths without development payload', async () => {
  const parent = path.resolve('.sciencescope-local/temp/r6c/bundle');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, 'case-'));
  const root = path.join(directory, 'source');
  const output = path.join(directory, 'installed');
  try {
    await fixture(root);
    const result = await bundleRuntime({
      root,
      modules: path.join(root, 'node_modules'),
      output,
      build,
    });
    assert.ok(result.entries >= 5);
    const { stdout } = await execute(process.execPath, [path.join(output, 'app/main.js')], {
      cwd: directory,
    });
    const value = JSON.parse(stdout.trim());
    assert.equal(value.reply, 42);
    assert.equal(value.model, 'bedrock-preserved');
    assert.equal(value.asset.value, 'original asset');
    assert.equal(
      await readFile(path.join(output, 'app/shared/journal.js'), 'utf8'),
      'export const shared = 42;',
    );
    assert.equal(value.location, pathToFileURL(path.join(output, 'app/helper.js')).href);
    assert.equal(
      await readFile(path.join(output, 'node_modules/@napi-rs/canvas/fixture.node'), 'utf8'),
      'native bytes',
    );
    assert.equal(
      await readFile(path.join(output, 'node_modules/pdfjs-dist/cmaps/fixture.bcmap'), 'utf8'),
      'cmap bytes',
    );
    assert.match(
      await readFile(path.join(output, 'node_modules/npm/bin/npm-cli.js'), 'utf8'),
      /npm retained/u,
    );
    for (const name of ['eslint', 'typescript', 'playwright-core'])
      assert.equal(
        await access(path.join(output, 'node_modules', name)).then(
          () => true,
          () => false,
        ),
        false,
      );
    for (const name of ['testing.js', 'hidden.test.js'])
      assert.equal(
        await access(path.join(output, 'app', name)).then(
          () => true,
          () => false,
        ),
        false,
      );
    assert.equal(
      await access(path.join(output, 'node_modules/pdfjs-dist/legacy/web/pdf_viewer.mjs')).then(
        () => true,
        () => false,
      ),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
