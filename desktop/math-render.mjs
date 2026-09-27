import katex from './vendor/katex/katex.mjs';
import DOMPurify from './vendor/purify.mjs';

// Only KaTeX-generated markup receives a MathML/style allowance. Raw model or
// document HTML still passes through the stricter Markdown sanitizer first.
export function mathHTML(source, displayMode = false) {
  return DOMPurify.sanitize(katex.renderToString(String(source), {
    displayMode, throwOnError: false, trust: false, strict: 'ignore',
    maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml',
  }), { USE_PROFILES: { html: true, mathMl: true, svg: true }, FORBID_TAGS: ['a', 'img'], ALLOW_DATA_ATTR: false });
}

// Marked recognizes these tokens outside code spans/fences. Render placeholders
// first so allowing KaTeX's generated CSS never allows model-supplied CSS.
export function mathExtensions(emit) {
  return [
    {
      name: 'ssBlockMath', level: 'block',
      start: source => source.search(/(?:^|\n)[ \t]*(?:\$\$|\\\[)/u),
      tokenizer(source) {
        const match = /^(?:[ \t]*\$\$([\s\S]+?)\$\$|[ \t]*\\\[([\s\S]+?)\\\])[ \t]*(?:\n|$)/u.exec(source);
        if (match) return { type: 'ssBlockMath', raw: match[0], text: match[1] ?? match[2] };
      },
      renderer: token => emit(token.text, true),
    },
    {
      name: 'ssInlineMath', level: 'inline',
      start: source => source.search(/\$|\\\(/u),
      tokenizer(source) {
        // Pandoc rule: no space just inside the dollars and no digit right
        // after the closing one, so "$5 and $10" stays text; a backtick
        // ends the attempt so a later code span keeps its dollars (Claude, 2026-09-27).
        const match = /^(?:\$(?![$\s])((?:\\.|[^$\\\n`])*?[^\s\\`])\$(?![$\d])|\\\(([\s\S]+?)\\\))/u.exec(source);
        if (match) return { type: 'ssInlineMath', raw: match[0], text: match[1] ?? match[2] };
      },
      renderer: token => emit(token.text, false),
    },
  ];
}
