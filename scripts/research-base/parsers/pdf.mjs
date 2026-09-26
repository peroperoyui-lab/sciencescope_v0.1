import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ParserUnsupported } from './index.mjs';

const DOI_RE = /\b10\.\d{4,9}\/[\-._;()/:A-Z0-9]+/iu;
const ARXIV_RE = /\barXiv\s*:?\s*((?:\d{4}\.\d{4,5})(?:v\d+)?|[A-Za-z\-]+\/\d{7})\b/iu;
const REFERENCE_HEADING_RE = /^(?:references?|bibliography|参考文献|参考资料|引用文献)\s*[:：.]?$/iu;
const BRACKET_REFERENCE_RE = /^[\[［]\s*\d+\s*[\]］]\s*\S+/u;
const PAGE_NUMBER_TOKEN_RE = /^(?:\d{1,4}|[ivxlcdm]{1,8})$/iu;
const PDFJS_BUILD = path.dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')));
// pdfjs' NodeBinaryDataFactory passes these strings to fs.readFile; use a
// forward-slash absolute path with a trailing slash (a file:// URL is not
// accepted by that Node reader).
const localDirectory = (directory) => `${path.resolve(PDFJS_BUILD, directory).replaceAll('\\', '/')}/`;
const PDFJS_CMAPS = localDirectory('../../cmaps');
const PDFJS_STANDARD_FONTS = localDirectory('../../standard_fonts');

function cleanText(value) {
  return String(value ?? '').replace(/\u0000/gu, '').replace(/\s+/gu, ' ').replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/gu, '').trim();
}

// PDF producers sometimes emit a page number as several text items (for
// example `1 2 8`) and sometimes include it in a running header.  These are
// only used for edge/header filtering; body numbers are never removed.
function pageNumberTokens(text) {
  return cleanText(text).replace(/[()[\].,]/gu, ' ').split(/\s+/u).filter(Boolean);
}

function isPageNumberOnly(text) {
  const tokens = pageNumberTokens(text);
  return tokens.length > 0 && tokens.length <= 8 && tokens.every((token) => PAGE_NUMBER_TOKEN_RE.test(token));
}

function repeatedHeaderKey(text) {
  return cleanText(text).toLowerCase().replace(/\d{1,4}/gu, '#').replace(/\s+/gu, ' ').trim();
}

function joinFragments(items) {
  let result = '';
  for (const item of items) {
    const text = cleanText(item);
    if (!text) continue;
    const left = result.replace(/\s+$/u, '');
    const right = text.replace(/^\s+/u, '');
    if (!left) result = right;
    else if (/^[\u3400-\u9fff]/u.test(right) && /[\u3400-\u9fff]$/u.test(left)) result = `${left}${right}`;
    else result = `${left} ${right}`;
  }
  return cleanText(result);
}

function fontSize(item, style) {
  const transform = Array.isArray(item.transform) ? item.transform : [];
  const scale = Math.hypot(Number(transform[0]) || 0, Number(transform[1]) || 0);
  return Math.max(scale, Math.abs(Number(transform[3]) || 0), Number(style?.fontSize) || 0, 1);
}

function isBold(item, style) {
  const value = `${item.fontName ?? ''} ${style?.fontFamily ?? ''}`;
  return /bold|black|semibold/iu.test(value);
}

