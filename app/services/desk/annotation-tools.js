import { AppError } from '../../core/errors.js';
import { manuscriptText } from './manuscript-text.js';

/**
 * Tool quotes use visible atom markers; HTTP ranges use displayed UTF-16 text.
 * Translate whole atoms once and reject a boundary inside a marker.
 * @param {any} block
 * @param {number} from
 * @param {number} to
 * @returns {{from:number,to:number}}
 */
export function toolRange(block, from, to) {
  if (!block.inlines) return { from, to };
  let toolOffset = 0,
    displayOffset = 0;
  function position(at) {
    toolOffset = 0;
    displayOffset = 0;
    for (const inline of block.inlines) {
      const token = manuscriptText({ inlines: [inline] });
      const displayed = inline.text ?? inline.display ?? '\uFFFC';
      if (at === toolOffset) return displayOffset;
      if (at < toolOffset + token.length) {
        if (inline.atom)
          throw new AppError('DESK_ATOM_CHANGED', '请完整选取原子记号，不能截取其中一部分。');
        return displayOffset + at - toolOffset;
      }
      toolOffset += token.length;
      displayOffset += displayed.length;
    }
    return displayOffset;
  }
  return { from: position(from), to: position(to) };
}
