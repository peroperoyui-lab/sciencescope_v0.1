// Message and document text is Markdown. Source HTML is sanitised first;
// only locally generated KaTeX markup receives its MathML/style allowances.
import katex from 'katex';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';

function formulaMarkup(source, displayMode) {
  return DOMPurify.sanitize(
    katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
    }),
    {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      FORBID_TAGS: ['a', 'img'],
      ALLOW_DATA_ATTR: false,
    },
  );
}

function mathExtensions(emit) {
  return [
    {
      name: 'scopeBlockMath',
      level: 'block',
      start: (source) => source.search(/(?:^|\n)[ \t]*\$\$/u),
      tokenizer(source) {
        const match = /^[ \t]*\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/u.exec(source);
        if (match) return { type: 'scopeBlockMath', raw: match[0], text: match[1] };
      },
      renderer: (token) => emit(token.text, true),
    },
    {
      name: 'scopeInlineMath',
      level: 'inline',
      start: (source) => source.search(/\$/u),
      tokenizer(source) {
        // Pandoc dollars: preserve currency, escaped dollars and code spans.
        const match = /^\$(?![$\s])((?:\\.|[^$\\\n`])*?[^\s\\`])\$(?![$\d])/u.exec(source);
        if (match) return { type: 'scopeInlineMath', raw: match[0], text: match[1] };
      },
      renderer: (token) => emit(token.text, false),
    },
  ];
}

/**
 * Render Markdown and formulas without allowing source HTML to inherit KaTeX permissions.
 * @param {string} text
 * @returns {string}
 */
export function renderMarkdown(text) {
  const formulas = [];
  const marker = 'scope-formula-' + crypto.randomUUID();
  const parser = new Marked({ gfm: true, breaks: true });
  parser.use({
    extensions: mathExtensions((source, display) => {
      const index = formulas.push(formulaMarkup(source, display)) - 1;
      return '<span id="' + marker + '-' + index + '"></span>';
    }),
  });
  const clean = DOMPurify.sanitize(
    /** @type {string} */ (parser.parse(text ?? '', { async: false })),
    { FORBID_ATTR: ['style'] },
  );
  // Replace only this render's unpredictable markers after strict sanitisation.
  return clean.replace(
    new RegExp('<span id="' + marker + '-(\\d+)"></span>', 'g'),
    (_, index) => formulas[Number(index)],
  );
}

/**
 * Render a formula with the same local KaTeX renderer used in messages.
 * @param {string} latex
 * @returns {string}
 */
export function renderFormula(latex) {
  return formulaMarkup(latex, true);
}
