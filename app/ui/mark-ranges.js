/**
 * Match rendered selections despite PDF line wrapping and paragraph spaces.
 * @param {Element} root
 * @param {string} text
 * @returns {Range|null}
 */
export function findMarkRange(root, text) {
  const wanted = text.replace(/\s/gu, '');
  if (!wanted) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  /** @type {Array<[Node,number]>} */
  const positions = [];
  let compact = '',
    node;
  while ((node = walker.nextNode())) {
    for (let i = 0; i < node.textContent.length; i++) {
      const character = node.textContent[i];
      if (/\s/u.test(character)) continue;
      compact += character;
      positions.push([node, i]);
    }
  }
  const index = compact.indexOf(wanted);
  if (index < 0) return null;
  const start = positions[index],
    end = positions[index + wanted.length - 1];
  const range = document.createRange();
  range.setStart(start[0], start[1]);
  range.setEnd(end[0], end[1] + 1);
  return range;
}

/**
 * @param {string} name
 * @param {Range[]} ranges
 */
export function markHighlight(name, ranges) {
  const browser = /** @type {any} */ (globalThis);
  if (!browser.CSS?.highlights || !browser.Highlight) return;
  if (ranges.length) browser.CSS.highlights.set(name, new browser.Highlight(...ranges));
  else browser.CSS.highlights.delete(name);
}
