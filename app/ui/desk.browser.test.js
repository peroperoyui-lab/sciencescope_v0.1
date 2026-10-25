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
const thesis = (extra = '') => docx(thesisBody(extra));

/** @param {string} body document.xml body */
async function docx(body) {
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
  zip.file('word/document.xml', `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** @param {string} extra */
function thesisBody(extra) {
  return [
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

test(
  'two versions compare side by side, step through changes and scroll together until unlocked',
  { skip: browserSkip },
  () =>
    withBrowserApp('u3-desk-compare', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(root, { recursive: true });
      const filler = (from, count, word) =>
        Array.from({ length: count }, (_, index) =>
          para(`第 ${from + index} 段${word}：校准与稳健性检验的补充说明，篇幅足够让页面滚动。`),
        ).join('');
      const first = thesisBody('') + filler(1, 60, '');
      await writeFile(path.join(root, 'thesis.docx'), await docx(first));
      const group = await app.desk.registerDocument({ projectId: project.id, path: 'thesis.docx' });
      // v2: a number changed, a paragraph removed, words made bold, a block of paragraphs added.
      const second = first
        .replace('2010–2022', '2010–2024')
        .replace(para('经济韧性指数采用熵权法合成，涵盖抵抗力、恢复力与再组织能力三个维度。'), '')
        .replace(
          para(
            '一致性阈值设为 0.85，案例频数阈值设为 2；校准锚点分别取各条件的第 95、50、5 百分位。',
          ),
          '<w:p><w:r><w:t>一致性阈值设为 0.85，</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>案例频数阈值设为 2</w:t></w:r><w:r><w:t>；校准锚点分别取各条件的第 95、50、5 百分位。</w:t></w:r></w:p>' +
            filler(100, 25, '（新增）'),
        );
      await app.versions.importFiles(
        {
          projectId: project.id,
          groupId: group.id,
          files: [{ name: 'thesis.docx', base64: (await docx(second)).toString('base64') }],
        },
        { actorId: 'person_user' },
      );
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(
        `${base}?token=ui-token&surface=desk&projectId=${project.id}&path=thesis.docx`,
      );
      await desk.locator('.ss-page--edit h1', { hasText: '第三章' }).waitFor();
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
      await compare.locator('.ss-cmp__col').first().waitFor();
      const [left, right] = [
        compare.locator('.ss-cmp__col').first(),
        compare.locator('.ss-cmp__col').last(),
      ];
      assert.match(await left.locator('.ss-cmp__label').textContent(), /旧 · v1/u);
      assert.match(await right.locator('.ss-cmp__label').textContent(), /新 · v2/u);
      assert.match(
        await left
          .locator('.ss-diff-del')
          .allTextContents()
          .then((v) => v.join('')),
        /2022/u,
      );
      assert.match(
        await right
          .locator('.ss-rev-ins')
          .allTextContents()
          .then((v) => v.join('')),
        /2024/u,
      );
      assert.equal(await right.locator('.ss-diff-gap').getAttribute('data-tip'), '这里删了一段');
      assert.equal(
        await right.locator('strong.ss-diff-fmt, .ss-diff-fmt strong').first().textContent(),
        '案例频数阈值设为 2',
      );
      // F7 steps to the first change and marks it on both pages.
      await desk.keyboard.press('F7');
      assert.match(await compare.locator('.ss-cmp__pos').textContent(), /^1 \/ \d+$/u);
      assert.ok((await left.locator('.ss-diff-cur').count()) > 0);
      assert.ok((await right.locator('.ss-diff-cur').count()) > 0);
      const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
      if (folder) await desk.screenshot({ path: path.join(folder, 'u3-desk-compare.png') });

      // Locked: scrolling the right page moves the left one; unlocked it stays.
      const scrollTo = (column, top) =>
        column.evaluate((node, value) => {
          node.scrollTop = value;
        }, top);
      const topOf = (column) => column.evaluate((node) => node.scrollTop);
      await scrollTo(left, 0);
      // Let the left page's own scroll event settle first, or it pulls the right page back.
      await desk.waitForTimeout(300);
      await scrollTo(right, 900);
      await desk.waitForFunction(() => document.querySelector('.ss-cmp__col').scrollTop > 200);
      // The right page has 25 paragraphs the left one lacks; the left page waits while they pass.
      const added = await right
        .locator('p', { hasText: '第 100 段' })
        .evaluate(
          (node) =>
            node.getBoundingClientRect().top -
            node.closest('.ss-cmp__col').getBoundingClientRect().top +
            node.closest('.ss-cmp__col').scrollTop,
        );
      await scrollTo(right, added - 200);
      await desk.waitForTimeout(100);
      const before = await topOf(left);
      await scrollTo(right, added + 400);
      await desk.waitForTimeout(100);
      const held = await topOf(left);
      assert.ok(held - before < 100, `left page moved ${held - before}px`);
      await compare.getByRole('button', { name: '解锁，两页各自滚动' }).click();
      await scrollTo(right, 0);
      await desk.waitForTimeout(100);
      assert.equal(await topOf(left), held);
      await compare.getByRole('button', { name: '锁定，两页同步滚动' }).waitFor();

      // Swap: v2 on the left, so the pages say only their versions.
      await compare.getByRole('button', { name: '交换两侧' }).click();
      await desk.locator('[data-compare="ready"] .ss-cmp__label').first().waitFor();
      assert.match(await desk.locator('.ss-cmp__label').first().textContent(), /^v2 · /u);
      await desk.getByRole('button', { name: '退出比较' }).click();
      await desk.locator('.ss-page--edit h1', { hasText: '第三章' }).waitFor();
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

test(
  'a selection is rewritten by the expert, shown, undone, quoted to the chat and found again from it',
  { skip: browserSkip },
  () =>
    withBrowserApp(
      'u4-desk-assist',
      async function* ({ call, input, instructions }) {
        const key = /manuscript="([^"]+)"/u.exec(input)?.[1];
        // Only the main expert answers the request; the secretary's minutes leave it.
        if (!key || instructions.includes('你是项目的任务秘书')) {
          yield '好的。';
          return;
        }
        const read = await call('workspace_read', { target: 'manuscript', key });
        const block = read.blocks.find((entry) => entry.text.includes('98 个地级市'));
        await call('workspace_edit', {
          resource: 'manuscript',
          key,
          op: 'replace',
          args: { block: block.id, find: '98 个地级市', with: '98 个城市' },
        });
        yield '把「地级市」改成了「城市」。';
      },
      async ({ page, app }) => {
        const project = await app.core.projects.create({ name: '城市韧性研究' });
        const root = path.join(app.core.paths.projects, project.dirName);
        await mkdir(root, { recursive: true });
        await writeFile(path.join(root, 'thesis.docx'), await thesis());
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              features: { editingDesk: true },
              models: { default: { provider: 'test', model: 'test' } },
            },
          },
        });
        const desk = await page.context().newPage();
        const errors = [];
        desk.on('pageerror', (error) => errors.push(error.message));
        const base = page.url().split('?')[0];
        await desk.goto(
          `${base}?token=ui-token&surface=desk&projectId=${project.id}&path=thesis.docx`,
        );
        const body = desk.locator('.ss-page--edit');
        const sample = body.locator('p', { hasText: '研究样本为' });
        await sample.waitFor();

        // Select the start of a paragraph: the floating toolbar comes up above it.
        await sample.click();
        await desk.keyboard.press('Home');
        for (let index = 0; index < 12; index++) await desk.keyboard.press('Shift+ArrowRight');
        const toolbar = desk.locator('.ss-desk-ftb');
        await toolbar.waitFor();
        assert.equal(await toolbar.getByRole('button', { name: '润色' }).count(), 1);
        const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
        if (folder) await desk.screenshot({ path: path.join(folder, 'u4-desk-toolbar.png') });

        // Rewrite: with no chat bound yet the project gets one; the edit lands in the page.
        await toolbar.getByRole('textbox', { name: '改写指令' }).fill('语气缓和些');
        await desk.keyboard.press('Enter');
        const note = desk.locator('.ss-desk-note[data-note="edit"]');
        await note.waitFor({ timeout: 20000 });
        assert.match(await note.textContent(), /主专家改写了「3\.2\u3000样本与数据」1 段/u);
        await sample.filter({ hasText: '98 个城市' }).waitFor();
        if (folder) await desk.screenshot({ path: path.join(folder, 'u4-desk-note.png') });

        await note.getByRole('button', { name: '看改了什么' }).click();
        const changes = desk.getByRole('dialog', { name: '改了什么' });
        await desk.waitForTimeout(300);
        assert.equal(await changes.locator('.ss-rev-ins').first().textContent(), '城市');
        assert.equal(await changes.locator('.ss-diff-del').first().textContent(), '地级市');
        if (folder) await desk.screenshot({ path: path.join(folder, 'u4-desk-changes.png') });
        await changes.getByRole('button', { name: '关闭' }).last().click();
        await note.getByRole('button', { name: '撤销' }).click();
        await sample.filter({ hasText: '98 个地级市' }).waitFor();
        await desk.locator('.ss-desk-note').waitFor({ state: 'detached' });

        // Right-click menu: rewrite, quote, comments and indexes are there.
        await sample.click({ button: 'right' });
        const menu = desk.getByRole('menu', { name: '文字' });
        await menu.getByRole('menuitem', { name: /这句的修改记录/u }).waitFor();
        assert.equal(
          await menu.getByRole('menuitem', { name: /添加批注/u }).getAttribute('aria-disabled'),
          null,
        );
        if (folder) await desk.screenshot({ path: path.join(folder, 'u4-desk-menu.png') });
        await menu.getByRole('menuitem', { name: /引用到对话/u }).click();
        await desk.getByText('已引用到对话，回到主窗口的对话里可以接着问').waitFor();
        const meeting = app.core.meetings.list({ projectId: project.id })[0];
        const draft = await app.researchInput.draft(meeting.id);
        assert.equal(draft.marks.length, 1);
        assert.equal(draft.marks[0].reference.kind, 'version');

        // The rewrite request in the chat carries the sentence; clicking it shows it on the desk.
        await page.evaluate((id) => {
          location.hash = '#/meeting/' + id;
        }, meeting.id);
        const chip = page.locator('[data-desk-mark]').first();
        await chip.waitFor();
        const popup = page.waitForEvent('popup').catch(() => null);
        await chip.click();
        await desk.locator('.ss-desk-flash').first().waitFor();
        await (await popup)?.close();
        if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
      },
    ),
);

test(
  'comments and indexes are added from a selection, follow the text and come back on undo',
  { skip: browserSkip },
  () =>
    withBrowserApp('u5-desk-notes', silent, async ({ page, app }) => {
      const { readFile } = await import('node:fs/promises');
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(path.join(root, 'data'), { recursive: true });
      const thesisFile = path.join(root, 'thesis.docx');
      await writeFile(thesisFile, await thesis());
      await writeFile(path.join(root, 'data', 'cities.csv'), 'city,year\n');
      await app.core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { features: { editingDesk: true } } },
      });
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(
        `${base}?token=ui-token&surface=desk&projectId=${project.id}&path=thesis.docx`,
      );
      const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
      const body = desk.locator('.ss-page--edit');
      const ribbon = desk.locator('.ss-ribbon');
      const cards = desk.locator('.ss-desk-notes .ss-desk-card:not(.ss-desk-card--new)');
      const sample = body.locator('p', { hasText: '研究样本为' });
      await sample.waitFor();
      await desk.locator('.ss-statusbar').getByText('已写回项目文件').waitFor();
      /** Select the first `count` characters of a paragraph (again if the page was still settling). */
      const selectStart = async (paragraph, count) => {
        for (let attempt = 0; attempt < 3; attempt++) {
          await paragraph.click({ position: { x: 4, y: 6 } });
          await desk.keyboard.press('Home');
          for (let index = 0; index < count; index++) await desk.keyboard.press('Shift+ArrowRight');
          await desk.waitForTimeout(100);
          if ((await desk.evaluate(() => String(getSelection()))).length === count) return;
        }
        throw new Error('Could not select the start of the paragraph');
      };

      // A comment from the ribbon: the panel opens on a new card for the selected words.
      await selectStart(sample, 5);
      await ribbon.getByRole('button', { name: '批注', exact: true }).click();
      const content = desk.getByRole('textbox', { name: '批注内容' });
      await content.fill('样本口径要和第二章一致');
      await desk.getByRole('button', { name: '添加', exact: true }).click();
      await cards.filter({ hasText: '样本口径要和第二章一致' }).waitFor();
      await body.locator('.ss-cmt', { hasText: '研究样本为' }).waitFor();

      // An index from the right-click menu, pointing at a data file.
      const threshold = body.locator('p', { hasText: '案例频数阈值' });
      await selectStart(threshold, 5);
      // Right-click on the selected words.
      const box = await desk.evaluate(() => {
        const rect = getSelection().getRangeAt(0).getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await desk.mouse.click(box.x, box.y, { button: 'right' });
      await desk
        .getByRole('menu', { name: '文字' })
        .getByRole('menuitem', { name: /添加索引/u })
        .click();
      const picker = desk.getByRole('dialog', { name: '添加索引' });
      await picker.getByRole('button', { name: 'data' }).click();
      await picker.getByRole('option', { name: 'cities.csv' }).click();
      await picker.getByRole('textbox', { name: '说明' }).fill('阈值来自敏感性分析');
      if (folder) await desk.screenshot({ path: path.join(folder, 'u5-desk-picker.png') });
      await picker.getByRole('button', { name: '添加索引' }).click();
      const index = cards.filter({ hasText: '阈值来自敏感性分析' });
      await index.getByRole('button', { name: 'data/cities.csv' }).waitFor();
      await body.locator('.ss-bind', { hasText: '一致性阈值' }).waitFor();
      assert.equal(await cards.count(), 2);
      assert.equal(await desk.locator('.ss-desk-panel .ss-tab__count').textContent(), '2');
      if (folder) await desk.screenshot({ path: path.join(folder, 'u5-desk-notes.png') });

      // The type filter shows one kind.
      await desk.getByRole('group', { name: '类型' }).getByRole('button', { name: '索引' }).click();
      assert.equal(await cards.count(), 1);
      await desk.getByRole('group', { name: '类型' }).getByRole('button', { name: '全部' }).click();

      // Deleting all the marked words takes the index; undo brings both back.
      await selectStart(threshold, 5);
      await desk.keyboard.press('Backspace');
      await desk.getByText('删掉的文字带走了 1 条索引').waitFor();
      await index.waitFor({ state: 'detached' });
      await desk.locator('.ss-toast').getByRole('button', { name: '撤销' }).click();
      await body.locator('.ss-bind', { hasText: '一致性阈值' }).waitFor();
      // The card comes back once the server has the restored words.
      await index.waitFor();

      // Saved: the comment goes into Word; the index stays in ScienceScope.
      await desk.keyboard.press('Control+s');
      await desk.locator('.ss-statusbar').getByText('已写回项目文件').waitFor();
      const zip = await JSZip.loadAsync(await readFile(thesisFile));
      assert.match(await zip.file('word/comments.xml').async('string'), /样本口径要和第二章一致/u);
      assert.match(await zip.file('word/document.xml').async('string'), /commentRangeStart/u);

      // Deleting a card removes its mark.
      await index.getByRole('button', { name: '删除' }).click();
      await body.locator('.ss-bind').waitFor({ state: 'detached' });
      assert.equal(await cards.count(), 1);
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

test(
  'a Markdown comment gets a reply, is resolved and returns with its words on undo',
  { skip: browserSkip },
  () =>
    withBrowserApp('u5-desk-notes-md', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(root, { recursive: true });
      await writeFile(
        path.join(root, 'notes.md'),
        '# 札记\n\n城市韧性的测度仍有争议。\n\n第二段文字。\n',
      );
      await app.core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { features: { editingDesk: true } } },
      });
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=notes.md`);
      const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
      const source = desk.locator('.ss-desk-source .cm-content');
      const line = source.getByText('城市韧性的测度仍有争议。');
      await line.waitFor();
      await desk.locator('.ss-statusbar').getByText('已写回项目文件').waitFor();
      const card = desk.locator('.ss-desk-notes .ss-desk-card:not(.ss-desk-card--new)');

      // From the floating toolbar.
      await line.click();
      await desk.keyboard.press('Home');
      for (let index = 0; index < 4; index++) await desk.keyboard.press('Shift+ArrowRight');
      await desk.locator('.ss-desk-ftb').getByRole('button', { name: '添加批注' }).click();
      await desk.getByRole('textbox', { name: '批注内容' }).fill('先说明用的哪种测度');
      await desk.keyboard.press('Control+Enter');
      await card.waitFor();
      await source.locator('.ss-cmt', { hasText: '城市韧性' }).waitFor();

      // Reply, then resolve: the mark goes quiet but the card stays.
      await card.getByRole('button', { name: '回复' }).click();
      await card.getByRole('textbox', { name: '回复' }).fill('用熵权法合成的指数');
      await card.getByRole('button', { name: '回复' }).click();
      await card.locator('.ss-desk-reply', { hasText: '用熵权法合成的指数' }).waitFor();
      await card.getByRole('button', { name: '标为已解决' }).click();
      await card.locator('.ss-tag', { hasText: '已解决' }).waitFor();
      await source.locator('.ss-cmt').waitFor({ state: 'detached' });
      if (folder) await desk.screenshot({ path: path.join(folder, 'u5-desk-notes-md.png') });
      await card.getByRole('button', { name: '重新打开' }).click();
      await source.locator('.ss-cmt', { hasText: '城市韧性' }).waitFor();

      // 定位 selects the words; deleting them takes the comment, Ctrl+Z brings it back.
      await card.getByRole('button', { name: '定位' }).click();
      await desk.waitForFunction(() => String(getSelection()) === '城市韧性');
      await desk.keyboard.press('Backspace');
      await desk.getByText('删掉的文字带走了 1 条批注').waitFor();
      await card.waitFor({ state: 'detached' });
      await desk.keyboard.press('Control+z');
      await card.locator('.ss-desk-reply', { hasText: '用熵权法合成的指数' }).waitFor();
      await source.locator('.ss-cmt', { hasText: '城市韧性' }).waitFor();
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
