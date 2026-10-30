import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import path from 'node:path';
import { createTexEngines } from '../services/desk/tex-engines.js';
import { fakeTex } from '../services/desk/tex-fixture.js';
import { tempDir } from '../testing.js';
import { browserSkip, typeAtEndOfMathField, withBrowserApp } from './browser-testing.js';

async function* silent() {}

// A chapter like the design system's PageDeskTex, then filler for scrolling.
const CHAPTER = [
  '\\section{研究设计}\\label{sec:design}',
  '',
  '本章采用模糊集定性比较分析（fsQCA）识别城市经济韧性的条件组态，',
  '并以面板回归检验结论的稳健性。',
  '',
  '\\subsection{指标合成}',
  '经济韧性指数采用熵权法合成，第 $i$ 个城市的综合得分为',
  '\\begin{equation}',
  '  CI_i = \\sum_{j=1}^{m} w_j \\, x_{ij}',
  '\\end{equation}',
  '其中 $w_j$ 由第 $j$ 项指标的信息熵 $e_j$ 确定。',
  '',
  '\\subsection{一致性与覆盖度}',
  '% 阈值依据 Ragin (2008) 的建议',
  '条件组合 $X$ 对结果 $Y$ 的一致性定义为',
  '\\begin{equation}\\label{eq:cons}',
  '  \\mathrm{Cons}(X \\le Y) = \\frac{\\sum_i \\min(x_i, y_i)}{\\sum_i x_i}',
  '\\end{equation}',
  '一致性阈值取 0.85，案例频数阈值取 2~\\cite{ragin2008}，见式~\\eqref{eq:cons}。',
  '',
  '\\begin{table}[h]',
  '  \\centering',
  '  \\caption{条件变量与校准锚点}\\label{tab:anchor}',
  '  \\begin{tabular}{lccc}',
  '    \\toprule',
  '    条件 & 完全隶属 & 交叉点 & 完全不隶属 \\\\',
  '    \\midrule',
  '    数字经济水平 & 0.82 & 0.41 & 0.12 \\\\',
  '    \\bottomrule',
  '  \\end{tabular}',
  '\\end{table}',
  '',
  ...Array.from({ length: 12 }, (_, index) => [
    `\\subsection{稳健性检验 ${index + 1}}`,
    '替换结果变量的测度方式后，组态结果基本一致，说明结论对指标选择不敏感。'.repeat(3),
    '',
  ]).flat(),
].join('\n');