function lineFromItems(items, pageHeight, pageWidth) {
  const positioned = items.map((item) => {
    const transform = item.transform ?? [];
    const x = Number(transform[4]) || 0;
    const baseline = Number(transform[5]) || 0;
    const size = fontSize(item, item.style);
    const height = Math.max(Math.abs(Number(transform[3]) || 0), size, 1);
    const top = Math.max(0, pageHeight - baseline - height * 0.85);
    return { item, text: cleanText(item.str), x, top, height, size, bold: isBold(item, item.style), width: Math.max(0, Number(item.width) || 0) };
  }).filter((item) => item.text).sort((a, b) => a.top - b.top || a.x - b.x);

  // First form horizontal bands, then split a band at a genuinely large gap.
  // This keeps two columns separate even when their baselines coincide.
  const bands = [];
  for (const item of positioned) {
    const previous = bands.at(-1);
    if (!previous || Math.abs(previous.top - item.top) > Math.max(3, item.height * 0.45)) bands.push({ top: item.top, items: [item] });
    else previous.items.push(item);
  }
  const lines = [];
  for (const band of bands) {
    let segment = [];
    const segments = [];
    for (const item of band.items.sort((a, b) => a.x - b.x)) {
      const previous = segment.at(-1);
      const gap = previous ? item.x - (previous.x + previous.width) : 0;
      const crossesCenter = previous && previous.x < pageWidth / 2 && item.x >= pageWidth / 2;
      const centralThreshold = Math.max(8, Math.min(48, Math.max(previous?.height ?? item.height, item.height) * 1.25));
      if (previous && (gap > Math.max(48, pageWidth * 0.08) || (crossesCenter && gap >= centralThreshold))) {
        segments.push(segment); segment = [];
      }
      segment.push(item);
    }
    if (segment.length) segments.push(segment);
    for (const group of segments) {
      const first = group[0];
      lines.push({
        text: joinFragments(group.map((item) => item.text)),
        top: Math.min(...group.map((item) => item.top)),
        height: Math.max(...group.map((item) => item.height)),
        fontSize: Math.max(...group.map((item) => item.size)),
        bold: group.some((item) => item.bold),
        x: first.x,
        rects: group.map((item) => [item.x, item.top, item.width, item.height]),
      });
    }
  }

  // A large gap between line starts, with enough lines on both sides, is a
  // column boundary. Read the left column top-to-bottom before the right.
  // A table, an indented heading, or a wrapped fragment can introduce many
  // one-off x positions.  Column detection therefore uses repeated start
  // buckets from body-sized lines rather than the largest gap among every
  // unique x coordinate.
  const startBuckets = new Map();
  for (const line of lines) {
    if (line.text.length < 20) continue;
    const bucket = Math.round(line.x / 8) * 8;
    startBuckets.set(bucket, (startBuckets.get(bucket) ?? 0) + 1);
  }
  const starts = [...startBuckets.entries()].filter(([, count]) => count >= 2).map(([start]) => start).sort((a, b) => a - b);
  let boundary;
  let largestGap = 0;
  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];
    if (gap > largestGap) { largestGap = gap; boundary = (starts[index] + starts[index - 1]) / 2; }
  }
  const leftCount = boundary === undefined ? 0 : lines.filter((line) => line.x < boundary).length;
  const rightCount = boundary === undefined ? 0 : lines.filter((line) => line.x >= boundary).length;
  const columns = largestGap > pageWidth * 0.2 && leftCount >= 2 && rightCount >= 2;
  return lines.sort((a, b) => (columns ? Number(a.x >= boundary) - Number(b.x >= boundary) : a.top - b.top || a.x - b.x))
    .map((line) => ({ ...line, column: columns ? Number(line.x >= boundary) : 0 }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 11;
}

function formulaLike(text) {
  return /(?:\b(?:ijt|jt|edu)\b|[=+−∑βγμε]|\b(?:exp|log)\b)/iu.test(text);
}

function weightedMedian(lines) {
  const sorted = [...lines].sort((a, b) => a.fontSize - b.fontSize);
  const total = sorted.reduce((sum, line) => sum + Math.max(1, line.text.length), 0);
  let cumulative = 0;
  for (const line of sorted) {
    cumulative += Math.max(1, line.text.length);
    if (cumulative >= total / 2) return line.fontSize;
  }
  return median(lines.map((line) => line.fontSize));
}

function headingInfo(line, firstPage, firstPageIndex, bodySize) {
  const text = line.text;
  if (firstPage && firstPageIndex === 0 && line.fontSize >= 16) return { level: 1, title: true };
  if (REFERENCE_HEADING_RE.test(text)) return { level: 1, references: true };
  if (isPageNumberOnly(text)) return null;
  if (text.length > 180) return null;
  const match = /^(\d+(?:\.\d+)*)[.)]?\s+/u.exec(text);
  const numberedTail = match ? text.slice(match[0].length).trim() : '';
  if (match && !/^\d+(?:[.)]|\s|$)/u.test(numberedTail) && /[A-Za-z\u3400-\u9fff]/u.test(text) && !formulaLike(text)) return { level: match[1].split('.').length };
  const looksLikeShortHeading = text.length <= 120 && !/[.!?。！？:：;；]$/u.test(text);
  if (formulaLike(text)) return null;
  const relativelyLarge = line.fontSize >= bodySize * 1.28;
  const relativelyBold = line.bold && line.fontSize >= bodySize * 1.1;
  return looksLikeShortHeading && (relativelyLarge || relativelyBold) ? { level: 1 } : null;
}

