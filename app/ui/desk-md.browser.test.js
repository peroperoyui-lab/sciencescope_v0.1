import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

const NOTES = [
  '# 研究札记',
  '',
  '城市韧性的 __测度__ 仍有争议，见 [综述](https://example.org/review)。',
  '',
  '* 第一条',
  '* 第二条',
  '',
  '经济韧性指数 $CI_i = \\sum_j w_j x_{ij}$ 由熵权法合成。',
  '',
  '| 指标 | 权重 |',
  '|---|---|',
  '| 就业 | 0.4 |',
  '',
  '![示意图](figs/chart.png)',
  '',
].join('\n');
// A small bar chart.
const CHART = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAALQAAABgCAIAAAA7AM9cAAABKklEQVR42u3cuw2AIBSGUQZlAIdwDmt2tCFWDiANxke4nOSr/5jLqU1H3aVmyQkEh+AQHIJDcAgOwSE4BIe6yutyIzjggAMOOASH4BAccMABBxxwwAEHHHDAAQcccMx5aDgcGg444IADDjh8Mxy+GQ444IADDjjggAMOOJ7/5u+vAQcccMABBxxwwAEHHHDAAQcccMABBxxwwAEHHHC8gSPSOVwDDjjggAMOOOCAAw444IADDjjggAMOOOCIfw7LcFiGwzIcluGwDIdlODwhHA4Nh0PDAQcccFiGwzIcluGwDIdlOCzD4Qnh8IRwODQccMABBxxwWIbDMhyW4bAMh2U4PCEcnhAOh4bDoeG4VsqmwA38B2P9GxyCQ3AIDsEhOASH4BAcgkPzdgI1WOyJaBti8QAAAABJRU5ErkJggg==',
  'base64',
);

const shoot = async (desk, name) => {
  const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
  if (folder) await desk.screenshot({ path: path.join(folder, `${name}.png`) });
};

