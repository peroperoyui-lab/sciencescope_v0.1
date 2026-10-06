// SQLite's unicode61 does not segment Chinese. Index overlapping CJK pairs,
// retaining the original text separately for reading and citations.
const WORDS =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}_]+/gu;
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** @param {string} text */
function terms(text) {
  return [...String(text ?? '').matchAll(WORDS)].map(([word]) => {
    if (!CJK.test(word)) return [word.toLowerCase()];
    const chars = [...word];
    return chars.length < 2 ? chars : chars.slice(0, -1).map((char, i) => char + chars[i + 1]);
  });
}

/** @param {string} text */
export function indexText(text) {
  return terms(text).flat().join(' ');
}

/** @param {string} query @param {'all'|'any'} [mode] */
export function matchExpression(query, mode = 'all') {
  return terms(query)
    .map((words) => `"${words.join(' ').replaceAll('"', '""')}"`)
    .join(mode === 'all' ? ' AND ' : ' OR ');
}
