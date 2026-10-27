import { cleanText } from './text-utils.js';
import { isPageNumber } from './pdf-layout.js';

const REFERENCES = /^(?:references?|bibliography|参考文献|参考资料|引用文献)\s*[:：.]?$/iu;
const REFERENCE_PREFIX = /^(?:参考文献|参考资料|引用文献)\s*[:：]/u;
const BRACKET_REFERENCE = /^[[［]\s*\d+\s*[\]］]\s*\S+/u;

function isFormula(text) {
  return /(?:\b(?:ijt|jt|edu)\b|[=+−∑βγμε]|\b(?:exp|log)\b)/iu.test(text);
}

function bodyFontSize(lines) {
  const prose = lines.filter((line) => line.text.length >= 20 && !isFormula(line.text));
  const sorted = [...(prose.length >= 3 ? prose : lines)].sort(
    (left, right) => left.fontSize - right.fontSize,
  );
  const total = sorted.reduce((sum, line) => sum + Math.max(1, line.text.length), 0);
  let consumed = 0;
  for (const line of sorted) {
    consumed += Math.max(1, line.text.length);
    if (consumed >= total / 2) return line.fontSize;
  }
  return 11;
}

/** @param {any} line @param {boolean} isFirstLine @param {number} bodySize @param {boolean} [continues] the previous line runs on into this one */
function headingFor(line, isFirstLine, bodySize, continues = false) {
  const text = line.text;
  if (isFirstLine && line.fontSize >= 16) return { level: 1, title: true };
  if (REFERENCES.test(text)) return { level: 1, references: true };
  if (isPageNumber(text) || text.length > 180 || isFormula(text)) return null;
  const numbered = /^(\d+(?:\.\d+)*)[.)]?\s+/u.exec(text);
  // Not "0.75，…" (a number wrapped from the line before) or a line that
  // carries on an unfinished sentence.
  if (
    numbered &&
    !continues &&
    !/^0\./u.test(numbered[1]) &&
    !/^[，,。.、；;：:)）%％]/u.test(text.slice(numbered[0].length)) &&
    !/^\d+(?:[.)]|\s|$)/u.test(text.slice(numbered[0].length).trim()) &&
    /[A-Za-z\u3400-\u9fff]/u.test(text)
  )
    return { level: numbered[1].split('.').length };
  const isShort = text.length <= 120 && !/[.!?。！？:：;；]$/u.test(text);
  const isLarger = line.fontSize >= bodySize * 1.28;
  const isBold = line.bold && line.fontSize >= bodySize * 1.1;
  return isShort && (isLarger || isBold) ? { level: 1 } : null;
}

function inferredReferencesPage(lines, floor) {
  if (
    lines.some(
      (line) =>
        line.page >= floor && (REFERENCES.test(line.text) || REFERENCE_PREFIX.test(line.text)),
    )
  )
    return null;
  const counts = new Map();
  for (const line of lines) {
    if (line.page < floor || !BRACKET_REFERENCE.test(line.text)) continue;
    counts.set(line.page, (counts.get(line.page) ?? 0) + 1);
  }
  return (
    [...counts.entries()]
      .filter(([, count]) => count >= 3)
      .sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
  );
}

function joinProse(left, right) {
  if (/[A-Za-z0-9]-$/u.test(left) && /^[a-z]/u.test(right)) return left.slice(0, -1) + right;
  // Chinese runs on across a line break without a space, also next to
  // full-width punctuation or a number.
  const cjk = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/u;
  if (cjk.test(left.at(-1) ?? '') || cjk.test(right[0] ?? '')) return left + right;
  return `${left} ${right}`;
}

/**
 * @param {(import('./pdf-layout.js').PdfLine & {page:number})[]} lines
 * @param {number} pages
 * @returns {import('./types.js').Block[]}
 */
