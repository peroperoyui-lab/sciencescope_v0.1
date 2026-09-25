// Parser registry. A parser turns an original file into structured blocks; the
// ingest pipeline (../ingest.mjs) chunks and indexes them. Contract:
//
//   { id, extensions: ['.pdf'], parse(bytes: Buffer, { name }) =>
//       Promise<{ blocks: Block[], pages?: number, metadata?: SourceMetadata, warnings?: string[] }> }
//   Block = { kind: 'heading'|'paragraph'|'caption'|'table'|'equation'|'code'|'list'|'reference'|'abstract',
//             text: string, page?: number (1-based), section?: string (heading path "2 Methods > 2.1 Design"),
//             anchor?: { page?, quote?: { exact, prefix?, suffix? }, rects?: [[x,y,w,h]…] } }
//   SourceMetadata = { title?, authors?: [{given,family}|{literal}], year?, doi?, arxivId?, abstract?, venue?, language? }
//
// A parser that cannot handle a file throws ParserUnsupported; the source is
// then marked 'unsupported' (the original stays usable by file tools).
// PDF and DOCX parsers are left for T04 (pdfjs-dist, mammoth); see docs/tasks.
import { textParser } from './text.mjs';
import { markdownParser } from './markdown.mjs';
import { latexParser } from './latex.mjs';

export class ParserUnsupported extends Error {
  constructor(message) { super(message); this.code = 'PARSER_UNSUPPORTED'; }
}

const builtin = [textParser, markdownParser, latexParser];
const extra = [];

/** Register a parser (T04 adds pdf/docx). Later registrations win for an extension. */
export function registerParser(parser) {
  if (!parser?.id || !Array.isArray(parser.extensions) || typeof parser.parse !== 'function') throw new TypeError('invalid parser');
  extra.unshift(parser);
}
export function parserFor(name) {
  const ext = (/\.[^.]+$/u.exec(String(name).toLowerCase()) ?? [''])[0];
  return [...extra, ...builtin].find((parser) => parser.extensions.includes(ext)) ?? null;
}
export const supportedExtensions = () => [...new Set([...extra, ...builtin].flatMap((parser) => parser.extensions))];

/** Strict UTF-8 decode shared by the text-like parsers. */
export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/u, '').replace(/\r\n?/gu, '\n'); }
  catch { throw new ParserUnsupported('文件不是有效的 UTF-8 文本。'); }
}
