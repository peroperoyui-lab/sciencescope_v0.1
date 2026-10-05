import { AppError } from '../errors.js';

/**
 * Operations shared by every Markdown resource (plans, log, minutes, notes, agents).
 * Each returns the new full text, or null to delete the file.
 *
 * @param {string | null} text Current text (null when the file does not exist).
 * @param {string} op
 * @param {any} args
 * @returns {string | null}
 */
export function applyTextOp(text, op, args) {
  const current = text ?? '';
  switch (op) {
    case 'write':
      return String(args.text ?? '');
    case 'append': {
      const separator = current === '' || current.endsWith('\n') ? '' : '\n';
      return current + separator + String(args.text ?? '');
    }
    case 'replace': {
      const find = String(args.find ?? '');
      if (!find || !current.includes(find)) {
        throw new AppError('TEXT_NOT_FOUND', '要替换的原文在当前内容中找不到。', 409);
      }
      return current.replace(find, String(args.with ?? ''));
    }
    case 'delete':
      return null;
    default:
      throw new AppError('UNKNOWN_OP', `不支持的操作：${op}`);
  }
}

export const TEXT_OPS = ['write', 'append', 'replace', 'delete'];
