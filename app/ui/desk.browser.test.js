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

/** A small Word file mammoth reads with real headings. @param {string} [extra] a last paragraph */
async function thesis(extra = '') {
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
    ...(extra ? [para(extra)] : []),
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
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes('/api/settings') && response.request().method() === 'PATCH',
      );
      await page.getByRole('switch', { name: '编辑台', exact: true }).check();
      await saved;
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
      await desk.locator('.ss-page--edit h1', { hasText: '第三章' }).waitFor();
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
      // Opening registers the file as a version group and starts a desk session.
      await desk.locator('.ss-statusbar').getByText('v1 · 主线').waitFor();
      await desk.locator('.ss-statusbar').getByText('已写回项目文件').waitFor();
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
      // Markdown opens as source; the rendered view is a read-only preview.
      await desk.locator('.ss-desk-source .cm-content', { hasText: '论文提纲' }).waitFor();
      assert.equal(await desk.locator('.ss-doctab').count(), 3);
      await desk.getByRole('tab', { name: '视图' }).click();
      await desk.getByRole('button', { name: '渲染', exact: true }).click();
      await desk.locator('.ss-page--md h1', { hasText: '论文提纲' }).waitFor();
      await desk.locator('.ss-statusbar').getByText('只读').waitFor();
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

/** The Word text of a project file, paragraph by paragraph. */
async function paragraphsOf(file) {
  const { readFile } = await import('node:fs/promises');
  const xml = await (
    await JSZip.loadAsync(await readFile(file))
  )
    .file('word/document.xml')
    .async('string');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/gu)].map((match) => ({
    text: [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/gu)].map((part) => part[1]).join(''),
    bold: match[0].includes('<w:b/>'),
  }));
}

