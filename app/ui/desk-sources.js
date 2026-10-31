// 「来源」 in the desk (components/desk-sources.js): the sources a document
// uses, from its indexes and from the answers in its bound chat (the whole
// chat, as GET /api/meetings/:id/sources lists it), one row per source with
// every place that uses it.

const EMPTY = [];
const SCRIPT = /\.(py|r|do|jl|sh|ps1|ipynb|m|sas|sps)$/iu;
const TABLE = /\.(csv|tsv|xlsx?|dta|sav|parquet)$/iu;

/** The source a reference names, as a row key, its group and its icon. @param {any} reference */
export function sourceOf(reference) {
  if (reference.kind === 'project-file' || reference.kind === 'script')
    return {
      key: `file:${reference.path}`,
      group: 'files',
      icon:
        reference.kind === 'script' || SCRIPT.test(reference.path ?? '')
          ? 'file-code'
          : TABLE.test(reference.path ?? '')
            ? 'table-2'
            : 'file-text',
      title: reference.path ?? reference.label,
    };
  if (reference.kind === 'version')
    return {
      key: `version:${reference.id}`,
      group: 'files',
      icon: 'git-branch',
      title: reference.label ?? reference.id,
    };
  if (reference.kind === 'source' || reference.kind === 'chunk')
    return {
      key: `source:${reference.sourceId ?? reference.id}`,
      group: 'library',
      icon: 'book-open',
      title: reference.label ?? reference.id,
    };
  if (reference.kind === 'item')
    return {
      key: `item:${reference.id}`,
      group: 'items',
      icon: 'waypoints',
      title: reference.label ?? reference.id,
    };
  return {
    key: `message:${reference.id}`,
    group: 'messages',
    icon: 'message-square',
    title: reference.label ?? reference.id,
  };
}

/** The sentence of `text` that cites `label` (S3), or its start. @param {string} text @param {string | null} label */
export function citingSentence(text, label) {
  const plain = text.replace(/\s+/gu, ' ').trim();
  const sentences = plain.split(/(?<=[。！？!?；;])\s*|(?<=\.)\s+/u);
  const found = label ? sentences.find((sentence) => sentence.includes(label)) : null;
  const sentence = (found ?? sentences[0] ?? '').replace(/\s*\[S\d+[^\]]*\]/gu, '').trim();
  const chars = Array.from(sentence);
  return chars.length > 80 ? `${chars.slice(0, 80).join('')}…` : sentence;
}

/**
 * Sources from the document's indexes and the chat's answers, merged by source.
 * @param {any[]} indexes root index items of the open document
 * @param {any[]} chat the bound chat's sources: `{sourceId, title, pages, uses:
 *   [{messageId, authorId, createdAt, label}]}`, newest use first
 * @param {any[]} messages the chat's loaded messages, for the citing sentences
 */
export function collectSources(indexes, chat, messages = EMPTY) {
  /** @type {Map<string, any>} */
  const rows = new Map();
  const row = (source, reference) => {
    const known = rows.get(source.key);
    if (known) return known;
    const fresh = { ...source, reference, pages: new Set(), uses: [], index: false, chat: false };
    rows.set(source.key, fresh);
    return fresh;
  };
  for (const item of indexes)
    for (const reference of item.sources ?? []) {
      const entry = row(sourceOf(reference), reference);
      entry.index = true;
      if (reference.page) entry.pages.add(reference.page);
      if (!entry.uses.some((use) => use.item?.id === item.id))
        entry.uses.push({ kind: 'index', item });
    }
  const loaded = new Map(messages.map((message) => [message.id, message]));
  for (const used of chat) {
    const reference = { schema: 1, kind: 'source', id: used.sourceId, label: used.title };
    const entry = row(sourceOf(reference), reference);
    entry.chat = true;
    if (entry.title === used.sourceId && used.title) entry.title = used.title;
    for (const page of used.pages ?? EMPTY) entry.pages.add(page);
    for (const use of used.uses ?? EMPTY) {
      if (entry.uses.some((known) => known.message?.id === use.messageId)) continue;
      const message = loaded.get(use.messageId) ?? {
        id: use.messageId,
        authorId: use.authorId,
        createdAt: use.createdAt,
      };
      entry.uses.push({
        kind: 'chat',
        message,
        quote: message.text ? citingSentence(message.text, use.label) : '',
      });
    }
  }
  return [...rows.values()];
}
