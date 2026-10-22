import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const heading = (level, text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading${level}"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const para = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** A small Word file mammoth reads with real headings. */
async function thesis() {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  );
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="${W}">${[1, 2]
      .map(
        (n) =>
          `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`,
      )
      .join('')}</w:styles>`,
  );
  const body = [
    heading(1, '第三章　研究设计'),
    heading(2, '3.1　研究方法'),
    para(
      '本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态，并以面板回归检验结论的稳健性。与传统回归关注单一变量的净效应不同，组态视角关注多个条件如何共同导致结果。',
    ),
    para('经济韧性指数采用熵权法合成，涵盖抵抗力、恢复力与再组织能力三个维度。'),
    heading(2, '3.2　样本与数据'),
    para(
      '研究样本为 98 个地级市，时间跨度为 2010–2022 年，数据主要来自统计年鉴和各市统计公报，缺失值用线性插值补齐。',
    ),
    heading(2, '3.3　稳健性检验'),
    para('一致性阈值设为 0.85，案例频数阈值设为 2；校准锚点分别取各条件的第 95、50、5 百分位。'),
  ].join('');
  zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test(
  'the editing desk stays hidden until switched on, then opens documents in its own window',
  { skip: browserSkip },
  () =>
    withBrowserApp('u1-desk', silent, async ({ page, app, shot }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(path.join(root, 'chapters'), { recursive: true });
      await mkdir(path.join(root, 'notes'), { recursive: true });
      await writeFile(path.join(root, 'thesis.docx'), await thesis());
      await writeFile(
        path.join(root, 'chapters', 'method.tex'),
        '\\section{研究方法}\n本章采用 fsQCA。\n\\subsection{指标合成}\n$CI_i = \\sum_j w_j x_{ij}$\n',
      );
      await writeFile(
        path.join(root, 'outline.md'),
        '# 论文提纲\n\n## 研究问题\n\n- 韧性如何测度\n',
      );
      await writeFile(path.join(root, 'data.csv'), 'a,b\n1,2\n');

      // Off by default: no entry in the sidebar, the workstation keeps its versions.
      await page.evaluate((id) => {
        location.hash = '#/workbench/' + id;
      }, project.id);
      await page.locator('.wb-left').waitFor();
      assert.equal(
        await page.locator('.ss-sidebar').getByText('编辑台', { exact: true }).count(),
        0,
      );
      assert.equal(await page.getByRole('button', { name: '在编辑台打开' }).count(), 0);

      await page.evaluate(() => {
        location.hash = '#/settings/general';
      });
      await page.getByLabel('编辑台（试用）', { exact: true }).selectOption('true');
      await page.getByRole('button', { name: '保存并应用' }).click();
      await page.getByText('已保存并应用。').waitFor();
      await page.evaluate((id) => {
        location.hash = '#/workbench/' + id;
      }, project.id);
      await page.getByRole('button', { name: '在编辑台打开' }).waitFor();
      assert.equal(await page.locator('.wb-left').count(), 0);
      await shot('u1-workbench');

      // The sidebar entry opens the desk window on the current project.
      const [desk] = await Promise.all([
        page.waitForEvent('popup'),
        page.locator('.ss-sidebar .ss-nav-item', { hasText: '编辑台' }).click(),
      ]);
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      await desk.locator('.ss-desk').waitFor();
      await desk.getByText('还没有打开文稿').waitFor();
      const files = desk.locator('.ss-desk-nav__list');
      await files.getByRole('button', { name: /thesis\.docx/ }).waitFor();
      // Only documents and folders are listed, not ScienceScope's own folders.
      assert.equal(await files.getByText('data.csv').count(), 0);
      assert.equal(await files.getByText('workbench', { exact: true }).count(), 0);

      await files.getByRole('button', { name: /thesis\.docx/ }).click();
      await desk.locator('.ss-page h1', { hasText: '第三章' }).waitFor();
      await desk.getByRole('tab', { name: /thesis\.docx/ }).waitFor();
      const outline = desk.locator('.ss-outline button');
      assert.deepEqual(await outline.allTextContents(), [
        '第三章　研究设计',
        '3.1　研究方法',
        '3.2　样本与数据',
        '3.3　稳健性检验',
      ]);
      await desk
        .locator('.ss-statusbar')
        .getByText(/\d+ 字/)
        .waitFor();
      await desk.locator('.ss-statusbar').getByText('还没有版本').waitFor();
      await outline.filter({ hasText: '3.3' }).click();
      const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
      if (folder) await desk.screenshot({ path: path.join(folder, 'u1-desk-docx.png') });

      // A folder expands in place; tex opens as source with its sections as the outline.
      await files.getByRole('button', { name: 'chapters' }).click();
      await files.getByRole('button', { name: /method\.tex/ }).click();
      await desk.locator('.ss-desk-source .cm-content').waitFor();
      assert.deepEqual(await outline.allTextContents(), ['研究方法', '指标合成']);
      await desk.getByRole('tab', { name: '视图' }).click();
      assert.equal(
        await desk.getByRole('button', { name: '渲染', exact: true }).isDisabled(),
        true,
      );

      // A second request from the main window adds a tab in the same desk.
      await page.evaluate(
        async ({ id, bridge }) =>
          (await import(bridge)).openDesk({ projectId: id, path: 'outline.md' }),
        { id: project.id, bridge: '/desk-window.js' },
      );
      await desk.locator('.ss-page--md h1', { hasText: '论文提纲' }).waitFor();
      assert.equal(await desk.locator('.ss-doctab').count(), 3);
      await desk.getByRole('button', { name: '源码', exact: true }).click();
      await desk.locator('.ss-desk-source .cm-content').waitFor();
      if (folder) await desk.screenshot({ path: path.join(folder, 'u1-desk-md-source.png') });

      // Closing a tab selects its neighbour; tabs come back when the desk opens again.
      await desk.getByRole('button', { name: '关闭 outline.md' }).click();
      await desk.locator('.ss-doctab[aria-selected="true"]', { hasText: 'method.tex' }).waitFor();
      await desk.reload();
      await desk.locator('.ss-doctab', { hasText: 'thesis.docx' }).waitFor();
      assert.equal(await desk.locator('.ss-doctab').count(), 2);
      await desk.getByRole('button', { name: '收起功能区' }).click();
      assert.equal(await desk.locator('.ss-ribbon__bar').count(), 0);
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