test(
  'a person edits a docx and a Markdown file on the desk and writes them back',
  { skip: browserSkip },
  () =>
    withBrowserApp('u2-desk', silent, async ({ page, app }) => {
      const { readFile } = await import('node:fs/promises');
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(root, { recursive: true });
      const thesisFile = path.join(root, 'thesis.docx');
      await writeFile(thesisFile, await thesis());
      // A Windows file: BOM and CRLF stay as they are.
      await writeFile(path.join(root, 'notes.md'), '\uFEFF# 札记\r\n\r\n第一条。\r\n');
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(
        `${base}?token=ui-token&surface=desk&projectId=${project.id}&path=thesis.docx`,
      );
      const body = desk.locator('.ss-page--edit');
      const status = desk.locator('.ss-statusbar');
      await body.locator('h1', { hasText: '第三章' }).waitFor();

      // Type at the end of a paragraph: synced to the session, not yet written back.
      const method = body.locator('p', { hasText: '经济韧性指数' });
      await method.click();
      await desk.keyboard.press('End');
      await desk.keyboard.type('权重见附表。');
      await status.getByText('有修改未写回').waitFor();
      // Enter splits the paragraph; Ctrl+B makes the new text bold.
      await desk.keyboard.press('Enter');
      await desk.keyboard.press('Control+b');
      await desk.keyboard.type('新的一段');
      await desk
        .getByRole('button', { name: '加粗' })
        .and(desk.locator('[aria-pressed="true"]'))
        .waitFor();
      await desk.keyboard.press('Control+s');
      await status.getByText('已写回项目文件').waitFor();
      let paragraphs = await paragraphsOf(thesisFile);
      assert.ok(paragraphs.some((entry) => entry.text.endsWith('三个维度。权重见附表。')));
      assert.deepEqual(
        paragraphs.find((entry) => entry.text === '新的一段'),
        { text: '新的一段', bold: true },
      );
      assert.equal(paragraphs.length, 9);

      // Undo from the ribbon; the session follows and Save writes it back.
      // Quick typing is one undo step, so undo until the new paragraph is gone.
      const undo = desk.getByRole('button', { name: '撤销' });
      while ((await body.textContent()).includes('新的一段')) await undo.click();
      await desk.keyboard.press('Control+s');
      await status.getByText('已写回项目文件').waitFor();
      paragraphs = await paragraphsOf(thesisFile);
      assert.equal(paragraphs.length, 8);
      assert.ok(!paragraphs.some((entry) => entry.text.includes('新的一段')));

      // Changed outside while there are unsaved edits: keep mine as a branch, then write back.
      await method.click();
      await desk.keyboard.press('End');
      await desk.keyboard.type('另附说明。');
      await status.getByText('有修改未写回').waitFor();
      const outside = await thesis('另一台电脑上加的一段。');
      await writeFile(thesisFile, outside);
      await desk.keyboard.press('Control+s');
      const external = desk.getByRole('dialog', { name: 'thesis.docx 在编辑台外被改过' });
      await external.getByRole('button', { name: '保留我的修改另存为分支' }).click();
      await desk.getByText(/已另存为 v\d+，项目文件保持外部版本/).waitFor();
      assert.deepEqual(await readFile(thesisFile), outside);
      await desk.keyboard.press('Control+s');
      await desk
        .getByRole('dialog', { name: '写回项目文件？' })
        .getByRole('button', { name: '写回', exact: true })
        .click();
      await status.getByText('已写回项目文件').waitFor();
      paragraphs = await paragraphsOf(thesisFile);
      assert.ok(paragraphs.some((entry) => entry.text.endsWith('另附说明。')));
      const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
      if (folder) await desk.screenshot({ path: path.join(folder, 'u2-desk-docx.png') });

      // Markdown source: edits keep the BOM and CRLF line endings.
      await page
        .evaluate(
          async ({ id, bridge }) =>
            (await import(bridge)).openDesk({ projectId: id, path: 'notes.md' }),
          { id: project.id, bridge: '/desk-window.js' },
        )
        .catch(() => {});
      await desk.evaluate(
        ({ id }) => {
          const channel = new BroadcastChannel('sciencescope-desk');
          channel.postMessage({ type: 'open', projectId: id, path: 'notes.md' });
          channel.close();
        },
        { id: project.id },
      );
      const source = desk.locator('.ss-desk-source .cm-content');
      await source.getByText('第一条。').waitFor();
      await source.getByText('第一条。').click();
      await desk.keyboard.press('End');
      await desk.keyboard.press('Enter');
      await desk.keyboard.type('第二条。');
      await desk.keyboard.press('Control+s');
      await status.getByText('已写回项目文件').waitFor();
      assert.equal(
        await readFile(path.join(root, 'notes.md'), 'utf8'),
        '\uFEFF# 札记\r\n\r\n第一条。\r\n第二条。\r\n',
      );

      // Closing a tab with unsaved edits asks; not writing back keeps them as a version.
      await desk.keyboard.type('未写回');
      await status.getByText('有修改未写回').waitFor();
      await desk.getByRole('button', { name: '关闭 notes.md' }).click();
      await desk
        .getByRole('dialog', { name: '写回 notes.md？' })
        .getByRole('button', { name: '不写回' })
        .click();
      await desk.getByText(/这次的修改已留作 v\d+/).waitFor();
      assert.equal(await desk.locator('.ss-doctab').count(), 1);
      assert.ok(!(await readFile(path.join(root, 'notes.md'), 'utf8')).includes('未写回'));
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

/** A Word file with a table, a bookmark, a tab and a hyperlink. */
async function objects() {
  const zip = await JSZip.loadAsync(await thesis());
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const cell = (value) => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      '<w:p><w:r><w:t xml:space="preserve">表前 </w:t></w:r><w:bookmarkStart w:id="1" w:name="mark"/>' +
      '<w:r><w:t>书签后</w:t></w:r><w:bookmarkEnd w:id="1"/><w:r><w:tab/><w:t>制表后</w:t></w:r></w:p>' +
      `<w:tbl><w:tr>${cell('甲')}${cell('乙')}</w:tr><w:tr>${cell('丙')}${cell('丁')}</w:tr></w:tbl>` +
      '<w:p><w:r><w:t>表后</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

test(
  'tables keep their cells and bookmarks survive text deleted around them',
  { skip: browserSkip },
  () =>
    withBrowserApp('u2-desk-objects', silent, async ({ page, app }) => {
      const { readFile } = await import('node:fs/promises');
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(root, { recursive: true });
      const file = path.join(root, 'objects.docx');
      await writeFile(file, await objects());
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      await desk.goto(
        `${page.url().split('?')[0]}?token=ui-token&surface=desk&projectId=${project.id}&path=objects.docx`,
      );
      const body = desk.locator('.ss-page--edit');
      await body.locator('td').first().waitFor();
      assert.equal(await body.locator('tr').count(), 2);
      assert.equal(await body.locator('td').count(), 4);

      // Type in a cell; Backspace at a cell's start does not merge cells.
      await body.locator('td', { hasText: '乙' }).click();
      await desk.keyboard.press('End');
      await desk.keyboard.type('二');
      await desk.keyboard.press('Home');
      await desk.keyboard.press('Backspace');
      await desk.keyboard.press('Backspace');
      assert.equal(await body.locator('td').count(), 4);
      // Select the bookmarked words and type over them.
      const first = body.locator('p').first();
      await first.click();
      await desk.keyboard.press('Home');
      await desk.keyboard.press('Shift+End');
      await desk.keyboard.type('整段改写');
      await desk.keyboard.press('Control+s');
      await desk.locator('.ss-statusbar').getByText('已写回项目文件').waitFor();
      const xml = await (
        await JSZip.loadAsync(await readFile(file))
      )
        .file('word/document.xml')
        .async('string');
      assert.match(xml, /<w:t[^>]*>乙二<\/w:t>/u);
      assert.match(xml, /整段改写/u);
      assert.match(xml, /<w:bookmarkStart w:id="1" w:name="mark"\/><w:bookmarkEnd w:id="1"\/>/u);
      assert.equal(xml.match(/<w:tc>/gu)?.length, 4);
      const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
      if (folder) await desk.screenshot({ path: path.join(folder, 'u2-desk-table.png') });
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
