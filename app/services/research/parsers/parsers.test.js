import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { parseDocument } from './index.js';
import { chunkBlocks } from '../chunks.js';
import { createResearchFixtures } from '../testing.js';

test('import genuine research PDF and DOCX with readable structure and honest citation anchors', async () => {
  const temporary = path.resolve('.sciencescope-local/temp');
  await mkdir(temporary, { recursive: true });
  const directory = await mkdtemp(path.join(temporary, 'research-documents-'));
  try {
    const fixtures = await createResearchFixtures(directory);
    const pdf = await parseDocument(fixtures.pdf.bytes, { name: fixtures.pdf.name });
    assert.equal(pdf.parser, 'pdf');
    assert.equal(pdf.pages, 2);
    assert.equal(pdf.metadata.title, 'Research Library Fixture');
    assert.deepEqual(
      pdf.metadata.authors.map((author) => author.literal),
      ['Ada Lovelace', 'Alan Turing'],
    );
    assert.equal(pdf.metadata.doi, '10.1234/library.2026');
    assert.equal(pdf.metadata.arxivId, '2601.12345');
    assert.ok(
      pdf.blocks.some((block) => block.kind === 'reference' && block.text.includes('Parser Test')),
    );
    assert.equal(
      pdf.blocks.some((block) => block.text.includes('Running research header')),
      false,
    );
    const leftIndex = pdf.blocks.findIndex((block) =>
      block.text.includes('Left column searchable'),
    );
    const rightIndex = pdf.blocks.findIndex((block) =>
      block.text.includes('Right column searchable'),
    );
    assert.ok(leftIndex >= 0 && rightIndex > leftIndex);
    assert.match(
      pdf.blocks[leftIndex].text,
      /Left column second sentence.*Left column final sentence/u,
    );
    assert.doesNotMatch(pdf.blocks[leftIndex].text, /Right column/u);
    const pdfChunk = chunkBlocks(pdf.blocks).find((chunk) =>
      chunk.text.includes('second page preserves'),
    );
    assert.equal(pdfChunk.page, 2);
    assert.equal(pdfChunk.anchor.page, 2);
    assert.ok(
      pdfChunk.anchor.rects.every((rectangle) => rectangle.every((coordinate) => coordinate >= 0)),
    );
    const docx = await parseDocument(fixtures.docx.bytes, { name: fixtures.docx.name });
    assert.equal(docx.pages, 2);
    assert.equal(docx.metadata.title, '中文研究资料');
    const docxChunks = chunkBlocks(docx.blocks);
    const table = docxChunks.find((chunk) => chunk.kind === 'table');
    assert.match(table.text, /变量\t结果\n中文指标\t显著/u);
    assert.equal(table.page, 2);
    assert.ok(docx.blocks.some((block) => block.section === '中文研究标题 > 方法'));
    assert.equal(docx.blocks.find((block) => block.kind === 'equation').text, 'x^{2} = 4');
    const unknown = await parseDocument(fixtures.docxUnknown.bytes, {
      name: fixtures.docxUnknown.name,
    });
    assert.equal(unknown.pages, null);
    assert.ok(unknown.blocks.every((block) => block.page === null));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('text source import preserves Markdown and LaTeX structure and every long passage', async () => {
  const encode = (source) => new TextEncoder().encode(source);
  const markdown = await parseDocument(
    encode(
      '# Paper\n\n## Methods\n\nBody.\n\n$$x=1$$\n\n| a | b |\n|---|---|\n| c | d |\n\n```js\nconst n = 1;\n```',
    ),
    { name: 'paper.md' },
  );
  assert.equal(markdown.metadata.title, 'Paper');
  assert.deepEqual(
    markdown.blocks.map((block) => block.kind),
    ['heading', 'heading', 'paragraph', 'equation', 'table', 'code'],
  );
  const latex = await parseDocument(
    encode(
      '\\title{Paper}\n\\author{Ada\\and Alan}\n\\begin{document}\n\\section{Methods}\nBody with \\cite{source}.\n\n\\begin{equation}\nx^2=4\n\\end{equation}\n\\begin{table}\n\\caption{Results table}\n\\end{table}\n\\end{document}',
    ),
    { name: 'paper.tex' },
  );
  assert.ok(
    latex.blocks.some((block) => block.kind === 'equation' && block.text.includes('x^2=4')),
  );
  assert.ok(
    latex.blocks.some((block) => block.kind === 'caption' && block.text === 'Results table'),
  );
  const longText = '中文长文'.repeat(2000);
  const text = await parseDocument(encode(longText), { name: 'paper.txt' });
  const chunks = chunkBlocks(text.blocks);
  assert.equal(chunks.map((chunk) => chunk.text).join(''), longText);
  assert.deepEqual(
    chunks.map((chunk) => chunk.ordinal),
    [0, 1, 2, 3],
  );
  assert.equal(chunks.at(-1).charEnd, longText.length);
});

test('Word-exported Chinese PDF keeps wrapped sentences and the column under the header', async () => {
  const { readFile } = await import('node:fs/promises');
  const name = 'word-export-zh.pdf';
  const bytes = await readFile(new URL(`./fixtures/u6a/${name}`, import.meta.url));
  const { blocks } = await parseDocument(bytes, { name });
  const texts = blocks.map((block) => block.text);
  for (const page of [1, 2]) {
    // "…阈值为" and "0.75，…" were two blocks, the second read as heading "0.75".
    assert.ok(
      texts.includes(`左栏正文第 ${page} 页：本研究的合成一致性阈值为0.75，案例频数阈值为 2。`),
      texts.join('\n'),
    );
    // The right column's first line sits near the top edge, under the running header.
    assert.ok(
      texts.includes(`右栏正文第 ${page} 页：较低阈值纳入更多合成案例，应当区分阈值口径。`),
      texts.join('\n'),
    );
  }
  assert.ok(!texts.some((text) => text.includes('编辑台验收专用')), 'running header removed');
  assert.ok(blocks.every((block) => block.kind !== 'heading' || !/^0\./u.test(block.text)));
});
