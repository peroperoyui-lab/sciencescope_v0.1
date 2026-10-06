import path from 'node:path';
import { AppError } from '../../../core/errors.js';
import { textParser } from './text.js';
import { markdownParser } from './markdown.js';
import { latexParser } from './latex.js';
import { pdfParser } from './pdf.js';
import { docxParser } from './docx.js';

const parsers = [pdfParser, docxParser, markdownParser, latexParser, textParser];

/** @param {string} name @returns {import('./types.js').DocumentParser|null} */
export function parserFor(name) {
  const extension = path.extname(name).toLowerCase();
  return parsers.find((parser) => parser.extensions.includes(extension)) ?? null;
}

/** @returns {string[]} */
export function supportedExtensions() {
  return parsers.flatMap((parser) => parser.extensions);
}

/**
 * @param {Uint8Array} bytes
 * @param {{name:string}} options
 * @returns {Promise<import('./types.js').ParsedContent & {parser:string}>}
 */
export async function parseDocument(bytes, { name }) {
  const parser = parserFor(name);
  if (!parser) throw new AppError('PARSER_UNSUPPORTED', `Unsupported document format: ${name}`);
  const content = await parser.parse(bytes, { name });
  return {
    ...content,
    parser: parser.id,
    blocks: content.blocks.map((block) => ({
      ...block,
      page: block.page ?? null,
      section: block.section ?? null,
    })),
  };
}
