import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFHexString, PDFName, PDFNull, StandardFonts } from 'pdf-lib';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

/** A two-page paper: a title and a paragraph, then a paragraph on page two. */
async function paper() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const write = (page, lines, top) =>
    lines.forEach((line, index) =>
      page.drawText(line, { x: 72, y: top - index * 15, size: 11, font }),
    );
  const first = pdf.addPage([595, 842]);
  first.drawText('Set-Theoretic Methods', { x: 72, y: 720, size: 18, font: bold });
  write(
    first,
    [
      'Consistency assesses the degree to which the cases sharing a combination',
      'agree in displaying the outcome. When consistency is low, there is little',
      'point in assessing coverage, since the set relation is not supported.',
    ],
    680,
  );
  const second = pdf.addPage([595, 842]);
  write(
    second,
    [
      'Coverage gauges empirical relevance. Raw coverage should be distinguished',
      'from unique coverage when several paths lead to the same outcome.',
    ],
    720,
  );
  return pdf.save();
}

const shoot = async (desk, name) => {
  const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
  if (folder) await desk.screenshot({ path: path.join(folder, `${name}.png`) });
};

/** Select `words` inside the text-layer line that holds them; returns their middle. */
const selectWords = (desk, words) =>
  desk.evaluate((wanted) => {
    const span = [...document.querySelectorAll('.ss-desk-pdf .textLayer span')].find(
      (node) => node.firstChild?.nodeType === 3 && node.textContent.includes(wanted),
    );
    const text = /** @type {Text} */ (span.firstChild);
    const start = text.data.indexOf(wanted);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + wanted.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, words);

test(
  'a PDF takes comments, indexes and quotes on its words without changing',
  { skip: browserSkip },
  () =>
    withBrowserApp('u6-pdf', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      const bytes = await paper();
      await mkdir(path.join(root, 'data'), { recursive: true });
      await writeFile(path.join(root, 'ragin.pdf'), bytes);
      await writeFile(path.join(root, 'data', 'cities.csv'), 'city,score\nA,0.8\n');
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=ragin.pdf`);
      const layer = desk.locator('.ss-desk-pdf .page[data-page-number="1"] .textLayer');
      await layer.locator('span', { hasText: 'little' }).waitFor();
      const ribbon = desk.locator('.ss-ribbon__bar');
      const comment = ribbon.getByRole('button', { name: '批注', exact: true });
      await desk.waitForFunction(
        () =>
          !document
            .querySelector('.ss-ribbon__bar')
            ?.querySelector('button[data-tip="给选中的文字加批注"]')
            ?.hasAttribute('disabled'),
      );

      // A comment from the ribbon on selected words.
      await selectWords(desk, 'there is little');
      await comment.click();
      await desk.getByRole('textbox', { name: '批注内容' }).fill('阈值要说明来源');
      await desk.keyboard.press('Control+Enter');
      const cards = desk.locator('.ss-desk-notes .ss-desk-card:not(.ss-desk-card--new)');
      await cards.filter({ hasText: '阈值要说明来源' }).waitFor();
      const marks = desk.locator('.ss-pdf-mark');
      await marks.and(desk.locator('[data-type="comment"]')).first().waitFor();
      assert.match(await desk.locator('.ss-desk-notes .ss-prov').textContent(), /不写进 PDF/u);

      // An index from the right-click menu; the menu has no rewriting.
      const middle = await selectWords(desk, 'set relation');
      await desk.mouse.click(middle.x, middle.y, { button: 'right' });
      const menu = desk.getByRole('menu', { name: '文字' });
      await menu.getByRole('menuitem', { name: /添加索引/u }).waitFor();
      assert.equal(await menu.getByRole('menuitem', { name: /改写/u }).count(), 0);
      await shoot(desk, 'u6-pdf-menu');
      await menu.getByRole('menuitem', { name: /添加索引/u }).click();
      const picker = desk.getByRole('dialog', { name: '添加索引' });
      await picker.getByRole('button', { name: 'data' }).click();
      await picker.getByRole('option', { name: 'cities.csv' }).click();
      await picker.getByRole('textbox', { name: '说明' }).fill('案例来自城市数据');
      await picker.getByRole('button', { name: '添加索引' }).click();
      await cards.filter({ hasText: '案例来自城市数据' }).waitFor();
      await marks.and(desk.locator('[data-type="index"]')).first().waitFor();

      // A double-click selects a word: the floating toolbar has marks and quoting only.
      const word = await desk.evaluate(() => {
        const span = [...document.querySelectorAll('.ss-desk-pdf .textLayer span')].find((node) =>
          node.textContent.includes('outcome. When'),
        );
        const text = /** @type {Text} */ (span.firstChild);
        const start = text.data.indexOf('outcome');
        const range = document.createRange();
        range.setStart(text, start + 1);
        range.setEnd(text, start + 2);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      });
      await desk.mouse.dblclick(word.x, word.y);
      const toolbar = desk.locator('.ss-desk-ftb');
      await toolbar.waitFor();
      assert.equal(await toolbar.getByRole('textbox', { name: '改写指令' }).count(), 0);
      assert.equal(await toolbar.getByRole('button', { name: '加粗' }).count(), 0);
      await shoot(desk, 'u6-pdf-toolbar');
      await toolbar.getByRole('button', { name: /引用到对话/u }).click();
      // The quote lands in the desk's own chat tab.
      await desk.locator('.ss-desk-chat [data-desk-quote]').waitFor();
      const meeting = app.core.meetings.list({ projectId: project.id })[0];
      const draft = await app.researchInput.draft(meeting.id);
      assert.equal(draft.marks.length, 1);
      assert.match(JSON.stringify(draft.marks[0]), /outcome/u);

      // A click on marked words lights up their card.
      await desk.getByRole('tab', { name: '批注与索引' }).click();
      await desk.mouse.click(middle.x, middle.y);
      await cards
        .filter({ hasText: '案例来自城市数据' })
        .and(desk.locator('[data-active]'))
        .waitFor();
      await shoot(desk, 'u6-pdf-notes');

      // A comment on page two: 定位 turns back to it from page one.
      await desk
        .locator('.ss-desk-pdf .page[data-page-number="2"] .textLayer span')
        .first()
        .waitFor();
      await selectWords(desk, 'unique coverage');
      await comment.click();
      await desk.getByRole('textbox', { name: '批注内容' }).fill('第二页的批注');
      await desk.keyboard.press('Control+Enter');
      const later = cards.filter({ hasText: '第二页的批注' });
      await later.waitFor();
      await desk.locator('.reader-pdf-scroll').evaluate((node) => {
        node.scrollTop = 0;
      });
      await later.getByRole('button', { name: '定位' }).click();
      await desk.waitForFunction(() => {
        const mark = document.querySelector('.page[data-page-number="2"] .ss-pdf-mark');
        const view = document.querySelector('.reader-pdf-scroll')?.getBoundingClientRect();
        const rect = mark?.getBoundingClientRect();
        return !!rect && !!view && rect.top >= view.top && rect.bottom <= view.bottom;
      });

      // Closing asks nothing; the PDF is byte for byte as it was, and the marks come back.
      await desk.getByRole('button', { name: '关闭 ragin.pdf' }).click();
      await desk.locator('.ss-doctab').waitFor({ state: 'detached' });
      assert.equal(await desk.getByRole('dialog').count(), 0);
      assert.deepEqual(new Uint8Array(await readFile(path.join(root, 'ragin.pdf'))), bytes);
      await desk.locator('.ss-desk-file', { hasText: 'ragin.pdf' }).click();
      await desk.locator('.ss-pdf-mark[data-type="comment"]').first().waitFor();
      assert.equal(await cards.count(), 3);
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

/** Bookmarks pointing at pages, nested one level under the first. @param {PDFDocument} pdf */
function bookmark(pdf, entries) {
  const context = pdf.context;
  const top = context.nextRef();
  const add = (parent, items) => {
    const refs = items.map(() => context.nextRef());
    items.forEach((item, index) => {
      const fields = {
        Title: PDFHexString.fromText(item.title),
        Parent: parent,
        Dest: [pdf.getPage(item.page - 1).ref, 'XYZ', PDFNull, PDFNull, PDFNull],
      };
      if (index) fields.Prev = refs[index - 1];
      if (index < items.length - 1) fields.Next = refs[index + 1];
      if (item.items) Object.assign(fields, add(refs[index], item.items));
      context.assign(refs[index], context.obj(fields));
    });
    return { First: refs[0], Last: refs.at(-1), Count: items.length };
  };
  context.assign(top, context.obj({ Type: 'Outlines', ...add(top, entries) }));
  pdf.catalog.set(PDFName.of('Outlines'), top);
}

test(
  'a PDF with bookmarks lists them as its outline, follows the page and jumps to them',
  { skip: browserSkip },
  () =>
    withBrowserApp('u6-pdf-outline', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      const pdf = await PDFDocument.load(await paper());
      bookmark(pdf, [
        { title: '1 Consistency', page: 1, items: [{ title: '1.1 Low consistency', page: 1 }] },
        { title: '2 Coverage', page: 2 },
      ]);
      await writeFile(path.join(root, 'ragin.pdf'), await pdf.save());
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=ragin.pdf`);
      const outline = desk.locator('.ss-desk-nav__outline .ss-outline button');
      await outline.filter({ hasText: '2 Coverage' }).waitFor();
      assert.deepEqual(await outline.allTextContents(), [
        '1 Consistency',
        '1.1 Low consistency',
        '2 Coverage',
      ]);
      assert.equal(
        await outline.filter({ hasText: '1.1 Low consistency' }).getAttribute('style'),
        '--lv: 1;',
      );
      await outline.filter({ hasText: '2 Coverage' }).click();
      await desk.locator('.ss-ribbon__page', { hasText: '2 / 2' }).waitFor();
      await desk
        .locator('.ss-desk-nav__outline button[aria-current="true"]', { hasText: '2 Coverage' })
        .waitFor();
      await shoot(desk, 'u6-pdf-outline');
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
