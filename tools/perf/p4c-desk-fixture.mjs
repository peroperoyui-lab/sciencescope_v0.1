// Public self-created acceptance documents. Generated files stay in the ignored Part7 project.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import JSZip from 'jszip';
import { documentBytes } from './seed-documents.mjs';
import { readDocx } from '../../app/services/desk/docx/read.js';
import { indexMedia, readMedia } from '../../app/services/desk/media.js';
import { parseDocument } from '../../app/services/research/parsers/index.js';
import { readText, joinText } from '../../app/services/desk/text.js';

const directory = fileURLToPath(
  new URL('../../.sciencescope-local/temp/p4c/part7/project/', import.meta.url),
);
const notice = '公开合成验收材料，不对应真实研究';
const quote = '结果表明该方法显著优于基线';
const context = `本段只用于编辑台验收：样本量为1,284家合成企业，方法组均值为8.4，基线均值为7.9。未做显著性检验。${quote}。`;
const date = new Date('2026-01-01T00:00:00Z');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const chinese = (text) => (text.match(/\p{Script=Han}/gu) ?? []).length;
const paragraph = (id, text, style = '') =>
  `<w:p w14:paraId="${id}">${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

async function verifyDocx(bytes) {
  const document = await readDocx(bytes);
  document.media = await indexMedia(document);
  const target = document.blocks.find((block) => block.text.includes(quote));
  assert.ok(target);
  assert.equal(document.blocks.filter((block) => block.text.includes(quote)).length, 1);
  const inlines = document.blocks.flatMap((block) => block.inlines);
  const images = inlines.filter((atom) => atom.atom === 'image');
  const formulas = inlines.filter((atom) => atom.atom === 'math');
  assert.equal(images.length, 1);
  assert.equal(formulas.length, 1);
  const imageRef = images[0].ref;
  const media = await readMedia(document, imageRef);
  assert.equal(media.mimeType, 'image/png');
  assert.ok(media.bytes.length > 100);
  const parsed = await parseDocument(bytes, { name: 'thesis.docx' });
  assert.ok(parsed.blocks.some((block) => block.text.includes(quote)));
  assert.ok(parsed.blocks.some((block) => block.kind === 'table'));
  assert.ok(parsed.blocks.some((block) => block.kind === 'equation'));
  const text = document.blocks.map((block) => block.text).join('\n');
  assert.ok(text.startsWith(notice));
  assert.ok(chinese(text) >= 50000);
  return {
    counts: {
      unicodeCharacters: Array.from(text).length,
      utf16CodeUnits: text.length,
      chineseCharacters: chinese(text),
      paragraphs: document.spans.filter((span) => span.tag === 'w:p').length,
      deskBlocks: document.blocks.length,
      headings: document.blocks.filter((block) => block.kind === 'heading').length,
      tables: document.spans.filter((span) => span.tag === 'w:tbl').length,
      tableCells: document.spans.filter((span) => span.tag === 'w:tc').length,
      images: images.length,
      formulas: formulas.length,
      parserBlocks: parsed.blocks.length,
    },
    target: {
      blockId: target.id,
      paragraphIndex: document.blocks.indexOf(target),
      context: target.text,
      quote,
      from: target.text.indexOf(quote),
      to: target.text.indexOf(quote) + quote.length,
      numberQuote: '1,284',
      numberFrom: target.text.indexOf('1,284'),
      numberTo: target.text.indexOf('1,284') + 5,
      instruction:
        '语气缓和些，补上样本量；依据已有描述统计改写，保留均值8.4和7.9，并说明未做显著性检验。',
    },
    image: { ref: imageRef, bytes: media.bytes.length, sha256: sha256(media.bytes) },
    verification: {
      readDocx: true,
      researchParser: true,
      embeddedPngReadable: true,
      parserWarnings: parsed.warnings,
    },
  };
}

async function createFiles() {
  const { bytes } = await documentBytes({
    seed: 'P4c-public-acceptance',
    number: 1,
    format: 'docx',
    sections: 1,
    thesis: true,
    chineseTarget: 50000,
  });
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file('word/document.xml').async('string');
  const opening = [
    paragraph('704C0001', notice, 'Heading1'),
    paragraph('704C0002', '企业方法比较与城市韧性：编辑台公开合成长文'),
    paragraph('704C0003', '3.2 合成方法描述性比较（改写验收段）', 'Heading2'),
    paragraph('704C0004', context),
    paragraph(
      '704C0005',
      '数字索引来源：data/firms_clean.csv；复核脚本：analysis/count.py；含义：去重后的企业数。',
    ),
    paragraph(
      '704C0006',
      '以下长文、末尾表格、图片及公式由程序自造，供编辑、版本比较和原子保留检查使用。图中58、72、86仅为合成覆盖率示意。',
    ),
  ].join('');
  zip.file(
    'word/document.xml',
    xml
      .replace(
        '<w:document ',
        '<w:document xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ',
      )
      .replace('<w:body>', '<w:body>' + opening),
    { date },
  );
  const styles = await zip.file('word/styles.xml').async('string');
  zip.file(
    'word/styles.xml',
    styles.replace(
      '</w:styles>',
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style></w:styles>',
    ),
    { date },
  );
  const image = await zip.file('word/media/coverage.png').async('nodebuffer');
  const tex = String.raw`% ${notice}