/** Open chapters/method.tex (or a whole paper.tex) in the desk; `prepare` adds files first. */
async function openChapter(page, app, file = 'chapters/method.tex', prepare = undefined) {
  const project = await app.core.projects.create({ name: '城市韧性研究' });
  const root = path.join(app.core.paths.projects, project.dirName);
  await mkdir(path.join(root, 'chapters'), { recursive: true });
  await writeFile(path.join(root, 'chapters', 'method.tex'), CHAPTER);
  await writeFile(
    path.join(root, 'paper.tex'),
    `\\documentclass{ctexart}\n\\begin{document}\n${CHAPTER}\n\\end{document}\n`,
  );
  await writeFile(
    path.join(root, 'main.tex'),
    '\\documentclass{ctexart}\n\\begin{document}\n\\input{chapters/method}\n\\end{document}\n',
  );
  await prepare?.(root);
  const desk = await page.context().newPage();
  const errors = [];
  desk.on('pageerror', (error) => errors.push(error.message));
  const base = page.url().split('?')[0];
  await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=${file}`);
  await desk.locator('.ss-page--tex h2', { hasText: '研究设计' }).waitFor();
  return { desk, errors, root };
}

const shoot = async (desk, name) => {
  const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
  if (folder) await desk.screenshot({ path: path.join(folder, `${name}.png`) });
};

test(
  'TeX opens beside its live page; typing, views and scrolling keep the two together',
  { skip: browserSkip },
  async () => {
    const none = createTexEngines({ env: { PATH: '' }, miktexDirs: [], texliveRoots: [] });
    await withBrowserApp(
      'u6-tex',
      silent,
      async ({ page, app }) => {
        const { desk, errors } = await openChapter(page, app);
        const pageView = desk.locator('.ss-page--tex');
        const status = desk.locator('.ss-statusbar');
        assert.equal(
          await desk
            .getByRole('button', { name: '并排', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
        await status.getByText('渲染：内置，不需要装 TeX').waitFor();
        await status.getByText('第 1 行，第 1 列').waitFor();
        // Numbered like the page; the table's caption is in the outline too.
        const outline = desk.locator('.ss-outline button');
        assert.deepEqual((await outline.allTextContents()).slice(0, 4), [
          '1 研究设计',
          '1.1 指标合成',
          '1.2 一致性与覆盖度',
          '表 1 条件变量与校准锚点',
        ]);
        assert.match(await pageView.locator('.ss-page__eqno').nth(1).textContent(), /^\(2\)$/u);
        assert.match(
          await pageView.locator('p', { hasText: '一致性阈值' }).textContent(),
          /\[Ragin, 2008\]，见式\u00a0\(2\)。/u,
        );
        assert.equal(
          await pageView.locator('caption').textContent(),
          '表 1\u3000条件变量与校准锚点',
        );
        // Without TeX the page still renders; compiling is off and says why.
        assert.equal(await desk.getByRole('button', { name: '编译 PDF' }).isDisabled(), true);
        await desk.locator('.ss-ribbon__bar .ss-tag', { hasText: '未装 TeX' }).waitFor();
        await shoot(desk, 'u6-tex-split');

        // Typing shows on the page; the two lines join without a space, as in Chinese TeX.
        await desk.locator('.cm-line', { hasText: '并以面板回归' }).click();
        await desk.keyboard.press('End');
        await desk.keyboard.type('另附稳健性检验。');
        await pageView.locator('p', { hasText: '稳健性。另附稳健性检验。' }).waitFor();
        await status.getByText('有修改未写回').waitFor();
        await status.getByText('第 4 行，第 24 列').waitFor();

        // Bold puts \textbf around the selection.
        await desk.keyboard.press('Shift+Home');
        await desk.getByRole('button', { name: /加粗/u }).click();
        await pageView.locator('p strong', { hasText: '另附稳健性检验。' }).waitFor({
          timeout: 3000,
        });

        // Views switch in place: the source stays open with its undo history.
        await desk.getByRole('button', { name: '源码', exact: true }).click();
        await desk.locator('.ss-split__render').waitFor({ state: 'hidden' });
        await desk.getByRole('button', { name: '渲染', exact: true }).click();
        await desk.locator('.ss-desk-split .ss-desk-source').waitFor({ state: 'hidden' });
        await pageView.locator('h3', { hasText: '稳健性检验 12' }).waitFor();
        await desk.getByRole('button', { name: '并排', exact: true }).click();
        await desk.locator('.ss-desk-split .ss-desk-source').waitFor();
        assert.equal(await desk.getByRole('button', { name: '撤销' }).isDisabled(), false);

        // Scrolling the page scrolls the source to the same place, and back.
        const pane = desk.locator('.ss-split__render');
        const scroller = desk.locator('.ss-desk-split .cm-scroller');
        await pane.hover();
        await desk.mouse.wheel(0, 1600);
        await desk.waitForFunction(
          () => document.querySelector('.ss-desk-split .cm-scroller').scrollTop > 200,
        );
        await scroller.hover();
        await desk.mouse.wheel(0, -5000);
        await desk.waitForFunction(
          () => document.querySelector('.ss-split__render').scrollTop < 40,
        );
        // A click on a paragraph puts the source cursor at the clicked words.
        await pageView.locator('h3', { hasText: '一致性与覆盖度' }).click();
        await status.getByText(/第 13 行，第 \d+ 列/u).waitFor();
        if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
      },
      { deskOptions: { texOptions: { engines: none } } },
    );
  },
);

test(
  'a click on a formula edits it visually and writes it back as one change',
  { skip: browserSkip },
  async () => {
    const none = createTexEngines({ env: { PATH: '' }, miktexDirs: [], texliveRoots: [] });
    await withBrowserApp(
      'u6-formula',
      silent,
      async ({ page, app }) => {
        const { desk, errors } = await openChapter(page, app);
        const source = desk.locator('.ss-desk-split .cm-content');
        await desk.locator('.ss-page--tex .ss-eqbox[data-number="2"]').click();
        const editor = desk.getByRole('dialog', { name: '编辑公式（2）' });
        const field = editor.locator('math-field');
        await field.waitFor();
        assert.match(await editor.locator('.ss-mathedit__src').textContent(), /^\\mathrm\{Cons\}/u);
        assert.equal(
          await editor.locator('.ss-mathedit__src').getAttribute('data-tip'),
          '写回源码第 16 行',
        );
        await shoot(desk, 'u6-tex-formula');
        // Typing in the field; the LaTeX underneath follows.
        await typeAtEndOfMathField(field, '+1');
        await editor.locator('.ss-mathedit__src', { hasText: '+1' }).waitFor();
        await editor.getByRole('button', { name: '应用' }).click();
        assert.equal(await editor.count(), 0);
        await source.locator('.cm-line', { hasText: '+1' }).waitFor();
        // The label stays on the \begin line; only the formula changed.
        await source
          .locator('.cm-line', { hasText: '\\begin{equation}\\label{eq:cons}' })
          .waitFor();
        await desk.locator('.ss-statusbar').getByText('有修改未写回').waitFor();
        await desk.getByRole('button', { name: '撤销' }).click();
        assert.equal(await source.locator('.cm-line', { hasText: '+1' }).count(), 0);

        // The palette inserts templates; 取消 leaves the source alone.
        await desk.locator('.ss-page--tex .ss-eqbox[data-number="1"]').click();
        const first = desk.getByRole('dialog', { name: '编辑公式（1）' });
        await first.locator('math-field').waitFor();
        await first.getByRole('button', { name: '分式' }).click();
        await first.locator('.ss-mathedit__src', { hasText: '\\frac' }).waitFor();
        await first.getByRole('button', { name: '取消' }).click();
        assert.equal(await source.locator('.cm-line', { hasText: '\\frac{' }).count(), 1);

        // 公式 on an empty line inserts a numbered equation.
        await source.locator('.cm-line').nth(11).click();
        await desk.getByRole('button', { name: '公式', exact: true }).click();
        const fresh = desk.getByRole('dialog', { name: '插入公式' });
        await fresh.locator('math-field').click();
        await desk.keyboard.type('a^2');
        await fresh.locator('.ss-mathedit__src', { hasText: 'a^2' }).waitFor();
        await fresh.getByRole('button', { name: '应用' }).click();
        await source.locator('.cm-line', { hasText: /^\s*a\^2$/u }).waitFor();
        await desk.locator('.ss-page--tex .ss-page__eqno', { hasText: '(3)' }).waitFor();
        assert.equal(await desk.locator('.ss-page--tex .ss-page__eqno').count(), 3);
        if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
      },
      { deskOptions: { texOptions: { engines: none } } },
    );
  },
);

test(
  'compiling writes the file back first and lists TeX errors that jump to the source',
  { skip: browserSkip },
  async () => {
    const { dir, cleanup } = await tempDir('u6-fake-tex');
    try {
      const fake = await fakeTex(path.join(dir, 'tex'), ['pdflatex'], { failure: true });
      const engines = createTexEngines({ env: fake.env, miktexDirs: [], texliveRoots: [] });
      await withBrowserApp(
        'u6-compile',
        silent,
        async ({ page, app }) => {
          const { desk, errors } = await openChapter(page, app, 'paper.tex');
          const status = desk.locator('.ss-statusbar');
          await desk.locator('.cm-line', { hasText: '并以面板回归' }).click();
          await desk.keyboard.press('End');
          await desk.keyboard.type('补一句。');
          await status.getByText('有修改未写回').waitFor();
          const compile = desk.getByRole('button', { name: '编译 PDF' });
          assert.equal(await compile.isDisabled(), false);
          await compile.click();
          const alert = desk.locator('.ss-desk-compile');
          await alert.getByText('编译没有成功').waitFor();
          await status.getByText('已写回项目文件').waitFor();
          await shoot(desk, 'u6-tex-compile-error');
          await alert.getByRole('button', { name: 'paper.tex 第 7 行' }).click();
          await status.getByText('第 7 行，第 1 列').waitFor();
          await alert.getByRole('button', { name: '关闭' }).click();
          assert.equal(await alert.count(), 0);
          if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
        },
        { deskOptions: { texOptions: { engines, env: fake.env } } },
      );
    } finally {
      await cleanup();
    }
  },
);

// A 1 × 1 PNG.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test(
  'figures show their pictures: from the project top, beside the chapter, and PDFs as pictures',
  { skip: browserSkip },
  () =>
    withBrowserApp('u6-tex-figures', silent, async ({ page, app }) => {
      const prepare = async (root) => {
        await mkdir(path.join(root, 'figures'), { recursive: true });
        await writeFile(path.join(root, 'figures', 'map.png'), PIXEL);
        const pdf = await PDFDocument.create();
        pdf
          .addPage([200, 100])
          .drawRectangle({ x: 20, y: 20, width: 160, height: 60, color: rgb(0.2, 0.5, 0.4) });
        await writeFile(path.join(root, 'chapters', 'chart.pdf'), await pdf.save());
        await writeFile(
          path.join(root, 'chapters', 'figures.tex'),
          [
            '\\section{研究设计}',
            '\\begin{figure}',
            '\\includegraphics[width=0.5\\textwidth]{figures/map}',
            '\\caption{研究区域}',
            '\\end{figure}',
            '',
            '\\includegraphics{chart}',
            '',
            '\\includegraphics{figures/missing}',
          ].join('\n'),
        );
      };
      const { desk, errors } = await openChapter(page, app, 'chapters/figures.tex', prepare);
      const figures = desk.locator('.ss-page--tex .ss-page__fig');
      const map = figures.filter({ has: desk.locator('img[alt="figures/map"]') });
      await map.waitFor();
      assert.equal(await map.getAttribute('style'), '--fig-w: 50%');
      const chart = desk.locator('.ss-page--tex img[alt="chart"]');
      await chart.waitFor();
      await desk.waitForFunction(
        () =>
          document.querySelector('.ss-page--tex img[alt="chart"]') instanceof HTMLImageElement &&
          /** @type {HTMLImageElement} */ (document.querySelector('.ss-page--tex img[alt="chart"]'))
            .naturalWidth === 400,
      );
      // A figure that is not there keeps its file name.
      await desk.waitForFunction(
        () => document.querySelectorAll('.ss-page--tex .ss-page__fig--image').length === 2,
      );
      assert.equal(
        await figures.filter({ hasText: 'figures/missing' }).getAttribute('class'),
        'ss-page__fig',
      );
      await shoot(desk, 'u6-tex-figures');
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

test(
  'the tex page takes comments on its own words and shows the marks the source has',
  { skip: browserSkip },
  () =>
    withBrowserApp('u6-tex-page-notes', silent, async ({ page, app }) => {
      const { desk, errors } = await openChapter(page, app);
      const rendered = desk.locator('.ss-page--tex');
      const cards = desk.locator('.ss-desk-notes .ss-desk-card:not(.ss-desk-card--new)');
      /** Select `words` in the page text, as a drag would. */
      const selectOnPage = (words) =>
        desk.evaluate((wanted) => {
          const root = document.querySelector('.ss-page--tex');
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.textContent.indexOf(wanted);
            if (at < 0) continue;
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + wanted.length);
            getSelection().removeAllRanges();
            getSelection().addRange(range);
            return true;
          }
          return false;
        }, words);
      /** The page text each highlight covers. */
      const marked = (name) =>
        desk.evaluate((key) => [...(CSS.highlights.get(key) ?? [])].map(String), name);

      // Words selected on the page get a comment from the ribbon, with the source's words as quote.
      await rendered.locator('p', { hasText: '熵权法合成' }).waitFor();
      assert.equal(await selectOnPage('熵权法合成'), true);
      await desk.locator('.ss-ribbon').getByRole('button', { name: '批注', exact: true }).click();
      await desk.getByRole('textbox', { name: '批注内容' }).fill('说明熵权法的出处');
      await desk.getByRole('button', { name: '添加', exact: true }).click();
      const card = cards.filter({ hasText: '说明熵权法的出处' });
      await card.waitFor();
      assert.equal(await card.locator('.ss-desk-card__quote').textContent(), '熵权法合成');
      // The comment is marked in the source and on the page.
      await desk.locator('.ss-desk-source .ss-cmt', { hasText: '熵权法合成' }).waitFor();
      await desk.waitForFunction(() => (CSS.highlights.get('ss-tex-cmt')?.size ?? 0) > 0);
      assert.deepEqual(await marked('ss-tex-cmt'), ['熵权法合成']);

      // A caret in the marked words on the page lights its card, and the page marks it too.
      /** Put the caret in the page text just after the first character of `words`. */
      const caretOnPage = (words) =>
        desk.evaluate((wanted) => {
          const root = document.querySelector('.ss-page--tex');
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.textContent.indexOf(wanted);
            if (at < 0) continue;
            getSelection().collapse(node, at + 1);
            return;
          }
        }, words);
      await caretOnPage('本章采用');
      await desk.waitForFunction(
        () => !document.querySelector('.ss-desk-notes .ss-desk-card[data-active]'),
      );
      await caretOnPage('权法合成');
      await desk.waitForFunction(
        () =>
          document
            .querySelector('.ss-desk-notes .ss-desk-card[data-active]')
            ?.textContent.includes('说明熵权法的出处') ?? false,
      );
      await desk.waitForFunction(() => (CSS.highlights.get('ss-tex-active')?.size ?? 0) > 0);
      await shoot(desk, 'u6-tex-page-notes');
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
