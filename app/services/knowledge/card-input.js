import { createHash } from 'node:crypto';
import { estimateTokens } from '../secretary/policy.js';
import { CARD_LISTS } from './card-prompt.js';

export const CARD_INPUT_TOKENS = 6000;
// Abstract first: it states the question and findings in the fewest tokens.
export const CARD_SECTIONS = [
  'abstract',
  '摘要',
  'method',
  'methodology',
  'materials',
  'data',
  'result',
  'discussion',
  'conclusion',
  '方法',
  '材料',
  '数据',
  '结果',
  '讨论',
  '结论',
];

/**
 * Both queue layers use the same parsed-content identity.
 * @param {any[]} chunks
 * @returns {string}
 */
export function paragraphHash(chunks) {
  return createHash('sha256')
    .update(
      JSON.stringify(chunks.map((chunk) => [chunk.kind, chunk.section, chunk.page, chunk.text])),
    )
    .digest('hex');
}

/**
 * Select whole paragraphs by section priority; the target never cuts a paragraph.
 * @param {any} source
 * @param {any[]} chunks
 * @returns {any}
 */
export function cardInput(source, chunks) {
  const body = chunks.filter(
    (chunk) =>
      chunk.kind !== 'reference' &&
      !/references|bibliography|参考文献|引用文献/iu.test(chunk.section ?? ''),
  );
  const rank = (chunk) => {
    const section = String(chunk.section ?? '').toLowerCase();
    const index = CARD_SECTIONS.findIndex((name) => section.includes(name));
    return index < 0 ? CARD_SECTIONS.length : index < 2 ? 0 : 1;
  };
  // Abstract, then method/data/result/conclusion sections, then the rest in order.
  const ranked = [...body].sort((a, b) => rank(a) - rank(b) || a.ordinal - b.ordinal);
  const selected = [];
  let tokens = estimateTokens(JSON.stringify(source.metadata ?? {}) + source.title);
  for (const chunk of ranked) {
    if (selected.length && tokens >= CARD_INPUT_TOKENS) break;
    selected.push(chunk);
    tokens += estimateTokens(chunk.text);
  }
  selected.sort((a, b) => a.ordinal - b.ordinal);
  return {
    sourceId: source.id,
    title: source.title,
    metadata: source.metadata,
    paragraphs: selected.map(({ id, page, section, text }) => ({
      chunkId: id,
      page,
      section,
      text,
    })),
    selection: { total: body.length, included: selected.length, estimatedTokens: tokens },
  };
}

const punctuation = {
  '。': '.',
  '、': ',',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '【': '[',
  '】': ']',
};
const normalizedQuote = (text) =>
  text
    .normalize('NFKC')
    .replace(/[。、“”‘’【】]/gu, (c) => punctuation[c])
    .replace(/\s/gu, '');

/**
 * Validate against the actual request, not other passages in the same source.
 * @param {any} output
 * @param {any} input
 * @returns {{card:any,dropped:any[]}}
 */
export function verifyCard(output, input) {
  /** @type {Map<string, any>} */
  const paragraphs = new Map(input.paragraphs.map((row) => [row.chunkId, row]));
  const dropped = [];
  function entry(value, field, textKey) {
    const reject = (reason) => {
      dropped.push({ field, item: value, reason });
      return null;
    };
    if (!value || typeof value[textKey] !== 'string' || !value[textKey].trim())
      return reject('missing-text');
    const evidence = [].concat(value.evidence ?? []);
    if (!evidence.length) return reject('missing-evidence');
    const verified = [];
    for (const quote of evidence) {
      const paragraph = paragraphs.get(quote?.chunkId);
      if (!paragraph) return reject('chunk-not-in-input');
      if (typeof quote.quote !== 'string' || !quote.quote.trim()) return reject('missing-quote');
      if (
        !paragraph.text.includes(quote.quote) &&
        !normalizedQuote(paragraph.text).includes(normalizedQuote(quote.quote))
      )
        return reject('quote-not-found');
      verified.push({ chunkId: quote.chunkId, quote: quote.quote, page: paragraph.page });
    }
    return { ...value, evidence: verified };
  }
  /** @type {any} */
  const card = { question: output.question ? entry(output.question, 'question', 'text') : null };
  for (const field of CARD_LISTS) {
    card[field] = [];
    for (const value of [].concat(output[field] ?? [])) {
      const verified = entry(value, field, field === 'findings' ? 'text' : 'name');
      if (verified) card[field].push(verified);
    }
  }
  return { card, dropped };
}
