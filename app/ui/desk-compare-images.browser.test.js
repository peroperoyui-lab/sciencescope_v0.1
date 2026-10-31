import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kX9sAAAAASUVORK5CYII=',
  'base64',
);

/** A Word file with a picture under a paragraph. @param {string} text */
async function docx(text) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="pic" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/figure.png"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip r:embed="pic"/></w:drawing></w:r></w:p></w:body></w:document>`,
  );
  zip.file('word/media/figure.png', png);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test(
  'comparing two Word versions shows each version’s pictures',
  { skip: browserSkip, timeout: 60000 },
  () =>
    withBrowserApp('desk-compare-images', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await writeFile(path.join(root, 'figure.docx'), await docx('图 1 显示了样本分布。'));
      const group = await app.desk.registerDocument({ projectId: project.id, path: 'figure.docx' });
      await app.versions.importFiles(
        {
          projectId: project.id,
          groupId: group.id,
          files: [
            {
              name: 'figure.docx',
              base64: (await docx('图 1 显示了 2024 年的样本分布。')).toString('base64'),
            },
          ],
        },
        { actorId: 'person_user' },
      );
      const desk = await page.context().newPage();
      const asked = [];
      desk.on('request', (request) => asked.push(new URL(request.url()).pathname));
      const base = page.url().split('?')[0];
      await desk.goto(
        `${base}?token=ui-token&surface=desk&projectId=${project.id}&path=figure.docx`,
      );
      await desk.locator('.ss-page--edit p', { hasText: '样本分布' }).waitFor();
      await desk.getByRole('tab', { name: '审阅' }).click();
      const start = desk.getByRole('button', { name: '比较', exact: true });
      await desk.waitForFunction(
        () =>
          !(
            /** @type {HTMLButtonElement | null} */ (
              document.querySelector('.ss-ribbon__bar button[data-tip*="两个版本"]')
            )?.disabled
          ),
      );
      await start.click();
      const compare = desk.locator('[data-compare="ready"]');
      for (const column of [
        compare.locator('.ss-cmp__col').first(),
        compare.locator('.ss-cmp__col').last(),
      ])
        await column.locator('.ss-atom--image img').waitFor();
      assert.equal(
        asked.filter((route) => /^\/api\/versions\/[^/]+\/media\//u.test(route)).length,
        2,
      );
    }),
);
