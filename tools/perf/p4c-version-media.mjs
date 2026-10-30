// Synthetic DOCX only; no runtime, models, external documents or background jobs.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const paragraphs = 1200;
const reads = 20;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kX9sAAAAASUVORK5CYII=',
  'base64',
);
const median = (values) =>
  [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

async function fixture(revised) {
  const zip = new JSZip();
  const image = (id) => `<w:p><w:r><w:drawing><a:blip r:embed="${id}"/></w:drawing></w:r></w:p>`;
  const text = '公开合成研究材料记录文献方法和证据，比较区域发展中的制度与社会变化。'.repeat(2);
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${WORD}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${image('picture')}${Array.from({ length: paragraphs }, (_, index) => `<w:p><w:r><w:t>${index + 1} ${text}</w:t></w:r></w:p>`).join('')}${image('vector')}</w:body></w:document>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      ['picture.png', 'vector.svg']
        .map(
          (name) =>
            `<Relationship Id="${name.split('.')[0]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
        )
        .join('') +
      '</Relationships>',
  );
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="svg" ContentType="image/svg+xml"/></Types>',
  );
  zip.file('word/media/picture.png', revised ? Buffer.concat([png, Buffer.from('revised')]) : png);
  zip.file(
    'word/media/vector.svg',
    `<svg xmlns="http://www.w3.org/2000/svg"><text>${revised ? 'new' : 'old'}</text></svg>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function sample(read) {
  let bytes = 0;
  const started = performance.now();
  for (let index = 0; index < reads; index++) {
    const media = await read();
    assert.deepEqual(media.bytes, png);
    assert.equal(media.mimeType, 'image/png');
    bytes += media.bytes.length;
  }
  return { ms: performance.now() - started, reads, bytes };
}

function summarize(samples) {
  return { medianMs: median(samples.map((value) => value.ms)), samples };
}

export async function measureVersionMedia({
  fixtureRoot,
  phase,
  sourceRoot = fileURLToPath(new URL('../../', import.meta.url)),
}) {
  const fromSource = (file) => import(pathToFileURL(path.join(sourceRoot, file)).href);
  const [
    { createCore },
    { createAppServer },
    { createVersions },
    { readDocx },
    { indexMedia, readMedia },
  ] = await Promise.all([
    fromSource('app/core/index.js'),
    fromSource('app/server/server.js'),
    fromSource('app/services/versions/index.js'),
    fromSource('app/services/desk/docx/read.js'),
    fromSource('app/services/desk/media.js'),
  ]);
  const core = await createCore({ dataRoot: fixtureRoot });
  const versions = createVersions(core);
  let server;
  try {
    const project = await core.projects.create({ name: 'Synthetic version media benchmark' });
    const oldBytes = await fixture(false);
    const newBytes = await fixture(true);
    const imported = await versions.importFiles({
      projectId: project.id,
      files: [
        { name: 'old.docx', base64: oldBytes.toString('base64') },
        { name: 'new.docx', base64: newBytes.toString('base64') },
      ],
    });
    await versions.diffIdle();
    const [oldVersion, newVersion] = imported.versions;
    server = createAppServer({ core, versions, token: 'synthetic-media-perf' });
    const url = await server.listen();
    const headers = { authorization: 'Bearer synthetic-media-perf' };
    const response = await fetch(`${url}/api/versions/${newVersion.id}/diff`, { headers });
    assert.equal(response.status, 200);
    const diff = await response.json();
    const imageAtoms = (value) =>
      value.blocks
        .flatMap((block) => block.inlines ?? [])
        .filter((inline) => inline.atom === 'image')
        .map(({ atom, ref }) => ({ atom, ref }));
    const oldAtoms = imageAtoms(diff.old);
    const newAtoms = imageAtoms(diff.new);
    assert.equal(oldAtoms.length, 2);
    assert.ok(oldAtoms.every((atom) => Number.isInteger(atom.ref)));
    assert.deepEqual(newAtoms, oldAtoms);
    const mediaRef = oldAtoms[0].ref;
    const endpoint = await fetch(`${url}/api/versions/${oldVersion.id}/media/${mediaRef}`, {
      headers,
    });
    const endpointEvidence = { status: endpoint.status, ref: mediaRef };
    if (phase === 'before') {
      assert.equal(endpoint.status, 404);
      endpointEvidence.error = await endpoint.json();
    } else {
      assert.equal(endpoint.status, 200);
      assert.deepEqual(Buffer.from(await endpoint.arrayBuffer()), png);
    }
    const uncached = async () => {
      const document = await readDocx(await readFile(versions.file(oldVersion.id)));
      document.media = await indexMedia(document);
      return readMedia(document, mediaRef);
    };
    const cached = () => versions.media(oldVersion.id, mediaRef);
    await sample(uncached);
    if (phase === 'after') await sample(cached);
    const uncachedSamples = [];
    const cachedSamples = [];
    for (let run = 0; run < 3; run++) {
      uncachedSamples.push(await sample(uncached));
      if (phase === 'after') cachedSamples.push(await sample(cached));
    }
    return {
      schema: 1,
      kind: 'backend-version-media',
      phase,
      generatedAt: new Date().toISOString(),
      node: process.version,
      fixture: {
        synthetic: true,
        paragraphs,
        images: 2,
        versions: 2,
        oldDocxBytes: oldBytes.length,
        newDocxBytes: newBytes.length,
        imageBytes: png.length,
      },
      beforeEvidence: {
        endpoint: endpointEvidence,
        diffImageAtoms: { old: oldAtoms, new: newAtoms },
        refAlreadyPresent: true,
      },
      protocol: {
        warmups: 1,
        measuredRuns: 3,
        repeatedReadsPerRun: reads,
        path: 'Service bytes: uncached readFile + readDocx + indexMedia + readMedia versus versions.media warm cache',
        excludes: [
          'HTTP transport timing',
          'UI/WebView',
          'runtime',
          'models',
          'startup',
          'fixture seeding',
          'diff calculation',
        ],
      },
      uncached: summarize(uncachedSamples),
      cached:
        phase === 'after'
          ? summarize(cachedSamples)
          : { available: false, planned: 'Small version-package LRU with file stat on each read' },
    };
  } finally {
    if (server) await server.close();
    await versions.close();
    core.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      phase: { type: 'string', default: 'after' },
      source: { type: 'string' },
    },
  });
  if (!values.out || !['before', 'after'].includes(values.phase))
    throw new Error('Use --phase before|after --out <ignored receipt.json> [--source checkout].');
  const output = path.resolve(values.out);
  const allowed = fileURLToPath(
    new URL('../../.sciencescope-local/temp/p4c/part2b-media/', import.meta.url),
  );
  if (!output.startsWith(allowed))
    throw new Error('Receipts belong under .sciencescope-local/temp/p4c/part2b-media.');
  await mkdir(allowed, { recursive: true });
  const handle = await open(output, 'wx');
  try {
    const fixtureRoot = await mkdtemp(path.join(allowed, 'fixture-'));
    const result = await measureVersionMedia({
      fixtureRoot,
      phase: values.phase,
      sourceRoot: values.source,
    });
    await handle.writeFile(JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } catch (error) {
    await handle.writeFile(
      JSON.stringify({ phase: values.phase, failed: true, error: error.stack }, null, 2),
    );
    throw error;
  } finally {
    await handle.close();
  }
}