\documentclass[UTF8]{ctexart}
\usepackage{graphicx}
\title{公开合成方法演示}
\author{合成验收夹具}
\begin{document}
\maketitle
\textbf{${notice}}

\section{研究设计}
${context}

\subsection{复核材料}
\begin{itemize}
\item 样本文件：data/firms\_clean.csv。
\item 计数脚本：analysis/count.py。
\end{itemize}

\section{合成结果表}
\begin{tabular}{lrr}
方案 & 企业数 & 均值 \\
方法 & 1284 & 8.4 \\
基线 & 1284 & 7.9 \\
\end{tabular}

\begin{figure}
\includegraphics[width=0.7\textwidth]{../figures/coverage.png}
\caption{公开合成覆盖率示意图，与统计检验无关}
\end{figure}

\section{公式编辑演示}
\begin{equation}
y = \alpha + \beta x
\end{equation}
\end{document}
`;
  const markdown = `# ${notice}

## 合成比较结果

${context}

- [企业样本](../data/firms_clean.csv)
- [复核计数脚本](../analysis/count.py)
- **人工核对**：全部企业编号唯一。

## 表格

| 方案 | 企业数 | 均值 |
| --- | ---: | ---: |
| 方法 | 1284 | 8.4 |
| 基线 | 1284 | 7.9 |

## 图

![公开合成覆盖率示意图](../figures/coverage.png)

## 公式

$$
y = \\alpha + \\beta x
$$

## 复核命令

\`\`\`sh
python analysis/count.py
\`\`\`
`;
  const rows = Array.from({ length: 1284 }, (_, index) => {
    const offset = ((index % 12) - 5.5) * 0.04;
    return `${notice},SYNTHETIC-${String(index + 1).padStart(4, '0')},区域${(index % 4) + 1},${(8.4 + offset).toFixed(2)},${(7.9 + offset).toFixed(2)}`;
  });
  const csv = 'notice,firm_id,region,method_score,baseline_score\n' + rows.join('\n') + '\n';
  const python = `# ${notice}
"""Count unique synthetic firms and reproduce descriptive means; standard library only."""
import csv
import json
from pathlib import Path
from statistics import mean

project = Path(__file__).resolve().parents[1]
with (project / "data" / "firms_clean.csv").open(encoding="utf-8", newline="") as stream:
    rows = list(csv.DictReader(stream))
assert len(rows) == len({row["firm_id"] for row in rows}) == 1284
print(json.dumps({
    "notice": "${notice}",
    "unique_firms": len(rows),
    "method_mean": round(mean(float(row["method_score"]) for row in rows), 1),
    "baseline_mean": round(mean(float(row["baseline_score"]) for row in rows), 1),
    "significance_test_performed": False,
}, ensure_ascii=False))
`;
  return new Map([
    ['thesis.docx', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })],
    ['chapters/method.tex', Buffer.from(tex)],
    ['notes/outline.md', Buffer.from(markdown)],
    ['figures/coverage.png', image],
    ['data/firms_clean.csv', Buffer.from(csv)],
    ['analysis/count.py', Buffer.from(python)],
  ]);
}

