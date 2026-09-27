import { checkScopeTarget, databaseOf } from './_shared.mjs';

export const id = 'minutes';
export const sections = Object.freeze(['minutes']);
export const describe = (_role) => 'Read the latest version of conversation minutes, including coverage metadata.';

export function createMinutesSource({ db, minutes }) {
  const database = databaseOf({ db });
  return { id, sections, describe, read(scope, args = {}) {
    const target = checkScopeTarget(database, scope.role, scope.ctx, args);
    if (!target.chatId) return { minutes: null, latestMessage: 0, note: 'No conversation was selected.' };
    const value = minutes.get(target.chatId);
    const total = minutes.messagesAfter(target.chatId, 0).at(-1)?.ordinal ?? 0;
    return value
      ? { minutes: value.text, revision: value.revision, by: value.author, coversThrough: value.throughOrdinal, latestMessage: total, ...(value.throughOrdinal < total ? { note: `Messages after #${value.throughOrdinal} are not in the minutes yet; read them with chat_recall.` } : {}) }
      : { minutes: null, latestMessage: total, note: 'No minutes yet; read the conversation with chat_recall.' };
  } };
}

export default { id, sections, describe, create: createMinutesSource };
