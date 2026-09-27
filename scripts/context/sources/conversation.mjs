import { ContextAccessError } from '../policy.mjs';
import { READ_CHARS, READ_LIMIT, checkScopeTarget, databaseOf } from './_shared.mjs';

export const id = 'conversation';
export const sections = Object.freeze([]);
export const describe = (_role) => 'Read the numbered Main conversation. Search returns bounded excerpts; from/to returns complete messages within the read bound.';

export function createConversationSource({ db, minutes }) {
  const database = databaseOf({ db });
  if (!minutes?.messagesAfter || !minutes?.format) throw new TypeError('minutes.messagesAfter and minutes.format are required.');
  function read(scope, args = {}) {
    const target = checkScopeTarget(database, scope.role, scope.ctx, args);
    if (!target.chatId) throw new ContextAccessError('CHAT_REQUIRED', 'Specify chatId when the global assistant recalls a conversation.');
    const all = minutes.messagesAfter(target.chatId, 0);
    if (Number.isInteger(args.from) || Number.isInteger(args.to)) {
      const from = Math.max(1, Number.isInteger(args.from) ? args.from : args.to);
      const to = Number.isInteger(args.to) ? args.to : from + READ_LIMIT - 1;
      if (to < from) throw new ContextAccessError('INVALID_RANGE', 'to must be greater than or equal to from.');
      const picked = []; let size = 0;
      for (const message of all) {
        if (message.ordinal < from || message.ordinal > to) continue;
        const block = minutes.format(message);
        if (picked.length && (picked.length >= READ_LIMIT || size + block.length > READ_CHARS)) break;
        picked.push({ message, block }); size += block.length;
      }
      const last = picked.at(-1)?.message.ordinal;
      const more = last !== undefined && all.some((message) => message.ordinal > last && message.ordinal <= to);
      return { messages: picked.map((item) => item.block).join('\n'), count: picked.length, ...(more ? { next: { from: last + 1, to } } : {}), totalMessages: all.length, lastNumber: all.at(-1)?.ordinal ?? 0 };
    }
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (!query || query.length > 400) throw new ContextAccessError('INVALID_QUERY', 'Give query (1–400 characters) or from/to message numbers.');
    const terms = [...new Set(query.toLocaleLowerCase().split(/\s+/u).filter(Boolean))].slice(0, 12);
    const limit = Math.min(Math.max(1, Number.isInteger(args.limit) ? args.limit : 12), 30);
    const scored = all.map((message) => {
      const text = message.text.toLocaleLowerCase();
      return { message, hits: terms.filter((term) => text.includes(term)).length, text };
    }).filter((item) => item.hits > 0).sort((a, b) => b.hits - a.hits || b.message.ordinal - a.message.ordinal).slice(0, limit);
    return {
      results: scored.map(({ message, text }) => {
        const index = Math.max(0, text.indexOf(terms.find((term) => text.includes(term)) ?? ''));
        return { n: message.ordinal, speaker: message.speaker, excerpt: message.text.slice(Math.max(0, index - 200), Math.max(0, index - 200) + 600) };
      }),
      hint: 'These are deliberate search excerpts. Read a whole message or its neighbours with chat_recall({from:n, to:n+2}).',
      totalMessages: all.length,
    };
  }
  return { id, sections, describe, read };
}

export default { id, sections, describe, create: createConversationSource };