async function verifyFiles(files) {
  const docx = await verifyDocx(files.get('thesis.docx'));
  const formats = {};
  for (const [file, format] of [
    ['chapters/method.tex', 'tex'],
    ['notes/outline.md', 'md'],
  ]) {
    const bytes = files.get(file);
    const document = readText(bytes, format);
    assert.equal(joinText(document.blocks), bytes.toString());
    const parsed = await parseDocument(bytes, { name: file });
    assert.ok(parsed.blocks.some((block) => block.kind === 'equation'));
    const tables =
      format === 'tex'
        ? (bytes.toString().match(/\\begin\{tabular\}/gu) ?? []).length
        : parsed.blocks.filter((block) => block.kind === 'table').length;
    assert.equal(tables, 1);
    assert.ok(parsed.blocks.some((block) => block.text.includes('1284')));
    formats[file] = {
      deskBlocks: document.blocks.length,
      parserBlocks: parsed.blocks.length,
      headings: parsed.blocks.filter((block) => block.kind === 'heading').length,
      tables,
      parserTableBlocks: parsed.blocks.filter((block) => block.kind === 'table').length,
      formulas: parsed.blocks.filter((block) => block.kind === 'equation').length,
      imageReferences: (bytes.toString().match(/coverage\.png/gu) ?? []).length,
      chineseCharacters: chinese(bytes.toString()),
    };
  }
  const rows = files
    .get('data/firms_clean.csv')
    .toString()
    .trimEnd()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','));
  assert.equal(rows.length, 1284);
  assert.equal(new Set(rows.map((row) => row[1])).size, 1284);
  const average = (column) =>
    Number((rows.reduce((sum, row) => sum + Number(row[column]), 0) / rows.length).toFixed(1));
  assert.equal(average(3), 8.4);
  assert.equal(average(4), 7.9);
  return {
    schema: 1,
    notice,
    provenance:
      'Entirely self-created using existing deterministic DOCX seed helpers; no personal or third-party manuscript.',
    docx,
    formats,
    data: {
      rows: rows.length,
      uniqueFirms: 1284,
      methodMean: average(3),
      baselineMean: average(4),
      significanceTestPerformed: false,
    },
    files: [...files].map(([file, bytes]) => ({
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
    })),
  };
}

const { values } = parseArgs({ options: { verify: { type: 'boolean', default: false } } });
if (values.verify) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const files = new Map(
    await Promise.all(
      manifest.files.map(async ({ file, sha256: expected }) => {
        const bytes = await readFile(path.join(directory, file));
        assert.equal(sha256(bytes), expected);
        return [file, bytes];
      }),
    ),
  );
  assert.deepEqual(await verifyFiles(files), manifest);
  console.log(JSON.stringify(manifest));
} else {
  const files = await createFiles();
  const manifest = await verifyFiles(files);
  for (const [file, bytes] of [
    ...files,
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
  ]) {
    const destination = path.join(directory, file);
    await mkdir(path.dirname(destination), { recursive: true });
    const handle = await open(destination, 'wx');
    try {
      await handle.writeFile(bytes);
    } finally {
      await handle.close();
    }
  }
  console.log(JSON.stringify(manifest));
}
