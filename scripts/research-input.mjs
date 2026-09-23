const MAX_TEXT = 64000;
const MAX_ATTACHMENTS = 8;
const MAX_ANNOTATIONS = 32;
const MAX_QUOTES = 16;
const MAX_SELECTED = 8000;
const MAX_MATERIAL = 128000;
const MAX_COMMENT = 8000;

class ResearchInputError extends Error {
  constructor(message) { super(message); this.name = 'ResearchInputError'; this.code = 'INVALID_RESEARCH_INPUT'; }
}
const invalid = (message) => { throw new ResearchInputError(message); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const string = (v, name) => typeof v === 'string' && v.length ? v : invalid(`Invalid ${name}`);
const array = (v, name) => Array.isArray(v) ? v : invalid(`Invalid ${name}`);

function idsOf(value, name) {
  const ids = array(value ?? [], name);
  if (ids.length > MAX_ATTACHMENTS || ids.some((id) => typeof id !== 'string' || !id.length)) invalid(`Invalid ${name}`);
  return [...new Set(ids)];
}

async function readSourceMessage(chatStore, chatId, messageId) {
  if (!chatStore) invalid('chatStore is required');
  // ChatStore's database query is deliberately point lookup; do not page/scan history.
  const db = chatStore.db?.db ?? chatStore.database?.db;
  if (db?.prepare) {
    if (typeof chatStore.getChat === 'function') {
      let chat;
      try { chat = chatStore.getChat(chatId); } catch { return undefined; }
      if (!chat || chat.deletedAt) return undefined;
    }
    const chat = db.prepare('SELECT id,deleted_at FROM chats WHERE id=?').get(chatId);
    if (!chat || chat.deleted_at) return undefined;
    return db.prepare('SELECT id,role,text FROM messages WHERE chat_id=? AND id=?').get(chatId, messageId);
  }
  if (typeof chatStore.getMessage === 'function') return await chatStore.getMessage(chatId, messageId);
  if (typeof chatStore.readMessage === 'function') return await chatStore.readMessage(chatId, messageId);
  invalid('chatStore cannot read a message');
}

function normalizeMaterial(compiled) {
  if (!compiled) return '';
  if (typeof compiled === 'string') return compiled;
  if (Array.isArray(compiled)) return JSON.stringify(compiled);
  if (isObject(compiled)) return JSON.stringify(compiled);
  invalid('Invalid attachment compilation');
}

// Attribute values are escaped; bodies stay verbatim so the model reads the
// original newlines, LaTeX backslashes and quotes. Only a literal closing tag of
// the enclosing element is neutralised, so material cannot end its own block.
const attr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]+/g, ' ');
const attrs = (pairs) => pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${attr(v)}"`).join('');
const body = (text, tag) => String(text).replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
const element = (tag, pairs, text) => `<${tag}${attrs(pairs)}>\n${body(text, tag)}\n</${tag}>`;
const locationText = (location) => location === undefined ? undefined
  : typeof location.description === 'string' && Object.keys(location).length === 1 ? location.description : JSON.stringify(location);

export function renderResearchMaterial({ attachments = [], messageQuotes = [], annotations = [], annotationResources = {} } = {}) {
  const blocks = [];
  if (typeof attachments === 'string') { if (attachments) blocks.push(element('material', [], attachments)); }
  else for (const item of attachments) {
    const pairs = [['id', item.id], ['title', item.name], ['path', item.path]];
    if (typeof item.text === 'string') blocks.push(element('material', [...pairs, ['truncated', item.truncated ? 'true' : 'false']], item.text));
    else blocks.push(element('material', [...pairs, ['extracted', 'false']], item.note || 'Contents were not extracted into this message.'));
  }
  for (const quote of messageQuotes) {
    const inner = quote.comment ? `${body(quote.selectedText, 'quote')}\n<comment>${body(quote.comment, 'comment')}</comment>` : quote.selectedText;
    blocks.push(`<quote${attrs([['source-chat', quote.sourceChatId], ['source-message', quote.sourceMessageId], ['speaker', quote.speaker]])}>\n${quote.comment ? inner : body(inner, 'quote')}\n</quote>`);
  }
  for (const note of annotations) {
    const resource = annotationResources[note.resourceId] || {};
    const inner = [`<selected>${body(note.selectedText, 'selected')}</selected>`, ...(note.comment ? [`<comment>${body(note.comment, 'comment')}</comment>`] : [])].join('\n');
    blocks.push(`<annotation${attrs([['resource', note.resourceId], ['title', resource.title], ['path', resource.path], ['version', note.versionId], ['location', locationText(note.location)]])}>\n${body(inner, 'annotation')}\n</annotation>`);
  }
  return blocks.join('\n');
}

