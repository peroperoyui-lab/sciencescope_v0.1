import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import JSZip from 'jszip';

const ROOT = path.resolve('.sciencescope-local/temp');

export async function createPdfFixture() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Fixture Research Paper');
  pdf.setAuthor('Ada Lovelace; Alan Turing');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = [pdf.addPage([612, 792]), pdf.addPage([612, 792])];
  for (const page of pages) {
    page.drawText('Fixture Research Paper | repeated header', { x: 48, y: 760, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Page footer | repeated footer', { x: 48, y: 24, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  }
  pages[0].drawText('Fixture Research Paper', { x: 48, y: 710, size: 20, font: bold });
  pages[0].drawText('Ada Lovelace and Alan Turing', { x: 48, y: 682, size: 11, font });
  pages[0].drawText('doi:10.1234/fixture.2026.001 arXiv:2601.12345', { x: 48, y: 654, size: 10, font });
  pages[0].drawText('1 Introduction', { x: 48, y: 610, size: 14, font: bold });
  pages[0].drawText('This paragraph contains the first searchable passage and a stable anchor.', { x: 48, y: 580, size: 11, font });
  pages[0].drawText('2 Methods', { x: 48, y: 520, size: 14, font: bold });
  pages[0].drawText('We used a deterministic document parser fixture.', { x: 48, y: 490, size: 11, font });
  pages[1].drawText('2.1 Evaluation', { x: 48, y: 710, size: 14, font: bold });
  pages[1].drawText('The second page confirms page-aware extraction and section paths.', { x: 48, y: 680, size: 11, font });
  pages[1].drawText('References', { x: 48, y: 620, size: 14, font: bold });
  pages[1].drawText('[1] Parser Test. 2026. A reproducible reference entry.', { x: 48, y: 590, size: 11, font });
  return Buffer.from(await pdf.save());
}

export async function createScanPdfFixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  return Buffer.from(await pdf.save());
}

export async function createTwoColumnPdfFixture() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('Two Column Fixture', { x: 48, y: 744, size: 20, font: bold });
  page.drawText('Methods', { x: 48, y: 700, size: 15, font: bold });
  page.drawText('Left column first line.', { x: 48, y: 672, size: 11, font });
  page.drawText('Left column second line.', { x: 48, y: 650, size: 11, font });
  page.drawText('Left column third line.', { x: 48, y: 628, size: 11, font });
  page.drawText('Left column fourth line.', { x: 48, y: 606, size: 11, font });
  page.drawText('Results', { x: 330, y: 700, size: 15, font: bold });
  page.drawText('Right column first line.', { x: 330, y: 672, size: 11, font });
  page.drawText('Right column second line.', { x: 330, y: 650, size: 11, font });
  page.drawText('Right column third line.', { x: 330, y: 628, size: 11, font });
  page.drawText('Right column fourth line.', { x: 330, y: 606, size: 11, font });
  return Buffer.from(await pdf.save());
}

export async function createVaryingEdgeHeaderPdfFixture() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = [pdf.addPage([612, 792]), pdf.addPage([612, 792])];
  for (const [index, page] of pages.entries()) {
    page.drawText(`RESEARCH ON LIBRARY SCIENCE ${index + 1} ${index + 2} ${index + 7}`, { x: 48, y: 766, size: 9, font });
    page.drawText(`${index + 1} ${index + 2} ${index + 8}`, { x: 300, y: 24, size: 9, font });
    page.drawText('This body sentence remains searchable despite changing edge text.', { x: 48, y: 700, size: 11, font });
  }
  pages[0].drawText('1 Introduction', { x: 48, y: 650, size: 14, font });
  return Buffer.from(await pdf.save());
}

export async function createNarrowGutterPdfFixture() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  const left = 'Left body passage is deliberately long near the central gutter.';
  const right = 'Right body passage stays in the second column with a narrow gutter.';
  for (const y of [700, 670, 640, 610]) {
    page.drawText(left, { x: 48, y, size: 10, font });
    page.drawText(right, { x: 340, y, size: 10, font });
  }
  page.drawText('Indented table label', { x: 72, y: 580, size: 10, font });
  page.drawText('Results', { x: 340, y: 580, size: 10, font });
  return Buffer.from(await pdf.save());
}

export async function createChineseDocxFixture() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>中文研究夹具</dc:title><dc:creator>测试作者</dc:creator></cp:coreProperties>`);
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>中文研究标题</w:t></w:r></w:p><w:p><w:r><w:t>这是一个可检索的中文段落，用于验证文档解析和章节路径。</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>方法</w:t></w:r></w:p><w:p><w:r><w:t>样本包含中文内容与稳定的引文。</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>变量</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>结果</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>中文指标</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>显著</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

export { ROOT };
