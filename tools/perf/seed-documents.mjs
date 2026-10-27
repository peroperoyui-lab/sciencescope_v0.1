// Self-created social-science prose, deterministic OOXML and extractable PDF.
// Existing pdf-lib (MIT), JSZip (MIT) and canvas (MIT) supply format writers.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
import { createCanvas } from '@napi-rs/canvas';

const date = new Date('2026-01-01T00:00:00.000Z');
const topics = ['城市韧性', '公共服务', '社区治理', '就业结构', '基础设施', '政策协同'];
const xml = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const paragraphXml = (text) => `<w:p><w:r><w:t xml:space="preserve">${xml(text)}</w:t></w:r></w:p>`;
const headingXml = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>${xml(text)}</w:t></w:r></w:p>`;

/**
 * @param {string} seed
 * @param {number} document
 * @param {number} section
 * @returns {string}
 */
export function syntheticParagraph(seed, document, section) {
  const topic = topics[(document + section) % topics.length];
  return (
    `合成样本${seed}，文献${document}，章节${section}。${topic}的比较研究需要同时观察制度安排、资源分配和居民参与。` +
    '本研究以自造的地区案例说明测量过程，所有数字只用于程序性能复测。我们先整理年度资料，再核对指标口径，避免把资料缺失解释为真实变化。' +
    '城市韧性涉及抵抗冲击、恢复基本服务与调整治理结构三个方面，不同地区可能通过多种条件组合达到相近结果。' +
    '分析时把公共服务覆盖、社会网络互助和基础设施维护分别作为条件，保留资料出处与时间范围，并区分个体经验和整体统计。' +
    '描述性比较关注条件如何共同出现，不能用单一排名替代过程解释。编码人员先独立阅读材料，再讨论分歧，最后保存一致的操作定义。' +
    `本节的演示指标为${70 + (document % 20)}，观察期编号为${section}。一致性阈值设为0.80，并以替代阈值检验结论对校准规则的敏感程度。` +
    '结果部分逐项说明案例差异，讨论缺失记录、测量误差与外部条件变化，后续研究可据此复查而不是只依赖摘要。'
  );
}

/**
 * @returns {Buffer}
 */
export function chartImage() {
  const canvas = createCanvas(480, 240);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 480, 240);
  context.fillStyle = '#222529';
  context.font = '18px sans-serif';
  context.fillText('Synthetic public-service coverage', 28, 28);
  context.strokeStyle = '#222529';
  context.beginPath();
  context.moveTo(40, 50);
  context.lineTo(40, 200);
  context.lineTo(445, 200);
  context.stroke();
  for (const [index, value] of [58, 72, 86].entries()) {
    context.fillStyle = '#436b50';
    context.fillRect(80 + index * 120, 200 - value * 1.5, 62, value * 1.5);
    context.fillStyle = '#222529';
    context.fillText(String(value), 95 + index * 120, 190 - value * 1.5);
    context.fillText(String(2020 + index), 85 + index * 120, 225);
  }
  return canvas.toBuffer('image/png');
}

async function pdfBytes(seed, number, sections) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(date);
  pdf.setModificationDate(date);
  pdf.setTitle(`Synthetic urban resilience ${seed} ${number}`);
  pdf.setAuthor('ScienceScope synthetic fixture');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let section = 1; section <= sections; section++) {
    const page = pdf.addPage([595, 842]);
    const text =
      `Synthetic research ${encodeURIComponent(seed)} document ${number} section ${section}. ` +
      'Urban resilience combines public services, local participation and infrastructure maintenance. ' +
      'These invented observations demonstrate a transparent comparative method. Researchers check the year, measurement unit and missing records before comparing districts. ' +
      'Different combinations of institutions and resources can support similar outcomes. A sensitivity analysis varies the calibration threshold while preserving the source evidence. ' +
      `The illustrative service score is ${60 + (number % 30)}; the section identifier is ${section}. ` +
      'The conclusion distinguishes descriptive patterns from causal claims and records alternative explanations for subsequent review.';
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      if (font.widthOfTextAtSize(line + ' ' + word, 11) > 480) {
        lines.push(line);
        line = word;
      } else line += (line ? ' ' : '') + word;
    }
    lines.push(line);
    page.drawText(lines.join('\n'), { x: 48, y: 740, size: 11, lineHeight: 18, font });
  }
  return Buffer.from(await pdf.save());
}

async function docxBytes(seed, number, sections, thesis, revision, chineseTarget) {
  const zip = new JSZip();
  const parts = [];
  let chineseCharacters = 0;
  let index = 0;
  while (thesis ? chineseCharacters < chineseTarget : index < sections) {
    if (!thesis || index % 4 === 0)
      parts.push(headingXml(`${thesis ? '论文' : '研究'}第${index + 1}节 城市韧性与制度比较`));
    let text = syntheticParagraph(seed, number, index + 1);
    if (revision && [2, 25, 61].includes(index))
      text =
        text.replace('一致性阈值设为0.80', '一致性阈值设为0.85') +
        '修订补充：增加邻近地区作为对照案例，单独核对年份和口径。';
    chineseCharacters += (text.match(/\p{Script=Han}/gu) ?? []).length;
    parts.push(paragraphXml(text));
    index++;
  }
  if (thesis) {
    const cell = (text) => `<w:tc>${paragraphXml(text)}</w:tc>`;
    parts.push(
      `<w:tbl><w:tr>${cell('年份')}${cell('服务覆盖')}</w:tr><w:tr>${cell('2020')}${cell(revision ? '61' : '58')}</w:tr><w:tr>${cell('2022')}${cell('86')}</w:tr></w:tbl>`,
    );
    parts.push(
      '<w:p><m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup><m:r><m:t> + y = 1</m:t></m:r></m:oMath></w:p>',
    );
    parts.push(
      '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="5486400" cy="2743200"/><wp:docPr id="1" name="Synthetic service chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="coverage.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5486400" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
    );
    zip.file('word/media/coverage.png', chartImage(), { date });
  }
  const entries = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/styles.xml':
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>',
    'word/_rels/document.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/coverage.png"/></Relationships>',
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${parts.join('')}<w:sectPr/></w:body></w:document>`,
  };
  for (const [name, content] of Object.entries(entries)) zip.file(name, content, { date });
  return {
    bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    chineseCharacters,
  };
}

/**
 * @param {{seed:string,number:number,format:string,sections:number,thesis?:boolean,revision?:boolean,chineseTarget?:number}} options
 * @returns {Promise<{bytes:Buffer,chineseCharacters:number}>}
 */
export async function documentBytes({
  seed,
  number,
  format,
  sections,
  thesis = false,
  revision = false,
  chineseTarget = 50000,
}) {
  if (format === 'pdf')
    return { bytes: await pdfBytes(seed, number, sections), chineseCharacters: 0 };
  if (format === 'docx') return docxBytes(seed, number, sections, thesis, revision, chineseTarget);
  const text = Array.from(
    { length: sections },
    (_, index) => `# ${index + 1} 城市韧性研究\n\n${syntheticParagraph(seed, number, index + 1)}\n`,
  ).join('\n');
  return {
    bytes: Buffer.from(text),
    chineseCharacters: (text.match(/\p{Script=Han}/gu) ?? []).length,
  };
}
