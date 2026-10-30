// 「来源」 in the desk (components/desk-sources.js): the sources a document
// uses, from its indexes and from the answers in its bound chat, one row per
// source with every place that uses it.
import { usedSources } from './turn-sources.js';

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
 * @param {any[]} messages the bound chat's loaded messages
 * @param {Record<string, any[]>} toolCalls tool calls by turn id
 */
export function collectSources(indexes, messages, toolCalls) {
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
  for (const message of messages) {
    if (!message.turnId || message.status === 'streaming') continue;
    for (const used of usedSources(toolCalls[message.turnId] ?? EMPTY, message.text ?? '')) {
      const reference = { schema: 1, kind: 'source', id: used.id, label: used.title };
      const entry = row(sourceOf(reference), reference);
      entry.chat = true;
      if (entry.title === used.id && used.title) entry.title = used.title;
      for (const page of used.pages) entry.pages.add(page);
      entry.uses.push({
        kind: 'chat',
        message,
        quote: citingSentence(message.text ?? '', used.label),
      });
    }
  }
  return [...rows.values()];
}