export function createResearchInput({ attachments, chatStore, getResource } = {}) {
  if (!attachments || typeof attachments.compile !== 'function') throw new TypeError('attachments.compile is required');
  const resourceReader = getResource || (async (id) => {
    const db = chatStore?.database ?? chatStore?.db;
    return db && typeof db.getResource === 'function' ? db.getResource(id) : undefined;
  });
  return { compile: async (input = {}) => {
    if (!isObject(input)) invalid('Input must be an object');
    const userText = input.text === undefined ? '' : input.text;
    if (typeof userText !== 'string' || userText.length > MAX_TEXT) invalid('Invalid text');
    const attachmentIds = idsOf(input.attachmentIds ?? input.attachments ?? [], 'attachmentIds');
    const quotesIn = array(input.quotes ?? input.messageQuotes ?? [], 'messageQuotes');
    if (quotesIn.length > MAX_QUOTES) invalid('Too many message quotes');
    let quoteLength = 0;
    const messageQuotes = [];
    for (const quote of quotesIn) {
      if (!isObject(quote)) invalid('Invalid message quote');
      const sourceChatId = string(quote.sourceChatId, 'sourceChatId');
      const sourceMessageId = string(quote.sourceMessageId, 'sourceMessageId');
      const selectedText = string(quote.selectedText, 'selectedText');
      if (selectedText.length > MAX_SELECTED || (quoteLength += selectedText.length) > MAX_TEXT) invalid('Message quote text is too long');
      const source = await readSourceMessage(chatStore, sourceChatId, sourceMessageId);
      if (!source || !['user', 'assistant', 'system'].includes(source.role) || typeof source.text !== 'string') invalid('Message quote source is unavailable');
      const normalized = { sourceChatId, sourceMessageId, speaker: source.role, selectedText, selectionType: 'user-selected excerpt' };
      if (quote.id !== undefined) normalized.id = string(quote.id, 'quote id');
      if (quote.revision !== undefined) { if (!Number.isInteger(quote.revision) || quote.revision < 0) invalid('Invalid quote revision'); normalized.revision = quote.revision; }
      if (quote.comment !== undefined) { if (typeof quote.comment !== 'string' || quote.comment.length > MAX_COMMENT) invalid('Invalid quote comment'); normalized.comment = quote.comment; }
      messageQuotes.push(normalized);
    }
    const annotationsIn = array(input.annotations ?? [], 'annotations');
    if (annotationsIn.length > MAX_ANNOTATIONS) invalid('Too many annotations');
    const annotations = [];
    let annotationSelectedLength = 0;
    const annotationResources = {};
    for (const annotation of annotationsIn) {
      if (!isObject(annotation)) invalid('Invalid annotation');
      const normalized = {
        id: string(annotation.id, 'annotation id'),
        revision: annotation.revision,
        resourceId: string(annotation.resourceId, 'annotation resourceId'),
        ...(annotation.versionId === undefined ? {} : { versionId: string(annotation.versionId, 'annotation versionId') }),
        selectedText: string(annotation.selectedText, 'annotation selectedText')
      };
      annotationSelectedLength += normalized.selectedText.length;
      if (!Number.isInteger(normalized.revision) || normalized.revision < 0 || normalized.selectedText.length > MAX_SELECTED || annotationSelectedLength + quoteLength > MAX_TEXT) invalid('Invalid annotation');
      if (annotation.location !== undefined) { if (!isObject(annotation.location)) invalid('Invalid annotation location'); normalized.location = structuredClone(annotation.location); }
      if (annotation.comment !== undefined) { if (typeof annotation.comment !== 'string' || annotation.comment.length > MAX_COMMENT) invalid('Invalid annotation comment'); normalized.comment = annotation.comment; }
      const resource = await resourceReader(normalized.resourceId);
      if (!resource) invalid('Annotation resource is unavailable');
      if(normalized.versionId===undefined&&resource.metadata?.versionId)normalized.versionId=resource.metadata.versionId;
      annotationResources[normalized.resourceId] = { resourceId: normalized.resourceId, title: resource.title, path: resource.path };
      annotations.push(normalized);
    }
    const contextIn = array(input.contextRefs ?? [], 'contextRefs');
    if (contextIn.length > MAX_ATTACHMENTS) invalid('Too many context references');
    const contextRefs = [];
    for (const ref of contextIn) {
      if (!isObject(ref)) invalid('Invalid context reference');
      const resourceId = string(ref.resourceId, 'context resourceId');
      if (!await resourceReader(resourceId)) invalid('Context resource is unavailable');
      if (!contextRefs.some((item) => item.resourceId === resourceId)) contextRefs.push({ resourceId });
    }
    const allAttachmentIds = [...new Set([...attachmentIds, ...contextRefs.map((r) => r.resourceId)])];
    if (allAttachmentIds.length > MAX_ATTACHMENTS) invalid('Too many attachments');
    const compiled = await attachments.compile(allAttachmentIds, { structured: true });
    const material = normalizeMaterial(compiled);
    const materialPayload = renderResearchMaterial({ attachments: material ? compiled : [], messageQuotes, annotations, annotationResources });
    if (materialPayload.length > MAX_MATERIAL) invalid('Research material is too long');
    const materialText = allAttachmentIds.length || messageQuotes.length || annotations.length || contextRefs.length
      ? `[User-provided research material]\n${materialPayload}\n[End user-provided research material]\n` : '';
    const text = `${userText}${userText && materialText ? '\n' : ''}${materialText}`;
    if (text.length > MAX_TEXT + MAX_MATERIAL) invalid('Compiled text is too long');
    const snapshot = structuredClone({ attachmentIds: allAttachmentIds, messageQuotes, annotations, contextRefs });
    return { text, snapshot };
  }};
}

export { ResearchInputError };
