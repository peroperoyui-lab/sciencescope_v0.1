// A deliberately stable, provider-independent estimate for trigger budgets.
// CJK code points are counted one-for-one; other code points are grouped four
// to a token. This is a budget signal, not a tokenizer or a billing number.
const CJK = /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\u{20000}-\u{2ffff}]/u;

export function estimateTokens(text) {
  const value = String(text ?? '');
  let cjk = 0;
  let other = 0;
  for (const character of value) {
    if (CJK.test(character)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

export default estimateTokens;
