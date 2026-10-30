import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaLatex, formulaSource, maskComments, renderTex } from './tex-render.js';

// Text of a block without the formulas' own markup.
const text = (html) =>
  html
    .replace(
      /<span class="katex[\s\S]*?<\/span>(?=<\/span>(?:<span class="ss-page__eqno|<\/p>| ))/gu,
      '[f]',
    )
    .replace(/<[^>]+>/gu, '');
const kinds = (result) => result.blocks.map((block) => block.kind);

test('sections, paragraphs and formulas become numbered page blocks', () => {
  const source = [
    '\\section{研究设计}\\label{sec:design}',
    '',
    '本章采用模糊集定性比较分析，',
    '并以面板回归检验结论。',
    '',
    '\\subsection{指标合成}',
    '综合得分为',
    '\\begin{equation}\\label{eq:ci}',
    '  CI_i = \\sum_{j=1}^{m} w_j x_{ij}',
    '\\end{equation}',
    '其中 $w_j$ 由熵确定，见式~\\eqref{eq:ci} 和第~\\ref{sec:design} 节。',
  ].join('\n');
  const result = renderTex(source);
  assert.deepEqual(kinds(result), ['heading', 'p', 'heading', 'p', 'math', 'p']);
  const [h2, para, h3, , math, after] = result.blocks;
  assert.equal(h2.html, '<h2>1\u3000研究设计</h2>');
  // A line break between Chinese characters is no space.
  assert.equal(para.html, '<p>本章采用模糊集定性比较分析，并以面板回归检验结论。</p>');
  assert.equal(h3.html, '<h3>1.1\u3000指标合成</h3>');
  assert.match(math.html, /<span class="ss-page__eqno">\(1\)<\/span>/u);
  // Text that goes on after a formula is not a new, indented paragraph.
  assert.match(after.html, /^<p class="ss-page__noindent">/u);
  assert.match(text(after.html), /见式\u00a0\(1\) 和第\u00a01 节。$/u);
  assert.deepEqual(
    result.outline.map((entry) => [entry.level, entry.text]),
    [
      [1, '1 研究设计'],
      [2, '1.1 指标合成'],
    ],
  );
});

test('each block knows its range, and a formula its inside, for writing it back', () => {
  const source =
    'Score\n\\begin{equation}\n  a = \\frac{b}{c} \\label{x}\n\\end{equation}\nand $d^2$ too.';
  const { blocks } = renderTex(source);
  const math = blocks.find((block) => block.kind === 'math');
  assert.equal(
    source.slice(math.from, math.to),
    '\\begin{equation}\n  a = \\frac{b}{c} \\label{x}\n\\end{equation}',
  );
  const [from, to] = /data-eq="(\d+),(\d+)"/u.exec(math.html).slice(1).map(Number);
  assert.equal(source.slice(math.from + from, math.from + to), '\n  a = \\frac{b}{c} \\label{x}\n');
  const para = blocks.at(-1);
  const [a, b] = /data-eq="(\d+),(\d+)"/u.exec(para.html).slice(1).map(Number);
  assert.equal(source.slice(para.from + a, para.from + b), 'd^2');
});

test('chapters number sections, equations and tables within them', () => {
  const source = [
    '\\chapter{研究设计}',
    '\\section{一致性}',
    '\\begin{equation}x\\end{equation}',
    '\\begin{table}\\caption{锚点}\\label{tab:a}',
    '\\begin{tabular}{lc}\\toprule 条件 & 值 \\\\ \\midrule A & 0.8 \\\\ \\bottomrule\\end{tabular}',
    '\\end{table}',
    '见表~\\ref{tab:a}。',
  ].join('\n');
  const { blocks, outline } = renderTex(source);
  assert.equal(blocks[0].html, '<h1>第一章\u3000研究设计</h1>');
  assert.equal(blocks[1].html, '<h2>1.1\u3000一致性</h2>');
  assert.match(blocks[2].html, /\(1-1\)/u);
  const table = blocks[3].html;
  assert.match(
    table,
    /<table><caption>表 1\.1\u3000锚点<\/caption><thead><tr><th data-align="l">条件<\/th><th>值<\/th><\/tr><\/thead>/u,
  );
  assert.match(table, /<tbody><tr><td data-align="l">A<\/td><td>0\.8<\/td><\/tr><\/tbody>/u);
  assert.match(text(blocks[4].html), /见表\u00a01\.1。/u);
  assert.equal(outline.at(-1).text, '表 1.1 锚点');
});

test('align gives each row its own number unless it says \\nonumber', () => {
  const source =
    '\\begin{align}\na &= b \\label{r1}\\\\\nc &= d \\nonumber\\\\\ne &= f\n\\end{align}\n\nRows \\eqref{r1}.';
  const { blocks } = renderTex(source);
  const tags = [...blocks[0].html.matchAll(/class="mord">(\d)<\/span>/gu)].map((match) => match[1]);
  assert.deepEqual(tags, ['1', '2']);
  assert.match(blocks[0].html, /ss-eqbox--wide/u);
  assert.equal(text(blocks[1].html), 'Rows (1).');
});

