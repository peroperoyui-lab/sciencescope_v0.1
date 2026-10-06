import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';

/** @returns {Promise<Uint8Array>} */
export async function createResearchPdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Research Library Fixture');
  pdf.setAuthor('Ada Lovelace; Alan Turing');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = [pdf.addPage([612, 792]), pdf.addPage([612, 792])];
  for (const [index, page] of pages.entries()) {
    page.drawText(`Running research header ${index + 1}`, {
      x: 48,
      y: 760,
      size: 9,
      font: regular,
    });
    page.drawText(`${index + 1} ${index + 2}`, { x: 300, y: 24, size: 9, font: regular });
  }
  const draw = (page, text, x, y, size = 11) =>
    page.drawText(text, {
      x,
      y,
      size,
      font: size > 11 ? bold : regular,
    });
  draw(pages[0], 'Research Library Fixture', 48, 712, 20);
  draw(pages[0], 'doi:10.1234/library.2026 arXiv:2601.12345', 48, 680, 10);
  draw(pages[0], '1 Methods', 48, 640, 15);
  draw(pages[0], 'Left column searchable sentence.', 48, 612);
  draw(pages[0], 'Left column second sentence.', 48, 590);
  draw(pages[0], 'Left column final sentence.', 48, 568);
  draw(pages[0], '2 Results', 330, 640, 15);
  draw(pages[0], 'Right column searchable sentence.', 330, 612);
  draw(pages[0], 'Right column second sentence.', 330, 590);
  draw(pages[0], 'Right column final sentence.', 330, 568);
  draw(pages[1], '3 Discussion', 48, 700, 15);
  draw(pages[1], 'The second page preserves a known citation.', 48, 672);
  draw(pages[1], 'References', 48, 620, 15);
  draw(pages[1], '[1] Parser Test. 2026. A preserved reference.', 48, 592);
  return pdf.save();
}

function docxPackage(document) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`,
  );
  zip.file(
    'docProps/core.xml',
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>中文研究资料</dc:title><dc:creator>测试作者</dc:creator></cp:coreProperties>`,
  );
  zip.file(
    'word/styles.xml',
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
<w:style w:type="character" w:styleId="ScienceScopeEquation"><w:name w:val="ScienceScopeEquation"/></w:style>
</w:styles>`,
  );
  zip.file('word/document.xml', document);
  return zip;
}

/** @param {{pageBreak?:boolean}} [options] @returns {Promise<Buffer>} */
export async function createResearchDocx({ pageBreak = true } = {}) {
  const paragraph = (text, heading) =>
    `<w:p>${heading ? `<w:pPr><w:pStyle w:val="Heading${heading}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
  const document = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>
${paragraph('中文研究标题', 1)}${paragraph('这是中文可检索段落，研究资料来源可追溯。')}
${pageBreak ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ''}
${paragraph('方法', 2)}${paragraph('第二部分保留稳定的段落和中文指标。')}
<w:tbl><w:tr><w:tc>${paragraph('变量')}</w:tc><w:tc>${paragraph('结果')}</w:tc></w:tr>
<w:tr><w:tc>${paragraph('中文指标')}</w:tc><w:tc>${paragraph('显著')}</w:tc></w:tr></w:tbl>
<w:p><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t> = 4</m:t></m:r></m:oMath></w:p>
<w:sectPr/></w:body></w:document>`;
  return docxPackage(document).generateAsync({ type: 'nodebuffer' });
}

/**
 * @param {string} directory Caller-owned directory under .sciencescope-local/temp.
 * @returns {Promise<Record<string,{name:string,bytes:Uint8Array,path:string}>>}
 */
export async function createResearchFixtures(directory) {
  await mkdir(directory, { recursive: true });
  const fixtures = {
    pdf: { name: 'research-paper.pdf', bytes: await createResearchPdf() },
    docx: { name: '中文研究.docx', bytes: await createResearchDocx() },
    docxUnknown: {
      name: '中文研究-无分页.docx',
      bytes: await createResearchDocx({ pageBreak: false }),
    },
  };
  /** @type {Record<string,{name:string,bytes:Uint8Array,path:string}>} */
  const results = {};
  for (const [key, fixture] of Object.entries(fixtures)) {
    const file = path.join(directory, fixture.name);
    await writeFile(file, fixture.bytes);
    results[key] = { ...fixture, path: file };
  }
  return results;
}
