import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { withCore } from '../../testing.js';
import { createAppServer } from '../../server/server.js';
import { readDocx } from '../desk/docx/read.js';
import { indexMedia } from '../desk/media.js';
import { createVersions } from './index.js';
import { createVersionMedia } from './media.js';

const svg = (color) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="${color}"/></svg>`,
  );
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kX9sAAAAASUVORK5CYII=',
  'base64',
);

async function docx(color, extra = false) {
  const zip = new JSZip();
  const picture = (id) => `<w:p><w:r><w:drawing><a:blip r:embed="${id}"/></w:drawing></w:r></w:p>`;
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${picture('vector')}${picture('picture')}${extra ? picture('extra') : ''}</w:body></w:document>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      ['vector.svg', 'picture.png', ...(extra ? ['extra.svg'] : [])]
        .map(
          (name) =>
            `<Relationship Id="${name.split('.')[0]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
        )
        .join('') +
      '</Relationships>',
  );
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="svg" ContentType="image/svg+xml"/><Default Extension="png" ContentType="image/png"/></Types>',
  );
  zip.file('word/media/vector.svg', svg(color));
  zip.file('word/media/picture.png', png);
  if (extra) zip.file('word/media/extra.svg', svg('green'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('version media HTTP reads each version by diff refs including zero and returns clear failures after cached originals are cleaned', () =>
  withCore('version-media-http', async (core) => {
    const versions = createVersions(core);
    const server = createAppServer({ core, versions, token: 'version-media-test' });
    try {
      const project = await core.projects.create({ name: '图片版本' });
      const imported = await versions.importFiles({
        projectId: project.id,
        files: [
          { name: 'old.docx', base64: (await docx('red')).toString('base64') },
          { name: 'new.docx', base64: (await docx('blue', true)).toString('base64') },
        ],
      });
      await versions.diffIdle();
      const [oldVersion, newVersion] = imported.versions;
      const url = await server.listen();
      const headers = { authorization: 'Bearer version-media-test' };
      const diffResponse = await fetch(`${url}/api/versions/${newVersion.id}/diff`, { headers });
      assert.equal(diffResponse.status, 200);
      const diff = await diffResponse.json();
      const images = (value) =>
        value.blocks.flatMap((block) => block.inlines).filter((inline) => inline.atom === 'image');
      const oldImages = images(diff.old);
      const newImages = images(diff.new);
      const request = (id, ref) => fetch(`${url}/api/versions/${id}/media/${ref}`, { headers });
      for (const [version, refs, color] of [
        [oldVersion, oldImages, 'red'],
        [newVersion, newImages, 'blue'],
      ]) {
        const response = await request(version.id, refs[0].ref);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('content-type'), 'image/svg+xml');
        assert.equal(response.headers.get('content-length'), String(svg(color).length));
        assert.equal(
          response.headers.get('content-security-policy'),
          "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        );
        assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), svg(color));
        const raster = await request(version.id, refs[1].ref);
        assert.equal(raster.headers.get('content-type'), 'image/png');
        assert.deepEqual(Buffer.from(await raster.arrayBuffer()), png);
      }
      assert.deepEqual(
        Buffer.from(await (await request(oldVersion.id, 0)).arrayBuffer()),
        svg('red'),
      );
      const missing = await request(oldVersion.id, newImages.at(-1).ref);
      assert.equal(missing.status, 404);
      assert.equal((await missing.json()).code, 'VERSION_MEDIA_NOT_FOUND');
      const unknown = await request('missing-version', 0);
      assert.equal(unknown.status, 404);
      assert.equal((await unknown.json()).code, 'VERSION_NOT_FOUND');
      const text = await versions.importFiles({
        projectId: project.id,
        files: [{ name: 'plain.md', base64: Buffer.from('# Text').toString('base64') }],
      });
      const unsupported = await request(text.versions[0].id, 0);
      assert.equal(unsupported.status, 400);
      assert.equal((await unsupported.json()).code, 'VERSION_MEDIA_FORMAT');
      await unlink(versions.file(oldVersion.id));
      const cleaned = await request(oldVersion.id, 0);
      assert.equal(cleaned.status, 404);
      assert.equal((await cleaned.json()).code, 'VERSION_MEDIA_FILE_NOT_FOUND');
    } finally {
      await versions.close();
      await server.close();
    }
  }));

test('version media reuses concurrent package loads, evicts least-recently read packages and notices replaced files', () =>
  withCore('version-media-cache', async (core) => {
    const versions = createVersions(core, {
      diffs: {
        compute: async () => ({
          old: { blocks: [] },
          new: { blocks: [] },
          diff: { status: 'unchanged' },
        }),
      },
    });
    try {
      const project = await core.projects.create({ name: '缓存版本' });
      const bytes = await docx('red');
      const imported = await versions.importFiles({
        projectId: project.id,
        files: Array.from({ length: 5 }, (_, index) => ({
          name: index + '.docx',
          base64: bytes.toString('base64'),
        })),
      });
      await versions.diffIdle();
      let loads = 0;
      const media = createVersionMedia(core, {
        load: async (file) => {
          loads++;
          const document = await readDocx(await readFile(file));
          document.media = await indexMedia(document);
          return document;
        },
      });
      const ids = imported.versions.map((version) => version.id);
      const concurrent = await Promise.all(Array.from({ length: 6 }, () => media(ids[0], 0)));
      assert.ok(concurrent.every((item) => item.bytes.equals(svg('red'))));
      assert.equal(loads, 1);
      for (const id of ids.slice(1, 4)) await media(id, 0);
      await media(ids[0], 0);
      await media(ids[4], 0);
      assert.equal(loads, 5);
      await media(ids[0], 0);
      assert.equal(loads, 5);
      await media(ids[1], 0);
      assert.equal(loads, 6);
      await writeFile(versions.file(ids[1]), await docx('blue-replacement'));
      assert.deepEqual((await media(ids[1], 0)).bytes, svg('blue-replacement'));
      assert.equal(loads, 7);
      await unlink(versions.file(ids[1]));
      await assert.rejects(media(ids[1], 0), { code: 'VERSION_MEDIA_FILE_NOT_FOUND' });
    } finally {
      await versions.close();
    }
  }));
