import { cleanText } from './text-utils.js';

/**
 * @typedef {{text:string,x:number,top:number,height:number,fontSize:number,
 * bold:boolean,rects:number[][],column:number,page?:number}} PdfLine
 */

function normalizeText(text) {
  return cleanText(text).replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/gu, '');
}

function positionedItem(item, styles, pageHeight) {
  const transform = item.transform ?? [];
  const style = styles[item.fontName];
  const size = Math.max(
    Math.hypot(transform[0] ?? 0, transform[1] ?? 0),
    Math.abs(transform[3] ?? 0),
    style?.fontSize ?? 0,
    1,
  );
  return {
    text: normalizeText(item.str),
    x: transform[4] ?? 0,
    top: Math.max(0, pageHeight - (transform[5] ?? 0) - size * 0.85),
    height: size,
    size,
    width: Math.max(0, item.width ?? 0),
    bold: /bold|black|semibold/iu.test(`${item.fontName} ${style?.fontFamily}`),
  };
}

function splitBand(items, pageWidth) {
  const segments = [];
  let current = [];
  for (const item of items.sort((left, right) => left.x - right.x)) {
    const previous = current.at(-1);
    const gap = previous ? item.x - previous.x - previous.width : 0;
    const crossesCenter = previous && previous.x < pageWidth / 2 && item.x >= pageWidth / 2;
    const gutter = Math.max(
      8,
      Math.min(48, Math.max(previous?.height ?? item.height, item.height) * 1.25),
    );
    if (previous && (gap > Math.max(48, pageWidth * 0.08) || (crossesCenter && gap >= gutter))) {
      segments.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) segments.push(current);
  return segments;
}

// Items that touch join as they are: Word writes a number and the
// full-width comma after it as two items, which must not gain a space.
function joinItems(items) {
  let text = '';
  items.forEach((item, index) => {
    const previous = items[index - 1];
    const gap = previous ? item.x - previous.x - previous.width : 0;
    const touching = previous && previous.width > 0 && gap < item.size * 0.15;
    text += (index && !touching ? ' ' : '') + item.text;
  });
  return text;
}

function lineFromSegment(items) {
  return {
    text: normalizeText(joinItems(items)),
    top: Math.min(...items.map((item) => item.top)),
    height: Math.max(...items.map((item) => item.height)),
    fontSize: Math.max(...items.map((item) => item.size)),
    bold: items.some((item) => item.bold),
    x: items[0].x,
    rects: items.map((item) => [item.x, item.top, item.width, item.height]),
  };
}

function columnBoundary(lines, pageWidth) {
  const buckets = new Map();
  for (const line of lines) {
    if (line.text.length < 20) continue;
    const start = Math.round(line.x / 8) * 8;
    buckets.set(start, (buckets.get(start) ?? 0) + 1);
  }
  const starts = [...buckets.entries()]
    .filter(([, count]) => count >= 2)
    .map(([start]) => start)
    .sort((left, right) => left - right);
  let boundary;
  let largestGap = 0;
  for (let index = 1; index < starts.length; index += 1) {
    const gap = starts[index] - starts[index - 1];
    if (gap > largestGap) {
      largestGap = gap;
      boundary = (starts[index] + starts[index - 1]) / 2;
    }
  }
  if (largestGap <= pageWidth * 0.2) return null;
  const leftCount = lines.filter((line) => line.x < boundary).length;
  const rightCount = lines.length - leftCount;
  return leftCount >= 2 && rightCount >= 2 ? boundary : null;
}

/**
 * Position bands keep coincident baselines separate at the central gutter.
 * @param {import('pdfjs-dist/types/src/display/api.js').TextContent} content
 * @param {{height:number,width:number}} viewport
 * @returns {PdfLine[]}
 */
export function readPageLines(content, viewport) {
  const items = content.items
    .filter((item) => 'str' in item)
    .map((item) => positionedItem(item, content.styles, viewport.height))
    .filter((item) => item.text)
    .sort((left, right) => left.top - right.top || left.x - right.x);
  const bands = [];
  for (const item of items) {
    const previous = bands.at(-1);
    if (!previous || Math.abs(previous.top - item.top) > Math.max(3, item.height * 0.45)) {
      bands.push({ top: item.top, items: [item] });
    } else previous.items.push(item);
  }
  const lines = bands.flatMap((band) => splitBand(band.items, viewport.width).map(lineFromSegment));
  const boundary = columnBoundary(lines, viewport.width);
  return lines
    .map((line) => ({ ...line, column: boundary === null ? 0 : Number(line.x >= boundary) }))
    .sort((left, right) => left.column - right.column || left.top - right.top || left.x - right.x);
}

/** @param {string} text @returns {boolean} */
export function isPageNumber(text) {
  const tokens = cleanText(text)
    .replace(/[()[\].,]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.length <= 8 &&
    tokens.every((token) => /^(?:\d{1,4}|[ivxlcdm]{1,8})$/iu.test(token))
  );
}

/**
 * A line followed or preceded in its column at body line spacing is body
 * text, even near the page edge (the first line of a column under a
 * running header sits there).
 * @param {{lines:PdfLine[]}} page @param {PdfLine} line
 */
function inParagraph(page, line) {
  return page.lines.some(
    (other) =>
      other !== line &&
      other.column === line.column &&
      Math.abs(other.fontSize - line.fontSize) < 0.5 &&
      Math.abs(other.top - line.top) <= line.height * 1.8,
  );
}

/**
 * @param {{page:number,height:number,lines:PdfLine[]}[]} pages
 * @returns {(PdfLine & {page:number})[]}
 */
export function removeRunningEdges(pages) {
  const occurrences = new Map();
  const headerKey = (text) =>
    cleanText(text)
      .toLowerCase()
      .replace(/\d{1,4}/gu, '#');
  for (const page of pages) {
    for (const line of page.lines) {
      const key = headerKey(line.text);
      if (!occurrences.has(key)) occurrences.set(key, new Set());
      occurrences.get(key).add(page.page);
    }
  }
  return pages.flatMap((page) =>
    page.lines
      .filter((line) => {
        const edge = line.top < 70 || line.top + line.height > page.height - 60;
        const repeated = occurrences.get(headerKey(line.text)).size >= 2;
        return !(edge && (isPageNumber(line.text) || (repeated && !inParagraph(page, line))));
      })
      .map((line) => ({ ...line, page: page.page })),
  );
}
