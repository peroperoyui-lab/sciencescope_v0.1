import mammoth from 'mammoth';
import JSZip from 'jszip';
import { parseFragment } from 'parse5';
import { cleanText, sectionPath } from './text-utils.js';
import { preserveDocumentStructure, propertyText } from './docx-xml.js';

const PAGE_BREAK_CLASS = 'sciencescope-page-break';
const EQUATION_CLASS = 'sciencescope-equation';

function hasClass(node, name) {
  return node.attrs?.some(
    (attribute) => attribute.name === 'class' && attribute.value.split(/\s+/u).includes(name),
  );
}

function childrenOf(node) {
  return node.childNodes ?? [];
}

function descendants(node, name) {
  return childrenOf(node).flatMap((child) => [
    ...(child.nodeName === name ? [child] : []),
    ...descendants(child, name),
  ]);
}

function textOf(node) {
  if (node.nodeName === '#text') return node.value ?? '';
  if (node.nodeName === 'br') return '\n';
  return childrenOf(node).map(textOf).join('');
}

function retainPageBreaks(node) {
  if (node.type === 'break' && node.breakType === 'page') {
    return {
      type: 'run',
      styleId: 'ScienceScopePageBreak',
      children: [{ type: 'text', value: '\u200b' }],
    };
  }
  if (node.children) return { ...node, children: node.children.map(retainPageBreaks) };
  return node;
}

function extractBlocks(html) {
  const root = parseFragment(html);
  const hasPages = descendants(root, 'span').some((node) => hasClass(node, PAGE_BREAK_CLASS));
  const blocks = [];
  const headings = [];
  let page = hasPages ? 1 : null;
  const add = (kind, value) => {
    const text = kind === 'table' ? value.trim() : cleanText(value);
    if (text)
      blocks.push({
        kind,
        text,
        page,
        section: sectionPath(headings),
        anchor: { page, quote: { exact: text.slice(0, 240) } },
      });
  };
  const addInline = (node, kind) => {
    let buffer = '';
    const flush = () => {
      add(kind, buffer);
      buffer = '';
    };
    const visitInline = (child) => {
      if (hasClass(child, PAGE_BREAK_CLASS)) {
        flush();
        page += 1;
      } else if (hasClass(child, EQUATION_CLASS)) {
        flush();
        add('equation', textOf(child));
      } else if (child.nodeName === '#text') buffer += child.value ?? '';
      else if (child.nodeName === 'br') buffer += '\n';
      else childrenOf(child).forEach(visitInline);
    };
    childrenOf(node).forEach(visitInline);
    flush();
  };
  const visit = (node) => {
    const heading = /^h([1-6])$/u.exec(node.nodeName);
    if (heading) {
      const level = Number(heading[1]);
      const text = cleanText(textOf(node));
      headings.length = level - 1;
      headings[level - 1] = text;
      addInline(node, 'heading');
      return;
    }
    if (node.nodeName === 'table') {
      const rows = descendants(node, 'tr').map((row) =>
        childrenOf(row)
          .filter((cell) => ['td', 'th'].includes(cell.nodeName))
          .map((cell) => cleanText(textOf(cell)))
          .join('\t'),
      );
      add('table', rows.join('\n'));
      if (page !== null)
        page += descendants(node, 'span').filter((span) => hasClass(span, PAGE_BREAK_CLASS)).length;
      return;
    }
    if (node.nodeName === 'p' || node.nodeName === 'li') {
      addInline(node, node.nodeName === 'li' ? 'list' : 'paragraph');
      return;
    }
    if (hasClass(node, PAGE_BREAK_CLASS)) {
      page += 1;
      return;
    }
    childrenOf(node).forEach(visit);
  };
  childrenOf(root).forEach(visit);
  blocks.forEach((block, index) => {
    block.anchor.quote.prefix = blocks[index - 1]?.text.slice(-80) ?? '';
    block.anchor.quote.suffix = blocks[index + 1]?.text.slice(0, 80) ?? '';
  });
  return { blocks, pages: page };
}

/** @type {import('./types.js').DocumentParser} */
export const docxParser = {
  id: 'docx',
  extensions: ['.docx'],
  async parse(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const document = await zip.file('word/document.xml')?.async('string');
    if (document) zip.file('word/document.xml', preserveDocumentStructure(document));
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const converted = await mammoth.convertToHtml(
      { buffer },
      {
        transformDocument: retainPageBreaks,
        styleMap: [
          'r.ScienceScopePageBreak => span.sciencescope-page-break:fresh',
          'r.ScienceScopeEquation => span.sciencescope-equation:fresh',
        ],
      },
    );
    const content = extractBlocks(converted.value);
    const properties = await zip.file('docProps/core.xml')?.async('string');
    const title =
      propertyText(properties, 'dc:title') ||
      content.blocks.find((block) => block.kind === 'heading')?.text;
    const author = propertyText(properties, 'dc:creator');
    return {
      ...content,
      metadata: {
        ...(title ? { title } : {}),
        ...(author ? { authors: [{ literal: author }] } : {}),
      },
      warnings: converted.messages.map((message) => message.message),
    };
  },
};
