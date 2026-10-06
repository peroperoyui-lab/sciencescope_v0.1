// A label is a locator, not proof. Unknown spellings retain their original text.
/** @param {string} value */
export function parseCitationLabel(value) {
  const raw = String(value ?? '');
  let body = raw.trim();
  const closing = new Map([
    ['[', ']'],
    ['［', '］'],
    ['【', '】'],
    ['(', ')'],
    ['（', '）'],
  ]).get(body[0]);
  const citations = [];
  const unrecognized = [];
  if (closing) {
    if (!body.endsWith(closing)) {
      return {
        raw,
        citations,
        unrecognized: [{ raw, reason: 'unsupported-format' }],
        parseStatus: 'unrecognized',
      };
    }
    body = body.slice(1, -1);
  }
  for (const member of body.split(/[;；]|[,，](?=\s*(?:[SＳ][0-9０-９]|[@＠]))/iu)) {
    const text = member.trim();
    const normalized = text.replace(/[！-～]/gu, (character) =>
      String.fromCharCode(character.charCodeAt(0) - 0xfee0),
    );
    const item = /^@([0-9a-f]{6,20})$/iu.exec(normalized);
    if (item) {
      citations.push({ kind: 'item', handle: item[1], raw: text, normalized: `[@${item[1]}]` });
      continue;
    }
    const match =
      /^S([1-9]\d*)(?:\s*[,，]?\s*(?:p\.?\s*([1-9]\d*)(?:\s*[-–—]\s*([1-9]\d*))?|第?([1-9]\d*)(?:\s*[-–—]\s*([1-9]\d*))?\s*页))?$/iu.exec(
        normalized,
      );
    if (!match) {
      unrecognized.push({ raw: text, reason: 'unsupported-format' });
      continue;
    }
    const number = Number(match[1]);
    const fromPage = match[2] || match[4] ? Number(match[2] ?? match[4]) : null;
    const toPage = match[3] || match[5] ? Number(match[3] ?? match[5]) : fromPage;
    if (
      !Number.isSafeInteger(number) ||
      (fromPage &&
        (!Number.isSafeInteger(fromPage) || !Number.isSafeInteger(toPage) || toPage < fromPage))
    ) {
      unrecognized.push({ raw: text, reason: 'invalid-number-or-range' });
      continue;
    }
    const label = `S${number}`;
    citations.push({
      kind: 'source',
      label,
      number,
      page: fromPage === toPage ? fromPage : null,
      fromPage,
      toPage,
      raw: text,
      normalized: `[${label}${fromPage ? ` p.${fromPage}${toPage !== fromPage ? `–${toPage}` : ''}` : ''}]`,
    });
  }
  return {
    raw,
    citations,
    unrecognized,
    parseStatus: unrecognized.length ? (citations.length ? 'partial' : 'unrecognized') : 'parsed',
  };
}

/** @param {string} text @returns {Array<ReturnType<typeof parseCitationLabel> & {start:number,end:number}>} */
export function extractCitationLabels(text) {
  const labels = [];
  for (const match of String(text ?? '').matchAll(
    /[[［【(（][^[\]［］【】()（）\r\n]*[\]］】)）]/gu,
  )) {
    if (!/^\s*(?:[SＳ][0-9０-９]|[@＠])/iu.test(match[0].slice(1, -1))) continue;
    labels.push({
      ...parseCitationLabel(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return labels;
}

/** @param {{number:number}} source @param {{page?:number|null}} [chunk] */
export function citationFor(source, chunk) {
  return `[S${source.number}${chunk?.page ? ` p.${chunk.page}` : ''}]`;
}