test('lists, quotes, theorems and inline commands', () => {
  const source = [
    '\\newtheorem{hyp}{假设}',
    '\\begin{itemize}',
    '  \\item 第一点，\\textbf{加粗}和\\emph{强调}',
    '  \\item[*] 自定义',
    '\\end{itemize}',
    '\\begin{enumerate}\\item 甲 \\begin{enumerate}\\item 乙\\end{enumerate}\\end{enumerate}',
    '\\begin{quote}引文\\end{quote}',
    '\\begin{hyp}[数字经济]城市更有韧性。\\end{hyp}',
    '\\begin{hyp}第二条。\\end{hyp}',
  ].join('\n');
  const { blocks } = renderTex(source);
  assert.equal(
    blocks[0].html,
    '<ul><li>第一点，<strong>加粗</strong>和<em>强调</em></li><li data-label="*">自定义</li></ul>',
  );
  assert.equal(blocks[1].html, '<ol><li>甲<ol><li>乙</li></ol></li></ol>');
  assert.equal(blocks[2].html, '<blockquote><p>引文</p></blockquote>');
  assert.equal(
    blocks[3].html,
    '<div class="ss-page__thm"><p class="ss-page__noindent"><strong>假设 1</strong>（数字经济）\u3000城市更有韧性。</p></div>',
  );
  assert.match(blocks[4].html, /<strong>假设 2<\/strong>/u);
});

test('citations read like the bibliography; unknown commands show as written', () => {
  const plain = renderTex(
    'Threshold~\\cite[p.~3]{ragin2008}, after \\citet{smith2020}. \\foo{bar} \\textcolor{red}{red}',
  );
  assert.equal(
    text(plain.blocks[0].html),
    'Threshold\u00a0[Ragin, 2008, p.\u00a03], after Smith (2020). \\foo{bar} red',
  );
  assert.match(plain.blocks[0].html, /<span class="ss-page__raw">\\foo\{bar\}<\/span>/u);
  const numbered = renderTex(
    'See \\cite{a,b}.\n\n\\begin{thebibliography}{9}\\bibitem{a} A. \\bibitem{b} B.\\end{thebibliography}',
  );
  assert.equal(text(numbered.blocks[0].html), 'See [1, 2].');
  assert.equal(kinds(numbered).at(-1), 'bib');
});

test('comments, verbatim, footnotes, macros and the title', () => {
  const source = [
    '\\documentclass{article}',
    '\\newcommand{\\fs}{fsQCA}',
    '\\newcommand{\\R}{\\mathbb{R}}',
    '\\title{城市韧性} \\author{作者甲 \\and 作者乙}',
    '\\begin{document}',
    '\\maketitle',
    '用 \\fs{} 分析 50\\% 的城市 % 这是注释',
    '$x \\in \\R$\\footnote{数据来自年鉴。}',
    '\\begin{verbatim}',
    'a % not a comment',
    '\\end{verbatim}',
    '\\end{document}',
  ].join('\n');
  const { blocks, outline } = renderTex(source);
  assert.deepEqual(kinds({ blocks }), ['title', 'p', 'pre', 'notes']);
  assert.match(
    blocks[0].html,
    /<h1>城市韧性<\/h1><p class="ss-page__center">作者甲\s*\u2003\s*作者乙<\/p>/u,
  );
  assert.equal(text(blocks[1].html), '用 fsQCA 分析 50% 的城市 x∈R1');
  assert.match(blocks[1].html, /mathbb/u);
  assert.doesNotMatch(blocks[1].html, /注释|ss-page__raw/u);
  assert.equal(blocks[2].html, '<pre class="ss-page__pre">a % not a comment</pre>');
  assert.equal(
    blocks[3].html,
    '<section class="ss-page__notes"><ol><li>数据来自年鉴。</li></ol></section>',
  );
  assert.equal(outline[0].text, '城市韧性');
});

test('half-typed source stays readable around the spot being typed', () => {
  const source =
    'First \\textbf{open\n\nSecond paragraph.\n\n\\begin{itemize}\n\\item one\n\nThird.';
  const { blocks } = renderTex(source);
  assert.equal(text(blocks[1].html), 'Second paragraph.');
  assert.equal(blocks[2].kind, 'raw');
  assert.equal(text(blocks.at(-1).html), 'Third.');
  // A formula with a mistake shows its source instead.
  const broken = renderTex('$\\frac{a$ and $b$');
  assert.match(broken.blocks[0].html, /ss-page__raw/u);
});

test('comments are blanked without moving anything', () => {
  const source = 'a % note\n50\\% b\n\\begin{comment}\nhidden\n\\end{comment}\nc';
  const masked = maskComments(source);
  assert.equal(masked.length, source.length);
  assert.equal(masked.split('\n')[0], 'a       ');
  assert.equal(masked.split('\n')[1], '50\\% b');
  assert.doesNotMatch(masked, /hidden/u);
});

test('an edited formula goes back with its labels and spacing where they were', () => {
  assert.equal(formulaLatex('\\label{eq:c}\n  a = b\n'), 'a = b');
  assert.equal(formulaSource('\\label{eq:c}\n  a = b\n', 'a+1'), '\\label{eq:c}\n  a+1\n');
  assert.equal(formulaSource('\n  a = b \\label{x}\n', 'c'), '\n  c \\label{x}\n');
  assert.equal(formulaSource('x \\label{m} y', 'z'), 'z \\label{m}');
  assert.equal(formulaSource('d^2', 'd^3'), 'd^3');
});

test('a figure keeps its file name, its width and the graphics folders to look in', () => {
  const source = [
    '\\graphicspath{{figures/}{img/}}',
    '\\begin{document}',
    '\\includegraphics[width=0.6\\textwidth]{map}',
    '',
    '\\includegraphics[scale=2, width=8cm]{plot.png}',
    '',
    '\\includegraphics{raw}',
    '\\end{document}',
  ].join('\n');
  const { blocks, graphicsPath } = renderTex(source);
  assert.deepEqual(graphicsPath, ['figures/', 'img/']);
  assert.match(blocks[0].html, /data-src="map" style="--fig-w: 60%"/u);
  assert.match(blocks[1].html, /data-src="plot.png" style="--fig-w: 8cm"/u);
  assert.match(blocks[2].html, /<span class="ss-page__fig" data-src="raw">raw<\/span>/u);
});
