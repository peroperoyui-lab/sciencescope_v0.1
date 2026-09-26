import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { openApplicationDatabaseSync } from '../scripts/application-database.mjs';
import { createResearchBase } from '../scripts/research-base/index.mjs';
import { parserFor, ParserUnsupported } from '../scripts/research-base/parsers/index.mjs';
import { pdfParser } from '../scripts/research-base/parsers/pdf.mjs';
import { convertDocx, docxParser } from '../scripts/research-base/parsers/docx.mjs';
import { createChineseDocxFixture, createPdfFixture, createScanPdfFixture, createTwoColumnPdfFixture, createVaryingEdgeHeaderPdfFixture, createNarrowGutterPdfFixture } from './helpers/document-fixtures.mjs';

test('PDF parser extracts pages, sections, references, metadata, repeated-header filtering and anchors', async () => {
  const parsed = await pdfParser.parse(await createPdfFixture(), { name: 'fixture.pdf' });
  assert.equal(parsed.pages, 2);
  assert.equal(parsed.metadata.title, 'Fixture Research Paper');
  assert.deepEqual(parsed.metadata.authors.map((author) => author.literal), ['Ada Lovelace', 'Alan Turing']);
  assert.equal(parsed.metadata.doi, '10.1234/fixture.2026.001');
  assert.equal(parsed.metadata.arxivId, '2601.12345');
  assert.ok(parsed.blocks.some((block) => block.text.includes('first searchable passage')));
  assert.ok(parsed.blocks.some((block) => block.kind === 'heading' && block.text === '1 Introduction'));
  assert.ok(parsed.blocks.some((block) => block.section?.includes('2 Methods')));
  assert.ok(parsed.blocks.some((block) => block.kind === 'reference' && block.text.includes('Parser Test')));
  assert.equal(parsed.blocks.some((block) => block.text.includes('repeated header')), false);
  assert.equal(parsed.blocks.some((block) => block.text.includes('repeated footer')), false);
  const passage = parsed.blocks.find((block) => block.text.includes('first searchable passage'));
  assert.equal(passage.anchor.page, 1);
  assert.equal(passage.anchor.quote.exact.includes('first searchable passage'), true);
  assert.ok(passage.anchor.rects.length > 0);
  assert.ok(passage.anchor.rects.every(([x, y, width, height]) => [x, y, width, height].every((value) => value >= 0)));
});

test('PDF scan-only content is explicitly unsupported', async () => {
  const bytes = await createScanPdfFixture();
  await assert.rejects(() => pdfParser.parse(bytes, { name: 'scan.pdf' }), (error) => {
    assert.ok(error instanceof ParserUnsupported);
    assert.match(error.message, /扫描件|OCR/u);
    return true;
  });
});

test('PDF parser filters changing edge page numbers and normalizes repeated running headers', async () => {
  const parsed = await pdfParser.parse(await createVaryingEdgeHeaderPdfFixture(), { name: 'edge-header.pdf' });
  assert.equal(parsed.blocks.some((block) => block.text.includes('RESEARCH ON LIBRARY SCIENCE')), false);
  assert.equal(parsed.blocks.some((block) => /^\d+(?:\s+\d+)+$/u.test(block.text)), false);
  assert.ok(parsed.blocks.some((block) => block.text.includes('body sentence remains searchable')));
});

test('PDF parser detects unnumbered headings, keeps double columns separate, merges prose lines and settles malformed input', async () => {
  const parsed = await pdfParser.parse(await createTwoColumnPdfFixture(), { name: 'columns.pdf' });
  assert.equal(parsed.metadata.title, 'Two Column Fixture');
  assert.ok(parsed.blocks.some((block) => block.kind === 'heading' && block.text === 'Methods'));
  assert.ok(parsed.blocks.some((block) => block.kind === 'heading' && block.text === 'Results'));
  const left = parsed.blocks.findIndex((block) => block.text.includes('Left column first line.'));
  const right = parsed.blocks.findIndex((block) => block.text.includes('Right column first line.'));
  assert.ok(left >= 0 && right > left);
  assert.doesNotMatch(parsed.blocks[left].text, /Right column/u);
  assert.match(parsed.blocks[left].text, /Left column second line[\s\S]*Left column third line[\s\S]*Left column fourth line/u);
  let timer;
  const malformed = Promise.race([
    pdfParser.parse(Buffer.from('not a PDF'), { name: 'broken.pdf' }),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('PDF parser did not settle')), 1000); timer.unref?.(); }),
  ]);
  try { await assert.rejects(malformed, /Invalid PDF|PDF parser did not settle|Invalid PDF binary/u); }
  finally { clearTimeout(timer); }
});

test('PDF parser separates a narrow central gutter while tolerating indented starts', async () => {
  const parsed = await pdfParser.parse(await createNarrowGutterPdfFixture(), { name: 'narrow-gutter.pdf' });
  const left = parsed.blocks.findIndex((block) => block.text.includes('Left body passage'));
  const right = parsed.blocks.findIndex((block) => block.text.includes('Right body passage'));
  assert.ok(left >= 0 && right > left);
  assert.doesNotMatch(parsed.blocks[left].text, /Right body passage/u);
});

test('DOCX parser preserves Chinese paragraphs, heading paths, whole tables and preview conversion', async () => {
  const bytes = await createChineseDocxFixture();
  const parsed = await docxParser.parse(bytes, { name: 'fixture.docx' });
  assert.equal(parsed.metadata.title, '中文研究夹具');
  assert.deepEqual(parsed.metadata.authors.map((author) => author.literal), ['测试作者']);
  assert.ok(parsed.blocks.some((block) => block.kind === 'heading' && block.text === '中文研究标题'));
  assert.ok(parsed.blocks.some((block) => block.section?.includes('中文研究标题 > 方法')));
  const table = parsed.blocks.find((block) => block.kind === 'table');
  assert.ok(table);
  assert.match(table.text, /中文指标/);
  assert.match(table.text, /显著/);
  assert.match(table.text, /变量\t结果\n中文指标\t显著/u);
  const converted = await convertDocx(bytes);
  assert.match(converted.html, /<table>/u);
  assert.match(converted.html, /中文研究标题/u);
});

test('PDF and DOCX parsers are registered and Chinese DOCX is searchable through research base', async () => {
  assert.equal(parserFor('paper.PDF').id, 'pdf');
  assert.equal(parserFor('notes.docx').id, 'docx');
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'research-parsers-'));
  const files = path.join(root, 'files'); await mkdir(files);
  const database = openApplicationDatabaseSync({ stateDir: root });
  try {
    await writeFile(path.join(files, '中文研究.docx'), await createChineseDocxFixture());
    database.addResource({ id: 'docx-fixture', projectId: 'p1', title: '中文研究.docx', kind: 'docx', path: '中文研究.docx', metadata: { storage: 'library' } });
    const rb = createResearchBase({ database, resolveResourcePath: async (resource) => path.join(files, resource.path) });
    const sync = await rb.ingest.syncResources({ projectId: 'p1' }); await sync.done;
    const source = rb.store.listSources({ projectId: 'p1' }).find((item) => item.resourceId === 'docx-fixture');
    assert.equal(source.contentStatus, 'parsed');
    assert.equal(source.title, '中文研究夹具');
    const hit = rb.retrieval.search({ query: '中文指标', projectId: 'p1' })[0];
    assert.ok(hit);
    assert.match(hit.snippet, /中文指标/);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});
