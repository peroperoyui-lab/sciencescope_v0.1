import { AppError } from '../../../core/errors.js';

/** @param {Uint8Array} bytes @returns {string} */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n?/gu, '\n');
  } catch {
    throw new AppError('PARSER_UNSUPPORTED', 'Document is not valid UTF-8 text.');
  }
}

/** @param {unknown} value @returns {string} */
export function cleanText(value) {
  return String(value ?? '')
    .replaceAll('\u0000', '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** @param {string[]} headings @returns {string|null} */
export function sectionPath(headings) {
  return headings.filter(Boolean).join(' > ') || null;
}