export function blocksFromLines(lines, pages) {
  const bodySize = bodyFontSize(lines);
  const referenceFloor = Math.max(2, Math.floor(pages * 0.55));
  const inferredPage = inferredReferencesPage(lines, referenceFloor);
  const headings = [];
  const blocks = [];
  let inReferences = false;
  let firstPageIndex = 0;
  let previousLine = null;
  for (const line of lines) {
    const isFirstLine = line.page === 1 && firstPageIndex++ === 0;
    const continues =
      blocks.at(-1)?.kind === 'paragraph' &&
      previousLine?.column === line.column &&
      blocks.at(-1).page === line.page &&
      line.top - previousLine.top - previousLine.height <=
        Math.max(12, previousLine.height * 1.4) &&
      !/[.!?。！？:：;；]$/u.test(previousLine.text);
    const heading = headingFor(line, isFirstLine, bodySize, continues);
    const isReferenceHeading = heading?.references && line.page >= referenceFloor;
    const isReferencePrefix = line.page >= referenceFloor && REFERENCE_PREFIX.test(line.text);
    const isInferred =
      inferredPage !== null && line.page >= inferredPage && BRACKET_REFERENCE.test(line.text);
    let kind = 'paragraph';
    if (heading?.title) kind = 'heading';
    else if (isReferenceHeading) {
      kind = 'heading';
      inReferences = true;
    } else if (isReferencePrefix || inReferences || isInferred) kind = 'reference';
    else if (heading) {
      kind = 'heading';
      if (!heading.references) {
        headings.length = Math.max(1, heading.level) - 1;
        headings[heading.level - 1] = line.text;
      }
    }
    const section = headings.filter(Boolean).join(' > ') || null;
    const block = {
      kind,
      text: line.text,
      page: line.page,
      section,
      fontSize: line.fontSize,
      bold: line.bold,
      anchor: {
        page: line.page,
        quote: { exact: line.text.slice(0, 240) },
        rects: [...line.rects],
      },
    };
    const previous = blocks.at(-1);
    const gap =
      previousLine?.column === line.column
        ? line.top - previousLine.top - previousLine.height
        : Infinity;
    if (
      previous?.kind === 'paragraph' &&
      kind === 'paragraph' &&
      previous.page === line.page &&
      previous.section === section &&
      gap <= Math.max(12, previousLine.height * 1.4)
    ) {
      previous.text = joinProse(previous.text, line.text);
      previous.fontSize = Math.max(previous.fontSize, line.fontSize);
      previous.bold ||= line.bold;
      previous.anchor.rects.push(...line.rects);
    } else blocks.push(block);
    previousLine = line;
    if (heading?.title && !headings.length) headings.push(line.text);
  }
  blocks.forEach((block, index) => {
    block.anchor.quote = {
      exact: block.text.slice(0, 240),
      prefix: blocks[index - 1]?.text.slice(-80) ?? '',
      suffix: blocks[index + 1]?.text.slice(0, 80) ?? '',
    };
  });
  return blocks;
}

/**
 * @param {{Title?:string,Author?:string}} info
 * @param {import('./pdf-layout.js').PdfLine[]} lines
 * @param {import('./types.js').Block[]} blocks
 * @returns {import('./types.js').Metadata}
 */
export function pdfMetadata(info, lines, blocks) {
  const firstPage = lines
    .filter((line) => line.page === 1)
    .map((line) => line.text)
    .join('\n');
  const title = cleanText(info?.Title) || blocks.find((block) => block.kind === 'heading')?.text;
  const authors = cleanText(info?.Author)
    .split(/\s*(?:;|\band\b)\s*/iu)
    .filter(Boolean)
    .map((literal) => ({ literal }));
  const doi = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/iu.exec(firstPage)?.[0]?.replace(/[.,;]+$/u, '');
  const arxivId = /\barXiv\s*:?\s*((?:\d{4}\.\d{4,5})(?:v\d+)?|[A-Za-z-]+\/\d{7})\b/iu.exec(
    firstPage,
  )?.[1];
  return {
    ...(title ? { title } : {}),
    ...(authors.length ? { authors } : {}),
    ...(doi ? { doi } : {}),
    ...(arxivId ? { arxivId } : {}),
  };
}
