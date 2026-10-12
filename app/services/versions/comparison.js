// Compare parser text, never original bytes. Segmenter preserves Chinese words;
// whitespace is retained so joining the projection reconstructs each text.
import { diffArrays } from 'diff';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * @param {string} before
 * @param {string} after
 */
export function compareText(before, after) {
  const words = (text) => Array.from(segmenter.segment(text), (entry) => entry.segment);
  return diffArrays(words(before), words(after)).map((part) => ({
    type: part.added ? 'added' : part.removed ? 'removed' : 'unchanged',
    text: part.value.join(''),
  }));
}
