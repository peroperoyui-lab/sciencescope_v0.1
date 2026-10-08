// Preserve the legacy material format. File bytes are never a prompt-sized
// projection: every file is identified for paginated research_read access.
const attribute = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\r\n]+/gu, ' ');
const body = (text, tag) => String(text).replace(new RegExp(`</(${tag})`, 'gi'), '<\\/$1');
const attributes = (values) =>
  Object.entries(values)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ` ${key}="${attribute(value)}"`)
    .join('');

/**
 * @param {{materials?:any[],marks?:any[]}} input
 * @returns {string}
 */
export function compileResearchInput(input = {}) {
  const blocks = (input.materials ?? []).map((entry) => {
    const content =
      entry.type === 'item'
        ? `${entry.text}\n${JSON.stringify(entry.payload ?? {})}`
        : 'Read this source with research_read using its id and offset/limit; cite the returned page labels.';
    return `<material${attributes({ id: entry.id, title: entry.title, pages: entry.pages, label: entry.label, extracted: entry.type === 'item' })}>\n${body(content, 'material')}\n</material>`;
  });
  for (const mark of input.marks ?? []) {
    const tag = mark.messageId ? 'quote' : 'annotation';
    const content =
      tag === 'quote'
        ? body(mark.text, tag)
        : `<selected>${body(mark.text, 'selected')}</selected>`;
    blocks.push(
      `<${tag}${attributes({ 'source-chat': mark.meetingId, 'source-message': mark.messageId, speaker: mark.speaker, resource: mark.sourceId, path: mark.target?.path, title: mark.title, location: typeof mark.location === 'object' ? JSON.stringify(mark.location) : mark.location })}>\n${content}${mark.comment ? `\n<comment>${body(mark.comment, 'comment')}</comment>` : ''}\n</${tag}>`,
    );
  }
  return blocks.length
    ? `\n\n[User-provided research material]\n${blocks.join('\n')}\n[End user-provided research material]\n`
    : '';
}
