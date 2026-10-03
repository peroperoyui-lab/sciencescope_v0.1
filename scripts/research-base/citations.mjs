// Shared by the host, desktop citation chips and evaluation. This module is
// deliberately pure: a recognized label is syntax, never proof of a source.
const MAX_LABEL_CHARS = 2048;
const MAX_CITATIONS = 32;
const WRAPPERS = new Map([['[', ']'], ['［', '］'], ['【', '】'], ['(', ')'], ['（', '）']]);
const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const normalizeSyntax = value => value.replace(/[！-～]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

/** Parse one explicit citation group without discarding unknown members. */
export function parseCitationLabel(value) {
  const raw = typeof value === 'string' ? value : '';
  const citations = []; const unrecognized = [];
  const unknown = (text, reason = 'unsupported-format') => unrecognized.push({ raw: text, reason });
  if (!raw.trim() || raw.length > MAX_LABEL_CHARS) {
    unknown(raw, raw.length > MAX_LABEL_CHARS ? 'label-too-long' : 'empty-label');
    return { raw, citations, parseStatus: 'unrecognized', unrecognized };
  }
  let body = raw.trim();
  const closing = WRAPPERS.get(body[0]);
  if (closing) {
    if (!body.endsWith(closing)) {
      unknown(raw); return { raw, citations, parseStatus: 'unrecognized', unrecognized };
    }
    body = body.slice(1, -1);
  }
  const members = body.split(/[;；]|[,，](?=\s*(?:S\d|@))/iu);
  if (members.length > MAX_CITATIONS) {
    unknown(raw, 'too-many-citations');
    return { raw, citations, parseStatus: 'unrecognized', unrecognized };
  }
  for (const member of members) {
    const text = member.trim();
    // Only these narrow punctuation variants are normalized. Original text
    // stays alongside every member, including invalid or reversed ranges.
    const normalized = normalizeSyntax(text);
    const source = /^S([1-9]\d*)(?:\s*,?\s*(?:p\.?\s*(\d+)(?:\s*[-–—]\s*(\d+))?|(?:第)?(\d+)(?:\s*[-–—]\s*(\d+))?\s*页))?$/iu.exec(normalized.replace(/，/gu, ','));
    if (source) {
      const number = Number(source[1]);
      const fromPage = source[2] ?? source[4]; const toPage = source[3] ?? source[5] ?? fromPage;
      if (!positiveInteger(number) || (fromPage && (!positiveInteger(fromPage) || !positiveInteger(toPage) || Number(toPage) < Number(fromPage)))) {
        unknown(text, 'invalid-number-or-range'); continue;
      }
      const start = fromPage ? Number(fromPage) : null; const end = toPage ? Number(toPage) : null;
      const label = `S${number}`;
      citations.push({ kind: 'source', label, number, page: start === end ? start : null, fromPage: start, toPage: end, raw: text,
        normalized: `[${label}${start ? ` p.${start}${end !== start ? `–${end}` : ''}` : ''}]` });
      continue;
    }
    const item = /^@([0-9a-f]{6,20})$/u.exec(normalized);
    if (item) { citations.push({ kind: 'item', handle: item[1], raw: text, normalized: `[@${item[1]}]` }); continue; }
    unknown(text);
  }
  return { raw, citations, parseStatus: unrecognized.length ? (citations.length ? 'partial' : 'unrecognized') : 'parsed', unrecognized };
}

/** Locate explicit S/@ groups in prose. Numeric bibliographies are untouched. */
export function extractCitationLabels(value) {
  if (typeof value !== 'string') return [];
  const results = [];
  // Capture explicit malformed wrappers as candidates too. The parser decides
  // validity, so unknown labels remain inspectable without guessing a source.
  const groups = /[\[［【(（][^\[\]［］【】()（）\r\n]*[\]］】)）]/gu;
  for (const match of value.matchAll(groups)) {
    if (!/^\s*(?:S[\d⁰¹²³⁴⁵⁶⁷⁸⁹]|@)/iu.test(normalizeSyntax(match[0].slice(1, -1)))) continue;
    results.push({ ...parseCitationLabel(match[0]), start: match.index, end: match.index + match[0].length });
  }
  return results;
}