function quoteFor(text, allTexts, index) {
  return {
    exact: text.slice(0, 240),
    prefix: allTexts[index - 1]?.slice(-80) ?? '',
    suffix: allTexts[index + 1]?.slice(0, 80) ?? '',
  };
}

function metadataFrom(info, lines, blocks) {
  const firstPage = lines.filter((line) => line.page === 1).map((line) => line.text).join('\n');
  const title = cleanText(info?.Title) || blocks.find((block) => block.kind === 'heading')?.text;
  const authorValue = cleanText(info?.Author);
  const authors = authorValue
    ? authorValue.split(/\s*(?:;|\band\b)\s*/iu).map((literal) => ({ literal })).filter((author) => author.literal)
    : [];
  const doi = DOI_RE.exec(firstPage)?.[0]?.replace(/[.,;]+$/u, '');
  const arxivId = ARXIV_RE.exec(firstPage)?.[1]?.replace(/^arXiv:/iu, '');
  return { ...(title ? { title } : {}), ...(authors.length ? { authors } : {}), ...(doi ? { doi } : {}), ...(arxivId ? { arxivId } : {}) };
}

export const pdfParser = {
  id: 'pdf',
  extensions: ['.pdf'],
  async parse(bytes, { name = '' } = {}) {
    const loadingTask = pdfjsLib.getDocument({
      // pdfjs-dist deliberately rejects Node Buffer subclasses; make a plain typed array.
      data: new Uint8Array(bytes),
      disableWorker: true,
      useWorkerFetch: false,
      isEvalSupported: false,
      cMapUrl: PDFJS_CMAPS,
      cMapPacked: true,
      standardFontDataUrl: PDFJS_STANDARD_FONTS,
      useSystemFonts: true,
    });
    let document;
    let primaryError;
    try {
      document = await loadingTask.promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent({ includeMarkedContent: false });
          const styles = content.styles ?? {};
          const items = content.items.map((item) => ({ ...item, style: styles[item.fontName] }));
          pages.push({ page: pageNumber, height: viewport.height, lines: lineFromItems(items, viewport.height, viewport.width) });
        } finally {
          page.cleanup?.();
        }
      }

      const allLines = pages.flatMap((page) => page.lines);
      const textLength = allLines.reduce((total, line) => total + line.text.length, 0);
      if (document.numPages > 0 && textLength < 20) {
        throw new ParserUnsupported(`PDF ${name || '文件'} 是扫描件，未提取文字（OCR 尚未提供）。`);
      }

      const occurrences = new Map();
      for (const page of pages) for (const line of page.lines) {
        const key = repeatedHeaderKey(line.text);
        if (!occurrences.has(key)) occurrences.set(key, new Set());
        occurrences.get(key).add(page.page);
      }
      const filtered = [];
      for (const page of pages) for (const line of page.lines) {
          const key = repeatedHeaderKey(line.text);
          const repeated = (occurrences.get(key)?.size ?? 0) >= 2;
          const edge = line.top < 70 || line.top + line.height > page.height - 60;
          if (!(edge && (repeated || isPageNumberOnly(line.text)))) filtered.push({ ...line, page: page.page });
        }

      const infoResult = await document.getMetadata().catch(() => ({ info: {} }));
      const info = infoResult?.info ?? {};
      const blocks = [];
      const sectionStack = [];
      let inReferences = false;
      const bodyLines = filtered.filter((line) => line.text.length >= 20 && !formulaLike(line.text));
      const bodySize = weightedMedian(bodyLines.length >= 3 ? bodyLines : filtered);
      const referenceFloor = Math.max(2, Math.floor(document.numPages * 0.55));
      const bracketReferencePages = new Map();
      const hasExplicitReferenceMarker = filtered.some((line) => line.page >= referenceFloor && (REFERENCE_HEADING_RE.test(line.text) || /^(?:参考文献|参考资料|引用文献)\s*[:：]/u.test(line.text)));
      for (const line of filtered) {
        if (line.page < referenceFloor || !BRACKET_REFERENCE_RE.test(line.text)) continue;
        bracketReferencePages.set(line.page, (bracketReferencePages.get(line.page) ?? 0) + 1);
      }
      const inferredReferencePage = hasExplicitReferenceMarker ? null : [...bracketReferencePages.entries()]
        .filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      let firstPageIndex = 0;
      for (let index = 0; index < filtered.length; index += 1) {
        const line = filtered[index];
        const firstPage = line.page === 1;
        const pageOneIndex = firstPage ? firstPageIndex++ : -1;
        const heading = headingInfo(line, firstPage, pageOneIndex, bodySize);
        let kind = 'paragraph';
        const referencePrefix = /^(?:参考文献|参考资料|引用文献)\s*[:：]/u.test(line.text);
        const inferredReference = inferredReferencePage !== null && line.page >= inferredReferencePage && BRACKET_REFERENCE_RE.test(line.text);
        const lateReferenceHeading = heading?.references && line.page >= referenceFloor;
        const lateReferencePrefix = referencePrefix && line.page >= referenceFloor;
        if (heading?.title) kind = 'heading';
        else if (lateReferenceHeading) { kind = 'heading'; inReferences = true; }
        else if (lateReferencePrefix) kind = 'reference';
        else if (heading?.references) kind = 'heading';
        else if (inReferences || inferredReference) { kind = 'reference'; }
        else if (heading) {
          kind = 'heading';
          const level = Math.max(1, heading.level);
          sectionStack.splice(level - 1);
          sectionStack[level - 1] = line.text;
        } else if (inReferences) kind = 'reference';
        const section = sectionStack.filter(Boolean).join(' > ') || undefined;
        const text = line.text;
        const candidate = { kind, text, page: line.page, fontSize: line.fontSize, bold: line.bold, _line: line, ...(section ? { section } : {}), anchor: {
          page: line.page,
          quote: { exact: text.slice(0, 240) },
          rects: line.rects,
        } };
        const previous = blocks.at(-1);
        const gap = previous?._line?.column === line.column ? line.top - previous._line.top - previous._line.height : Infinity;
        if (previous && previous.kind === 'paragraph' && kind === 'paragraph' && previous.page === candidate.page && previous.section === candidate.section && previous._line?.column === line.column && gap <= Math.max(12, previous._line.height * 1.4)) {
          const join = /[A-Za-z0-9]-$/u.test(previous.text) && /^[a-z]/u.test(candidate.text) ? `${previous.text.slice(0, -1)}${candidate.text}`
            : /[\u3400-\u9fff]$/u.test(previous.text) && /^[\u3400-\u9fff]/u.test(candidate.text) ? `${previous.text}${candidate.text}` : `${previous.text} ${candidate.text}`;
          previous.text = join;
          previous.fontSize = Math.max(previous.fontSize, candidate.fontSize);
          previous.bold ||= candidate.bold;
          previous.anchor.rects.push(...candidate.anchor.rects);
          previous._line = line;
        } else blocks.push(candidate);
        if (heading?.title && !sectionStack.length) sectionStack.push(line.text);
      }
      const blockTexts = blocks.map((block) => block.text);
      blocks.forEach((block, index) => {
        block.anchor.quote = quoteFor(block.text, blockTexts, index);
        delete block._line;
      });
      const metadata = metadataFrom(info, filtered, blocks);
      return { blocks, pages: document.numPages, metadata };
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try { await document?.cleanup?.(); } catch {}
      try { await loadingTask.destroy?.(); } catch (error) { if (!primaryError) throw error; }
    }
  },
};