/** Select `count` characters from the start of the first text in `selector`'s element with `text`. */
const selectIn = (desk, selector, text, count) =>
  desk.evaluate(
    (wanted) => {
      const element = [...document.querySelectorAll(wanted.selector)].find(
        (node) => node.textContent === wanted.text,
      );
      const range = document.createRange();
      range.setStart(element.firstChild, 0);
      range.setEnd(element.firstChild, wanted.count);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    { selector, text, count },
  );

test(
  'Markdown is edited on its page; only the changed blocks are written back',
  { skip: browserSkip },
  () =>
    withBrowserApp('u6-md', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await mkdir(path.join(root, 'figs'), { recursive: true });
      await writeFile(path.join(root, 'notes.md'), NOTES);
      await writeFile(path.join(root, 'figs', 'chart.png'), CHART);
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=notes.md`);
      const pageView = desk.locator('.ss-page--md');
      const status = desk.locator('.ss-statusbar');
      await pageView.locator('h1', { hasText: '研究札记' }).waitFor();
      await status.getByText('已写回项目文件').waitFor();
      assert.equal(
        await desk.getByRole('button', { name: '渲染', exact: true }).getAttribute('aria-pressed'),
        'true',
      );
      // Formulas, tables and pictures are shown as they look.
      await pageView.locator('.ss-eqbox--inline .katex').waitFor();
      await pageView.locator('.ss-md-raw td', { hasText: '就业' }).waitFor();
      await pageView.locator('.ss-md-img img').waitFor();
      await shoot(desk, 'u6-md-page');

      // Bold with Ctrl+B, then typing at the end of the paragraph.
      // A click at the start of the line; keys wait until the page has taken the click.
      await pageView.locator('p', { hasText: '城市韧性' }).click({ position: { x: 1, y: 8 } });
      await status.getByText('第 3 行，第 1 列').waitFor();
      await desk.keyboard.press('Shift+ArrowRight');
      await desk.keyboard.press('Shift+ArrowRight');
      await status.getByText('第 3 行，第 3 列').waitFor();
      await desk.keyboard.press('Control+b');
      await pageView.locator('p strong', { hasText: '城市' }).waitFor();
      assert.equal(
        await desk
          .locator('.ss-ribbon__bar')
          .getByRole('button', { name: '加粗' })
          .getAttribute('aria-pressed'),
        'true',
      );
      await desk.keyboard.press('End');
      await desk.keyboard.type('补一句。');
      await pageView.locator('p', { hasText: '。补一句。' }).waitFor();
      await status.getByText('有修改未写回').waitFor();
      await status.getByText('第 3 行，第 62 列').waitFor();

      // Undo and redo go through the source's history.
      await desk.keyboard.press('Control+z');
      await desk.waitForFunction(
        () => !document.querySelector('.ss-page--md p:nth-of-type(1)').textContent.includes('补'),
      );
      await desk.keyboard.press('Control+y');
      await pageView.locator('p', { hasText: '。补一句。' }).waitFor();

      // Enter in a list item starts the next item.
      await pageView.locator('li', { hasText: '第二条' }).click();
      await status.getByText('第 6 行，第 6 列').waitFor();
      await desk.keyboard.press('End');
      await desk.keyboard.press('Enter');
      await desk.keyboard.type('第三条');
      await pageView.locator('li', { hasText: '第三条' }).waitFor();

      // A click on a formula edits it.
      await pageView.locator('.ss-eqbox--inline').click();
      const editor = desk.getByRole('dialog', { name: '编辑公式' });
      const field = editor.locator('math-field');
      await field.waitFor();
      await shoot(desk, 'u6-md-formula');
      await field.click();
      await desk.keyboard.press('End');
      await desk.keyboard.type('+1');
      await editor.locator('.ss-mathedit__src', { hasText: '+1' }).waitFor();
      await editor.getByRole('button', { name: '应用' }).click();
      assert.equal(await editor.count(), 0);

      // A comment made on the page marks the same words in the source.
      await selectIn(desk, '.ss-page--md strong', '测度', 2);
      await desk.getByRole('button', { name: '批注' }).first().click();
      await desk.getByRole('textbox', { name: '批注内容' }).fill('先说明用的哪种测度');
      await desk.keyboard.press('Control+Enter');
      await desk.locator('.ss-desk-notes .ss-desk-card:not(.ss-desk-card--new)').waitFor();
      await pageView.locator('.ss-cmt', { hasText: '测度' }).waitFor();

      await desk.keyboard.press('Control+s');
      await status.getByText('已写回项目文件').waitFor();
      const saved = await readFile(path.join(root, 'notes.md'), 'utf8');
      // The edited blocks changed; the rest is byte for byte as it was.
      assert.equal(
        saved.replace(/\$CI_\{?i[^$]*\+1\$/u, '$F$'),
        NOTES.replace(
          '城市韧性的 __测度__ 仍有争议，见 [综述](https://example.org/review)。',
          '**城市**韧性的 __测度__ 仍有争议，见 [综述](https://example.org/review)。补一句。',
        )
          .replace('* 第二条', '* 第二条\n* 第三条')
          .replace('$CI_i = \\sum_j w_j x_{ij}$', '$F$'),
      );

      await desk.getByRole('button', { name: '源码', exact: true }).click();
      const source = desk.locator('.ss-desk-source .cm-content');
      await source.locator('.ss-cmt', { hasText: '测度' }).waitFor();
      await shoot(desk, 'u6-md-source');
      // Typed in the source, shown on the page when it comes back.
      await source.locator('.cm-line', { hasText: '第三条' }).click();
      await desk.keyboard.press('End');
      await desk.keyboard.press('Enter');
      await desk.keyboard.type('* 第四条');
      await desk.getByRole('button', { name: '渲染', exact: true }).click();
      await pageView.locator('li', { hasText: '第四条' }).waitFor();
      await pageView.locator('.ss-cmt', { hasText: '测度' }).waitFor();
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

test(
  'a CRLF file with a BOM keeps its line breaks, task boxes and list spacing',
  { skip: browserSkip },
  () =>
    withBrowserApp('u6-md-crlf', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      const lines = [
        '# 待办',
        '',
        '- [ ] 核对样本',
        '- [ ] 复核权重',
        '',
        '- 第一条',
        '- 第二条',
        '',
      ];
      await writeFile(path.join(root, 'todo.md'), `\ufeff${lines.join('\r\n')}`);
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=todo.md`);
      const pageView = desk.locator('.ss-page--md');
      const status = desk.locator('.ss-statusbar');
      await pageView.locator('li', { hasText: '核对样本' }).waitFor();
      await status.getByText('已写回项目文件').waitFor();

      // Tick the first task (its box hangs left of the item), then add an item after the last one.
      const box = await pageView.locator('li.ss-md-task', { hasText: '核对样本' }).boundingBox();
      await desk.mouse.click(box.x - 14, box.y + 13);
      await pageView.locator('li.ss-md-task[data-checked="true"]').waitFor();
      await pageView.locator('li', { hasText: '第二条' }).click();
      await status.getByText('第 7 行，第 6 列').waitFor();
      await desk.keyboard.press('End');
      await desk.keyboard.press('Enter');
      await desk.keyboard.type('第三条');
      await pageView.locator('li', { hasText: '第三条' }).waitFor();
      await desk.keyboard.press('Control+s');
      await status.getByText('已写回项目文件').waitFor();

      const saved = await readFile(path.join(root, 'todo.md'), 'utf8');
      const expected = [...lines];
      expected[2] = '- [x] 核对样本';
      expected.splice(7, 0, '- 第三条');
      assert.equal(saved, `\ufeff${expected.join('\r\n')}`);
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
