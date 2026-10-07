import { AppError } from '../../core/errors.js';

// Trigger estimates are stable across providers, and never truncate the input.
const CJK =
  /[\u2e80-\u2fff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe30-\ufe4f\u{20000}-\u{2ffff}]/u;

export const DEFAULT_SUMMARY = {
  afterDiscussion: true,
  everyMessages: { enabled: true, n: 20 },
  everyTokens: { enabled: true, n: 30000 },
  onEnterProject: true,
  onLeaveProject: true,
  saveMarkdown: true,
  workbench: { map: 'off', plans: 'off', log: 'off' },
};

/**
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  let cjk = 0;
  let other = 0;
  for (const character of String(text ?? '')) {
    if (CJK.test(character)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

/**
 * @param {any} incoming
 * @returns {typeof DEFAULT_SUMMARY}
 */
export function summarySettings(incoming = {}) {
  return {
    ...DEFAULT_SUMMARY,
    ...incoming,
    everyMessages: { ...DEFAULT_SUMMARY.everyMessages, ...incoming.everyMessages },
    everyTokens: { ...DEFAULT_SUMMARY.everyTokens, ...incoming.everyTokens },
    workbench: { ...DEFAULT_SUMMARY.workbench, ...incoming.workbench },
  };
}

/**
 * @param {import('../../core/messages.js').Message} message
 * @returns {boolean}
 */
export function isEligibleMessage(message) {
  const review = message.refs?.discussion?.kind === 'review';
  return (
    ['done', 'max_tokens'].includes(message.status) &&
    Boolean(message.text.trim()) &&
    message.adopted !== false &&
    (!review || message.adopted === true)
  );
}

export const MINUTES_INSTRUCTIONS = `You maintain the complete research meeting minutes in ScienceScope.
Keep these sections in this order, using the meeting's language:
1. Research questions and goals
2. Decisions and conclusions, with source message numbers such as #42
3. Rejected or superseded options, and why
4. Open questions and disagreements
5. Positions of each participant
6. Manuscript, files and deliverables: paths and current state
7. To-dos and next steps
Keep every still-valid fact from the previous minutes; mark changed decisions.
The user's edits to the previous minutes are authoritative.
Record facts, not your opinions. Do not invent facts absent from the supplied record.
Reply with the complete updated minutes in Markdown only, without a preamble.`;

/**
 * @param {{text:string, throughSeq:number}} previous
 * @param {import('../../core/messages.js').Message[]} messages
 * @param {(id:string)=>string} nameOf
 * @returns {string}
 */
export function summaryInput(previous, messages, nameOf) {
  const blocks = messages.map((message) => {
    const speaker = nameOf(message.authorId);
    const cut =
      message.status === 'max_tokens' ? '\n[This answer reached the model output limit.]' : '';
    return `### Message #${message.seq} (${message.id}) — ${speaker}\n${message.text}${cut}`;
  });
  return `[Previous minutes; cover through #${previous.throughSeq}]\n${previous.text || '(none yet)'}\n[End previous minutes]\n\n[Uncovered meeting messages]\n${blocks.join('\n\n')}\n[End messages]`;
}

/**
 * Keep complete messages. Capacity is the chosen model's declared window;
 * the estimate includes formatting, current minutes, instructions and output.
 * @param {any} prepared
 * @param {{text:string,throughSeq:number}} previous
 * @param {import('../../core/messages.js').Message[]} pending
 * @param {(id:string)=>string} nameOf
 * @returns {import('../../core/messages.js').Message[]}
 */
export function summaryBatch(prepared, previous, pending, nameOf) {
  if (!prepared.contextWindow) return pending;
  const instructionTokens = estimateTokens(`${prepared.prompt}\n\n${MINUTES_INSTRUCTIONS}`);
  const available = prepared.contextWindow - prepared.outputTokens - instructionTokens;
  const batch = [];
  for (const message of pending) {
    const proposed = [...batch, message];
    if (estimateTokens(summaryInput(previous, proposed, nameOf)) > available) break;
    batch.push(message);
  }
  if (!batch.length)
    throw new AppError(
      'MODEL_CONTEXT_EXCEEDED',
      `当前模型上下文容量 ${prepared.contextWindow} token 无法容纳已有纪要及完整消息 #${pending[0].seq}。请选择更大上下文的模型后再次更新。`,
      409,
    );
  return batch;
}
