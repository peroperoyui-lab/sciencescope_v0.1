import mammoth from 'mammoth';
import { parseFragment } from 'parse5';
import JSZip from 'jszip';

function textOf(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value ?? '';
  return (node.childNodes ?? []).map(textOf).join('');
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function elementChildren(node, name) {
  return (node.childNodes ?? []).filter((child) => child.nodeName === name);
}

function descendants(node, name) {
  const found = [];
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === name) found.push(child);
    found.push(...descendants(child, name));
  }
  return found;
}

function tableText(node) {
  return descendants(node, 'tr').map((row) => descendants(row, 'td').concat(descendants(row, 'th')).map((cell) => cleanText(textOf(cell))).join('\t')).join('\n');
}

async function coreProperties(bytes) {
  try {
    const zip = await JSZip.loadAsync(Buffer.from(bytes));
    const xml = await zip.file('docProps/core.xml')?.async('string');
    if (!xml) return {};
    const value = (tag) => cleanText(xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'iu'))?.[1] ?? '');
    return { title: value('dc:title'), creator: value('dc:creator') };
  } catch { return {}; }
}

export async function convertDocx(bytes) {
  const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  return { html: result.value, warnings: (result.messages ?? []).map((message) => message.message ?? String(message)) };
}

function extractBlocks(html) {
  const root = parseFragment(html);
  const blocks = [];
  const stack = [];
  const currentSection = () => stack.filter(Boolean).join(' > ') || undefined;
  const add = (kind, text) => {
    // Keep row and cell separators in table blocks so preview/search can
    // reconstruct the table shape; prose blocks still normalize whitespace.
    const cleaned = kind === 'table' ? String(text ?? '').trim() : cleanText(text);
    if (cleaned) blocks.push({ kind, text: cleaned, ...(currentSection() ? { section: currentSection() } : {}) });
  };
  const visit = (node) => {
    const name = String(node.nodeName ?? '').toLowerCase();
    const heading = /^h[1-6]$/u.exec(name);
    if (heading) {
      const level = Number(heading[0].slice(1));
      stack.splice(level - 1);
      const text = cleanText(textOf(node));
      if (text) { stack[level - 1] = text; add('heading', text); }
      return;
    }
    if (name === 'table') { add('table', tableText(node)); return; }
    if (name === 'p') { add('paragraph', textOf(node)); return; }
    if (name === 'li') { add('list', textOf(node)); return; }
    for (const child of node.childNodes ?? []) visit(child);
  };
  for (const child of root.childNodes ?? []) visit(child);
  return blocks;
}

export const docxParser = {
  id: 'docx',
  extensions: ['.docx'],
  async parse(bytes) {
    const converted = await convertDocx(bytes);
    const properties = await coreProperties(bytes);
    const blocks = extractBlocks(converted.html);
    const firstHeading = blocks.find((block) => block.kind === 'heading')?.text;
    const title = properties.title || firstHeading;
    const authors = properties.creator ? [{ literal: properties.creator }] : [];
    return { blocks, pages: undefined, metadata: { ...(title ? { title } : {}), ...(authors.length ? { authors } : {}) }, warnings: converted.warnings };
  },
};
