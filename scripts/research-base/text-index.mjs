// Full-text indexing for mixed Chinese / Latin research text on stock SQLite
// FTS5 (no extension). Latin words go to the unicode61 tokenizer as-is; runs of
// CJK characters are rewritten as overlapping bigrams ("间歇性禁食" → "间歇 歇性
// 性禁 禁食"), the approach of Lucene's CJKAnalyzer. A query is rewritten the
// same way and each CJK run becomes a phrase of consecutive bigrams, so two-
// character words such as "禁食" match (the FTS5 trigram tokenizer cannot).
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WORD = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])[\p{L}\p{N}_])+/gu;
const IS_CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function bigrams(run) {
  const chars = [...run];
  if (chars.length < 2) return chars;
  const out = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** Text as stored in the FTS index (not for display). */
export function indexText(text) {
  const out = [];
  for (const match of String(text ?? '').matchAll(WORD)) {
    const token = match[0];
    if (IS_CJK.test(token)) out.push(...bigrams(token)); else out.push(token.toLowerCase());
  }
  return out.join(' ');
}

/** Query terms: CJK runs keep their bigram list (matched as a phrase). */
export function queryTerms(query) {
  const terms = [];
  for (const match of String(query ?? '').matchAll(WORD)) {
    const token = match[0];
    if (IS_CJK.test(token)) terms.push({ cjk: true, text: token, grams: bigrams(token) });
    else if (token.length > 1 || /\d/u.test(token)) terms.push({ cjk: false, text: token.toLowerCase(), grams: [token.toLowerCase()] });
  }
  return terms.slice(0, 24);
}

const quote = (gram) => `"${gram.replaceAll('"', '""')}"`;
/** FTS5 MATCH expression; mode 'all' (AND) or 'any' (OR). Null when empty. */
export function matchExpression(query, mode = 'all') {
  const parts = queryTerms(query).map((term) => term.grams.length > 1 ? `"${term.grams.map((g) => g.replaceAll('"', '""')).join(' ')}"` : quote(term.grams[0]));
  if (!parts.length) return null;
  return parts.join(mode === 'all' ? ' AND ' : ' OR ');
}

/** A short excerpt of the ORIGINAL text around the first query hit. */
export function snippet(text, query, width = 160) {
  const source = String(text ?? '');
  const lower = source.toLowerCase();
  let at = -1; let hit = '';
  for (const term of queryTerms(query)) {
    const needle = term.cjk ? term.text : term.text;
    let index = lower.indexOf(needle.toLowerCase());
    if (index < 0 && term.cjk && term.grams.length) index = lower.indexOf(term.grams[0]);
    if (index >= 0 && (at < 0 || index < at)) { at = index; hit = needle; }
  }
  if (at < 0) return source.slice(0, width).replace(/\s+/gu, ' ').trim() + (source.length > width ? '…' : '');
  const start = Math.max(0, at - Math.floor((width - hit.length) / 2));
  const end = Math.min(source.length, start + width);
  return `${start > 0 ? '…' : ''}${source.slice(start, end).replace(/\s+/gu, ' ').trim()}${end < source.length ? '…' : ''}`;
}

export { CJK_RUN };
