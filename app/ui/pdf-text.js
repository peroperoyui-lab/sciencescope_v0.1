// Where words on a PDF page are in the desk session's PDF blocks.
// The session reads the PDF the way the library does (items joined into lines,
// lines into paragraphs, running heads dropped, NFKC, CJK spaces and line-end
// hyphens removed), while the page's text layer holds pdf.js's raw items. Both
// sides are compared without spaces and hyphens; context on either side picks
// the right one among repeated words.

const SKIP = /[\s\u00ad\u2010\u2011-]/u;
const CONTEXT = 24;

/**
 * The text without spaces and hyphens, with where each kept character came from.
 * @param {string} text
 * @returns {{ chars: string, at: number[] }}
 */
export function skeleton(text) {
  let chars = '';
  const at = [];
  for (let index = 0; index < text.length;) {
    const code = text.codePointAt(index) ?? 0;
    const char = String.fromCodePoint(code);
    for (const part of char.normalize('NFKC'))
      if (!SKIP.test(part)) {
        chars += part;
        for (let unit = 0; unit < part.length; unit++) at.push(index);
      }
    index += char.length;
  }
  return { chars, at };
}

/** How many characters agree, walking away from the match. */
function agree(left, right, backwards) {
  let count = 0;
  const length = Math.min(left.length, right.length);
  while (count < length) {
    const a = backwards ? left[left.length - 1 - count] : left[count];
    const b = backwards ? right[right.length - 1 - count] : right[count];
    if (a !== b) break;
    count++;
  }
  return count;
}

/**
 * The occurrence of `needle` in `hay` whose surroundings look most like `before` and `after`.
 * @param {string} hay @param {string} needle @param {string} before @param {string} after
 * @returns {{ at: number, score: number } | null}
 */
function bestMatch(hay, needle, before, after) {
  if (!needle) return null;
  let best = null;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
    const score =
      agree(hay.slice(Math.max(0, at - CONTEXT), at), before, true) +
      agree(hay.slice(at + needle.length, at + needle.length + CONTEXT), after, false);
    if (!best || score > best.score) best = { at, score };
  }
  return best;
}

/**
 * The block and offsets in its text for page characters `start`..`end` (skeleton positions).
 * Words outside every block (running heads, page numbers) or across two blocks give null.
 * @param {string} page the page's skeleton characters
 * @param {number} start @param {number} end
 * @param {{ id: string, text: string }[]} blocks the page's blocks
 * @returns {{ blockId: string, from: number, to: number } | null}
 */
export function placeOnPage(page, start, end, blocks) {
  const needle = page.slice(start, end);
  const before = page.slice(Math.max(0, start - CONTEXT), start);
  const after = page.slice(end, end + CONTEXT);
  let best = null;
  for (const block of blocks) {
    const { chars, at } = skeleton(block.text);
    const found = bestMatch(chars, needle, before, after);
    if (found && (!best || found.score > best.found.score)) best = { block, found, at };
  }
  if (!best) return null;
  const { block, found, at } = best;
  const last = at[found.at + needle.length - 1];
  return {
    blockId: block.id,
    from: at[found.at],
    to: last + (block.text.codePointAt(last) > 0xffff ? 2 : 1),
  };
}

/**
 * Where offsets `from`..`to` of a block's text are on its page (skeleton positions).
 * @param {string} page the page's skeleton characters
 * @param {string} text the block's text
 * @param {number} from @param {number} to
 * @returns {[number, number] | null}
 */
export function findOnPage(page, text, from, to) {
  const { chars, at } = skeleton(text);
  const start = at.findIndex((index) => index >= from);
  if (start < 0) return null;
  const stop = at.findIndex((index) => index >= to);
  const end = stop < 0 ? chars.length : stop;
  if (end <= start) return null;
  const found = bestMatch(
    page,
    chars.slice(start, end),
    chars.slice(Math.max(0, start - CONTEXT), start),
    chars.slice(end, end + CONTEXT),
  );
  return found ? [found.at, found.at + end - start] : null;
}
