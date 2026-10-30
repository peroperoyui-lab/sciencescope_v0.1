// TeX source as a page, for the editing desk's rendered view (EDITING_DESK.md
// §10, U6). The desk's own reading of the commands manuscripts use, so the page
// needs no TeX installed: sections, lists, citations, tables, floats and
// formulas (through KaTeX). A command it does not know is shown as written, in
// a faint style. Each block keeps its range in the source, for scroll sync and
// for writing an edited formula back. Positions count a line break as one
// character, like the source editor.
import katex from 'katex';
import { t } from './i18n/index.js';

const CJK = /[\u2e80-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/u;
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (text) => text.replace(/[&<>"]/g, (char) => ESCAPES[char]);
const has = (table, key) => Object.hasOwn(table, key);

const HEADINGS = {
  part: 0,
  chapter: 0,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 4,
};
const WRAP = {
  textbf: 'strong',
  textit: 'em',
  emph: 'em',
  textsl: 'em',
  underline: 'u',
  uline: 'u',
  texttt: 'code',
  textsuperscript: 'sup',
  textsubscript: 'sub',
};
// Commands whose last argument is shown as plain text; the number is how many arguments come first.
const PLAIN = {
  textrm: 0,
  textsf: 0,
  textup: 0,
  textnormal: 0,
  textmd: 0,
  textsc: 0,
  mbox: 0,
  hbox: 0,
  text: 0,
  fbox: 0,
  makebox: 0,
  hl: 0,
  sout: 0,
  textcolor: 1,
  colorbox: 1,
  foreignlanguage: 1,
};
const DECLARATIONS = {
  bf: 'strong',
  bfseries: 'strong',
  it: 'em',
  itshape: 'em',
  em: 'em',
  sl: 'em',
  slshape: 'em',
  tt: 'code',
  ttfamily: 'code',
};
const SYMBOLS = {
  ldots: '…',
  dots: '…',
  textellipsis: '…',
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  LaTeXe: 'LaTeX2ε',
  S: '§',
  P: '¶',
  copyright: '©',
  textcopyright: '©',
  textregistered: '®',
  texttrademark: '™',
  dag: '†',
  ddag: '‡',
  textdegree: '°',
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
  textbar: '|',
  textless: '<',
  textgreater: '>',
  textendash: '–',
  textemdash: '—',
  textbullet: '•',
  textperiodcentered: '·',
  textperthousand: '‰',
  checkmark: '✓',
  pounds: '£',
  euro: '€',
  quad: '\u2003',
  qquad: '\u2003\u2003',
  enspace: '\u2002',
  thinspace: '\u2009',
  ss: 'ß',
  ae: 'æ',
  AE: 'Æ',
  oe: 'œ',
  OE: 'Œ',
  o: 'ø',
  O: 'Ø',
  aa: 'å',
  AA: 'Å',
  l: 'ł',
  L: 'Ł',
  i: 'ı',
  and: '\u2003',
  '%': '%',
  '&': '&',
  '#': '#',
  _: '_',
  $: '$',
  '{': '{',
  '}': '}',
  ' ': ' ',
  ',': '\u2009',
  ';': ' ',
  ':': ' ',
  '!': '',
  '-': '',
  '/': '',
  '@': '',
};
const ACCENTS = {
  "'": '́',
  '`': '̀',
  '^': '̂',
  '"': '̈',
  '~': '̃',
  '=': '̄',
  '.': '̇',
  u: '̆',
  v: '̌',
  H: '̋',
  c: '̧',
  k: '̨',
  r: '̊',
};
// Layout and bookkeeping commands that print nothing, with how many arguments they take.
const SILENT = {
  centering: 0,
  raggedright: 0,
  raggedleft: 0,
  noindent: 0,
  indent: 0,
  hfill: 0,
  vfill: 0,
  null: 0,
  relax: 0,
  protect: 0,
  ignorespaces: 0,
  newpage: 0,
  clearpage: 0,
  cleardoublepage: 0,
  pagebreak: 0,
  nopagebreak: 0,
  nolinebreak: 0,
  smallskip: 0,
  medskip: 0,
  bigskip: 0,
  normalsize: 0,
  small: 0,
  footnotesize: 0,
  scriptsize: 0,
  tiny: 0,
  large: 0,
  Large: 0,
  LARGE: 0,
  huge: 0,
  Huge: 0,
  normalfont: 0,
  rmfamily: 0,
  sffamily: 0,
  upshape: 0,
  mdseries: 0,
  scshape: 0,
  sc: 0,
  rm: 0,
  sf: 0,
  selectfont: 0,
  frenchspacing: 0,
  onehalfspacing: 0,
  doublespacing: 0,
  singlespacing: 0,
  tableofcontents: 0,
  listoffigures: 0,
  listoftables: 0,
  sloppy: 0,
  fussy: 0,
  allowbreak: 0,
  unskip: 0,
  xspace: 0,
  frontmatter: 0,
  mainmatter: 0,
  backmatter: 0,
  makeatletter: 0,
  makeatother: 0,
  toprule: 0,
  midrule: 0,
  bottomrule: 0,
  hline: 0,
  vspace: 1,
  hspace: 1,
  index: 1,
  nocite: 1,
  phantom: 1,
  hphantom: 1,
  vphantom: 1,
  linespread: 1,
  pagestyle: 1,
  thispagestyle: 1,
  pagenumbering: 1,
  bibliographystyle: 1,
  color: 1,
  enlargethispage: 1,
  hypersetup: 1,
  graphicspath: 1,
  geometry: 1,
  captionsetup: 1,
  usepackage: 1,
  RequirePackage: 1,
  documentclass: 1,
  setlength: 2,
  addtolength: 2,
  fontsize: 2,
  addtocounter: 2,
  thanks: 1,
  addcontentsline: 3,
};
const CITES = new Set([
  'cite',
  'citep',
  'citealp',
  'parencite',
  'autocite',
  'supercite',
  'footcite',
  'Cite',
  'Parencite',
  'Autocite',
  'citeyearpar',
]);
const TEXT_CITES = new Set(['citet', 'citealt', 'textcite', 'Textcite', 'citeauthor', 'citeyear']);
const REFS = new Set(['ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'nameref', 'vref']);
const DEFINES = new Set([
  'newcommand',
  'renewcommand',
  'providecommand',
  'DeclareRobustCommand',
  'def',
  'gdef',
  'DeclareMathOperator',
  'newtheorem',
  'theoremstyle',
  'setcounter',
  'title',
  'author',
  'date',
]);
const MATH = {
  equation: 'one',
  'equation*': 'one*',
  displaymath: 'one*',
  align: 'rows',
  'align*': 'rows*',
  flalign: 'rows',
  'flalign*': 'rows*',
  alignat: 'rows',
  'alignat*': 'rows*',
  gather: 'rows',
  'gather*': 'rows*',
  multline: 'lines',
  'multline*': 'lines*',
  eqnarray: 'rows',
  'eqnarray*': 'rows*',
};
const LISTS = {
  itemize: 'ul',
  compactitem: 'ul',
  enumerate: 'ol',
  compactenum: 'ol',
  description: 'dl',
  tablenotes: 'ul',
};
const FLOATS = {
  table: 'table',
  'table*': 'table',
  sidewaystable: 'table',
  wraptable: 'table',
  figure: 'figure',
  'figure*': 'figure',
  wrapfigure: 'figure',
};
const TABULARS = { tabular: 1, 'tabular*': 2, tabularx: 2, longtable: 1, tabulary: 2 };
const VERBATIM = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'alltt']);
// Environments that only change type size or spacing: their content flows on.
const TRANSPARENT = {
  small: 0,
  footnotesize: 0,
  scriptsize: 0,
  normalsize: 0,
  large: 0,
  Large: 0,
  tiny: 0,
  singlespace: 0,
  onehalfspace: 0,
  doublespace: 0,
  spacing: 1,
  minipage: 1,
  samepage: 0,
  flushleft: 0,
  flushright: 0,
  raggedright: 0,
  sloppypar: 0,
  landscape: 0,
  CJK: 2,
  'CJK*': 2,
  otherlanguage: 1,
  adjustbox: 1,
  threeparttable: 0,
};
// Commands that only scale or frame their last argument, which can hold a table.
const TRANSPARENT_COMMANDS = { resizebox: 2, scalebox: 1, adjustbox: 1, makebox: 0 };
const QUOTES = new Set(['quote', 'quotation', 'verse']);
const THEOREMS_CJK = {
  theorem: '定理',
  lemma: '引理',
  proposition: '命题',
  corollary: '推论',
  definition: '定义',
  example: '例',
  remark: '注',
  hypothesis: '假设',
  assumption: '假设',
  conjecture: '猜想',
};
const THEOREMS_EN = {
  theorem: 'Theorem',
  lemma: 'Lemma',
  proposition: 'Proposition',
  corollary: 'Corollary',
  definition: 'Definition',
  example: 'Example',
  remark: 'Remark',
  hypothesis: 'Hypothesis',
  assumption: 'Assumption',
  conjecture: 'Conjecture',
};
const ZH_DIGITS = '零一二三四五六七八九';

/** 1 → 一, 12 → 十二, 23 → 二十三. @param {number} n */
function chineseNumber(n) {
  if (n < 10) return ZH_DIGITS[n];
  if (n < 20) return `十${n % 10 ? ZH_DIGITS[n % 10] : ''}`;
  if (n < 100) return `${ZH_DIGITS[Math.floor(n / 10)]}十${n % 10 ? ZH_DIGITS[n % 10] : ''}`;
  return String(n);
}
const letter = (n) => String.fromCharCode(64 + Math.max(1, Math.min(26, n)));
const roman = (n) =>
  ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][n] ?? String(n);

// ---------- Reading the source ----------

/**
 * The source with comments blanked out, keeping every position. Verbatim
 * environments keep their % signs; the comment environment is blanked whole.
 * @param {string} source
 */
export function maskComments(source) {
  const out = source.split('');
  const verbatim = /\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}/g;
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    verbatim.lastIndex = i;
    const next = verbatim.exec(source);
    const stop = next ? next.index : source.length;
    // Comments from i to the next verbatim block.
    for (let k = i; k < stop; k++) {
      if (source[k] === '\\') {
        k++;
        continue;
      }
      if (source[k] === '%') {
        const end = source.indexOf('\n', k);
        const to = Math.min(end < 0 ? source.length : end, stop);
        blank(k, to);
        k = to - 1;
      }
    }
    if (!next) break;
    const close = `\\end{${next[1]}}`;
    const end = source.indexOf(close, next.index + next[0].length);
    const to = end < 0 ? source.length : end + close.length;
    if (next[1] === 'comment') blank(next.index, to);
    i = to;
  }
  return out.join('');
}

/** @param {string} s @param {number} i at a backslash */
function command(s, i) {
  let j = i + 1;
  if (j >= s.length) return { name: '', star: false, end: j };
  if (/[A-Za-z]/.test(s[j])) {
    while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
  } else j++;
  const name = s.slice(i + 1, j);
  const star = s[j] === '*' && /[A-Za-z]/.test(name);
  return { name, star, end: star ? j + 1 : j };
}

/** Index after the bracket matching s[i], or -1. Braces nest inside brackets. */
function matching(s, i, to = s.length) {
  const open = s[i];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let braces = 0;
  for (let k = i; k < to; k++) {
    const char = s[k];
    if (char === '\\') {
      k++;
      continue;
    }
    if (open === '[') {
      if (char === '{') braces++;
      else if (char === '}') braces--;
      if (braces) continue;
    }
    if (char === open) depth++;
    else if (char === close && --depth === 0) return k + 1;
  }
  return -1;
}

/** Skip spaces and at most one line break. */
function skipSpace(s, i, to = s.length) {
  let newline = false;
  while (i < to && /\s/.test(s[i])) {
    if (s[i] === '\n') {
      if (newline) break;
      newline = true;
    }
    i++;
  }
  return i;
}

/** A {…} argument at i (after spaces): its inside and where it ends. */
function arg(s, i, to = s.length) {
  const at = skipSpace(s, i, to);
  if (s[at] !== '{') return null;
  const end = matching(s, at, to);
  return end < 0 ? null : { from: at + 1, to: end - 1, end, text: s.slice(at + 1, end - 1) };
}

/** An optional […] argument at i. */
function opt(s, i, to = s.length) {
  const at = skipSpace(s, i, to);
  if (s[at] !== '[') return null;
  const end = matching(s, at, to);
  return end < 0 ? null : { from: at + 1, to: end - 1, end, text: s.slice(at + 1, end - 1) };
}

/** Skip `count` arguments, optional ones included, and return where they end. */
function skipArgs(s, i, count, to = s.length) {
  let at = i;
  for (let left = count; ;) {
    const optional = opt(s, at, to);
    if (optional) {
      at = optional.end;
      continue;
    }
    if (!left) return at;
    const next = arg(s, at, to);
    if (!next) return at;
    at = next.end;
    left--;
  }
}

/** The matching \end{name} for a \begin{name} whose name ends at i. */
function findEnd(s, i, name, to = s.length) {
  const pattern = /\\(begin|end)\s*\{([^{}]*)\}/g;
  pattern.lastIndex = i;
  let depth = 1;
  for (let match; (match = pattern.exec(s)) && match.index < to;) {
    if (match[2] !== name) continue;
    depth += match[1] === 'begin' ? 1 : -1;
    if (!depth) return { inner: match.index, end: match.index + match[0].length };
  }
  return null;
}

/** Where the inline formula opened at i closes, or -1. */
function closeMath(s, i, to) {
  if (s[i] === '\\') {
    const end = s.indexOf('\\)', i + 2);
    return end < 0 || end >= to ? -1 : end + 2;
  }
  for (let k = i + 1; k < to; k++) {
    if (s[k] === '\\') k++;
    else if (s[k] === '$') return k + 1;
    else if (s[k] === '\n' && /^\n[ \t\r]*\n/.test(s.slice(k, k + 40))) return -1;
  }
  return -1;
}

/**
 * Split s[from, to) where `test` finds a separator outside braces,
 * environments and formulas. `test(i)` returns the separator's length or 0.
 * @returns {{ from: number, to: number }[]}
 */
function splitTop(s, from, to, test) {
  const pieces = [];
  let start = from;
  for (let i = from; i < to;) {
    const length = test(i);
    if (length) {
      pieces.push({ from: start, to: i });
      start = i + length;
      i = start;
      continue;
    }
    const char = s[i];
    if (char === '{') {
      const end = matching(s, i, to);
      i = end < 0 ? i + 1 : end;
    } else if (char === '$') {
      const end = s[i + 1] === '$' ? s.indexOf('$$', i + 2) + 2 : closeMath(s, i, to);
      i = end > i ? end : i + 1;
    } else if (char === '\\') {
      const cmd = command(s, i);
      if (cmd.name === 'begin') {
        const name = arg(s, cmd.end, to);
        const found = name && findEnd(s, name.end, name.text, to);
        i = found ? found.end : cmd.end;
      } else i = cmd.end;
    } else i++;
  }
  pieces.push({ from: start, to });
  return pieces;
}

// ---------- The page ----------

/**
 * @typedef {{ kind: string, from: number, to: number, html: string }} TexBlock
 * `html` is one element; positions inside it (data-eq) count from `from`.
 * @typedef {{ level: number, text: string, from: number }} TexHeading
 */

/** The CSS width of `width=…` in \includegraphics options, or ''. @param {string} options */
function figureWidth(options) {
  const value = /(?:^|,)\s*width\s*=\s*([^,]*)/u.exec(options)?.[1].trim() ?? '';
  const share = /^([\d.]*)\s*\\(?:textwidth|linewidth|columnwidth|hsize)$/u.exec(value);
  if (share) return `${Math.min(100, Number(share[1] || 1) * 100)}%`;
  return /^\d*\.?\d+(?:cm|mm|in|pt)$/u.test(value) ? value : '';
}

/** The folders \graphicspath{{a/}{b/}} names, in order. @param {string} masked */
function graphicsPath(masked) {
  const found = /\\graphicspath\s*\{((?:\s*\{[^{}]*\})+)\s*\}/u.exec(masked);
  return found ? [...found[1].matchAll(/\{([^{}]*)\}/gu)].map((match) => match[1].trim()) : [];
}

/**
 * Render TeX source as page blocks.
 * @param {string} source the text, with \n line breaks
 * @param {{ cache?: Map<string, string> }} [options] keeps rendered formulas between calls
 * @returns {{ blocks: TexBlock[], outline: TexHeading[], graphicsPath: string[] }}
 */
export function renderTex(source, { cache = new Map() } = {}) {
  const masked = maskComments(source);
  const begin = /\\begin\s*\{document\}/.exec(masked);
  const finish = begin ? masked.indexOf('\\end{document}', begin.index) : -1;
  const body = begin
    ? { from: begin.index + begin[0].length, to: finish < 0 ? masked.length : finish }
    : { from: 0, to: masked.length };
  let prior = { labels: new Map(), bib: new Map() };
  let result;
  // The first pass numbers everything and learns labels and bibliography; the second resolves them.
  for (let pass = 0; pass < 2; pass++) {
    const context = createContext(source, masked, cache, prior);
    if (begin) walkDefinitions(context, 0, begin.index);
    const blocks = flow(context, body.from, body.to, { top: true });
    if (context.footnotes.length)
      blocks.push({
        kind: 'notes',
        from: body.to,
        to: body.to,
        html: `<section class="ss-page__notes"><ol>${context.footnotes
          .map((note) => `<li>${note}</li>`)
          .join('')}</ol></section>`,
      });
    result = {
      blocks: blocks.map(relative),
      outline: context.outline,
      graphicsPath: graphicsPath(masked),
    };
    if (!context.refs && !(context.cites && context.bib.size)) break;
    prior = { labels: context.labels, bib: context.bib };
  }
  return result;
}

function createContext(source, masked, cache, prior) {
  const cjk = CJK.test(masked);
  return {
    source,
    s: masked,
    cjk,
    book: /\\chapter\b/.test(masked),
    cache,
    known: prior.labels,
    knownBib: prior.bib,
    labels: new Map(),
    refs: false,
    cites: false,
    macros: /** @type {Record<string, string>} */ ({}),
    macroKey: '',
    textMacros: /** @type {Record<string, {args:number, body:string}>} */ (Object.create(null)),
    theorems: /** @type {Record<string, {title:string, counter:string, numbered:boolean}>} */ (
      Object.create(null)
    ),
    counters: /** @type {Record<string, number>} */ ({}),
    bib: /** @type {Map<string, string>} */ (new Map()),
    current: { number: '', kind: '' },
    outline: /** @type {TexHeading[]} */ ([]),
    footnotes: /** @type {string[]} */ ([]),
    appendix: false,
    title: '',
    author: '',
    date: '',
    float: '',
    level: 0,
    listDepth: 0,
  };
}

const bump = (c, name) => (c.counters[name] = (c.counters[name] ?? 0) + 1);
const count = (c, name) => c.counters[name] ?? 0;
const chapterNumber = (c) =>
  c.appendix && c.book ? letter(count(c, 'chapter')) : String(count(c, 'chapter'));

/** The number shown for an equation, table or figure: (3-1), 3.1, or 1 without chapters. */
function itemNumber(c, name, separator = '.') {
  const n = bump(c, name);
  return c.book ? `${chapterNumber(c)}${separator}${n}` : String(n);
}

/** Read the definitions in s[from, to) (the preamble): macros, theorems, title. */
function walkDefinitions(c, from, to) {
  const s = c.s;
  for (let i = from; i < to;) {
    if (s[i] !== '\\') {
      i++;
      continue;
    }
    const cmd = command(s, i);
    i = DEFINES.has(cmd.name) ? define(c, cmd, i, to) : cmd.end;
  }
}

/**
 * A definition or setting command at i: record it and return where it ends,
 * or -1 when `cmd` is not one.
 */
function define(c, cmd, i, to) {
  const s = c.s;
  const { name } = cmd;
  if (!DEFINES.has(name)) return -1;
  if (name === 'title' || name === 'author' || name === 'date') {
    const short = opt(s, cmd.end, to);
    const value = arg(s, short ? short.end : cmd.end, to);
    if (!value) return cmd.end;
    c[name] = value.from + ':' + value.to;
    return value.end;
  }
  if (name === 'setcounter') {
    const counter = arg(s, cmd.end, to);
    const value = counter && arg(s, counter.end, to);
    if (!value) return cmd.end;
    c.counters[counter.text.trim()] = Number.parseInt(value.text, 10) || 0;
    return value.end;
  }
  if (name === 'theoremstyle') return skipArgs(s, cmd.end, 1, to);
  if (name === 'newtheorem') {
    const env = arg(s, cmd.end, to);
    if (!env) return cmd.end;
    const shared = opt(s, env.end, to);
    const title = arg(s, shared ? shared.end : env.end, to);
    if (!title) return env.end;
    const within = opt(s, title.end, to);
    c.theorems[env.text.trim()] = {
      title: title.text.trim(),
      counter: shared ? shared.text.trim() : env.text.trim(),
      numbered: !cmd.star,
    };
    return within ? within.end : title.end;
  }
  // \newcommand{\name}[n][default]{body}, \newcommand\name{body}, \def\name#1{body}
  let at = skipSpace(s, cmd.end, to);
  let macro = '';
  if (s[at] === '{') {
    const named = arg(s, at, to);
    if (!named) return cmd.end;
    macro = named.text.trim();
    at = named.end;
  } else if (s[at] === '\\') {
    const next = command(s, at);
    macro = s.slice(at, next.end).replace(/\*$/u, '');
    at = next.end;
  }
  if (!/^\\[A-Za-z@]+$|^\\.$/u.test(macro)) return at;
  let args = 0;
  if (name === 'def' || name === 'gdef') {
    const params = /^(#\d)*/u.exec(s.slice(at, to))?.[0] ?? '';
    args = params.length / 2;
    at += params.length;
  } else {
    const n = opt(s, at, to);
    if (n) {
      args = Number.parseInt(n.text, 10) || 0;
      at = n.end;
      const fallback = opt(s, at, to);
      if (fallback) at = fallback.end;
    }
  }
  const value = arg(s, at, to);
  if (!value) return at;
  if (name === 'DeclareMathOperator')
    c.macros[macro] = `\\operatorname${cmd.star ? '*' : ''}{${value.text}}`;
  else {
    c.macros[macro] = value.text;
    c.textMacros[macro.slice(1)] = { args, body: value.text };
  }
  c.macroKey = hash(JSON.stringify(c.macros));
  return value.end;
}

function block(kind, from, to, html) {
  return { kind, from, to, html };
}

/** Formula positions inside a top-level block count from the block's start. */
const relative = (item) => ({
  ...item,
  html: item.html.replace(
    /data-eq="(\d+),(\d+)"/g,
    (_, a, b) => `data-eq="${a - item.from},${b - item.from}"`,
  ),
});

/**
 * Blocks of s[from, to): paragraphs split at blank lines, with headings,
 * environments and display formulas as blocks of their own.
 * @returns {TexBlock[]}
 */
function flow(c, from, to, { top = false } = {}) {
  const s = c.s;
  /** @type {TexBlock[]} */
  const blocks = [];
  let start = -1;
  // TeX indents a paragraph after a blank line, not text that goes on after a formula.
  let indent = true;
  let noindent = false;
  const flush = (end) => {
    if (start < 0) return;
    const at = start;
    start = -1;
    const html = inline(c, at, end).trim();
    if (!html) return;
    const plain = !indent || noindent || (!c.cjk && blocks.at(-1)?.kind === 'heading');
    blocks.push(block('p', at, end, `<p${plain ? ' class="ss-page__noindent"' : ''}>${html}</p>`));
    indent = true;
    noindent = false;
  };
  const push = (items) => {
    blocks.push(...items);
    indent = false;
  };
  for (let i = from; i < to;) {
    const char = s[i];
    if (char === '\n') {
      let j = i + 1;
      while (j < to && (s[j] === ' ' || s[j] === '\t' || s[j] === '\r')) j++;
      if (j < to && s[j] !== '\n') {
        i = j;
        continue;
      }
      flush(i);
      indent = true;
      i = j;
      continue;
    }
    if (char === '$' && s[i + 1] === '$') {
      const end = s.indexOf('$$', i + 2);
      if (end >= 0 && end < to) {
        flush(i);
        push([displayMath(c, 'one*', '', i, i + 2, end, end + 2)]);
        i = end + 2;
        continue;
      }
    }
    if (char === '$') {
      if (start < 0) start = i;
      const end = closeMath(s, i, to);
      i = end < 0 ? i + 1 : end;
      continue;
    }
    if (char === '{') {
      if (start < 0) start = i;
      const end = matching(s, i, to);
      i = end < 0 ? i + 1 : end;
      continue;
    }
    if (char !== '\\') {
      if (start < 0 && !/\s/.test(char)) start = i;
      i++;
      continue;
    }
    const cmd = command(s, i);
    const { name } = cmd;
    if (name === '[') {
      const end = s.indexOf('\\]', cmd.end);
      if (end >= 0 && end < to) {
        flush(i);
        push([displayMath(c, 'one*', '', i, cmd.end, end, end + 2)]);
        i = end + 2;
        continue;
      }
    }
    if (has(HEADINGS, name)) {
      const short = opt(s, cmd.end, to);
      const title = arg(s, short ? short.end : cmd.end, to);
      if (title) {
        flush(i);
        push([heading(c, name, cmd.star, i, title)]);
        indent = c.cjk;
        i = title.end;
        continue;
      }
    }
    if (name === 'begin') {
      const env = arg(s, cmd.end, to);
      const found = env && findEnd(s, env.end, env.text, to);
      if (env && found) {
        flush(i);
        push(environment(c, env.text.trim(), i, env.end, found.inner, found.end));
        i = found.end;
        continue;
      }
      if (env) {
        // An environment still being typed: show its \begin as written and go on.
        flush(i);
        push([block('raw', i, env.end, `<p class="ss-page__raw">${esc(s.slice(i, env.end))}</p>`)]);
        i = env.end;
        continue;
      }
    }
    // A definition inside a paragraph is read again, as nothing, when the paragraph renders.
    const defined = define(c, cmd, i, to);
    if (defined >= 0) {
      i = defined;
      continue;
    }
    if (name === 'par') {
      flush(i);
      i = cmd.end;
      continue;
    }
    if (name === 'noindent' && start < 0) {
      noindent = true;
      i = cmd.end;
      continue;
    }
    if (name === 'appendix') {
      c.appendix = true;
      c.counters[c.book ? 'chapter' : 'section'] = 0;
      i = cmd.end;
      continue;
    }
    if (name === 'maketitle') {
      flush(i);
      push([titleBlock(c, i, cmd.end)]);
      i = cmd.end;
      continue;
    }
    if (name === 'caption' && c.float) {
      const short = opt(s, cmd.end, to);
      const text = arg(s, short ? short.end : cmd.end, to);
      if (text) {
        flush(i);
        push([caption(c, i, text)]);
        i = text.end;
        continue;
      }
    }
    if (name === 'bibliography' || name === 'printbibliography') {
      const end =
        name === 'bibliography' ? skipArgs(s, cmd.end, 1, to) : skipArgs(s, cmd.end, 0, to);
      flush(i);
      push([bibliographyNote(c, i, end)]);
      i = end;
      continue;
    }
    if (top && (name === 'input' || name === 'include' || name === 'subfile')) {
      const end = skipArgs(s, cmd.end, 1, to);
      flush(i);
      push([block('raw', i, end, `<p class="ss-page__raw">${esc(s.slice(i, end))}</p>`)]);
      i = end;
      continue;
    }
    if (start < 0 && has(TRANSPARENT_COMMANDS, name)) {
      const content = arg(s, skipArgs(s, cmd.end, TRANSPARENT_COMMANDS[name], to), to);
      if (content) {
        flush(i);
        push(flow(c, content.from, content.to));
        i = content.end;
        continue;
      }
    }
    if (start < 0 && has(SILENT, name)) {
      i = skipArgs(s, cmd.end, SILENT[name], to);
      continue;
    }
    if (start < 0) start = i;
    i = cmd.end;
  }
  flush(to);
  return blocks;
}

function sectionNumber(c, name) {
  const levels = c.book
    ? ['chapter', 'section', 'subsection', 'subsubsection']
    : ['section', 'subsection', 'subsubsection'];
  const depth = levels.indexOf(name);
  if (depth < 0) return '';
  bump(c, name);
  for (const lower of levels.slice(depth + 1)) c.counters[lower] = 0;
  if (name === 'chapter')
    for (const item of ['equation', 'table', 'figure', 'footnote']) c.counters[item] = 0;
  return levels
    .slice(0, depth + 1)
    .map((level, index) =>
      index === 0 && c.appendix ? letter(count(c, level)) : String(count(c, level)),
    )
    .join('.');
}

function heading(c, name, star, from, title) {
  const level = HEADINGS[name];
  const number = star || name === 'part' || level > 3 ? '' : sectionNumber(c, name);
  if (number) c.current = { number, kind: name === 'chapter' ? 'chapter' : 'section' };
  const text = inline(c, title.from, title.to);
  let label = number;
  if (number && name === 'chapter')
    label = c.cjk
      ? c.appendix
        ? `附录 ${number}`
        : `第${chineseNumber(Number(number))}章`
      : c.appendix
        ? `Appendix ${number}`
        : `Chapter ${number}`;
  const space = c.cjk ? '\u3000' : '\u2002';
  const tag = name === 'chapter' || name === 'part' ? 'h1' : `h${Math.min(level + 1, 4)}`;
  c.outline.push({
    level: name === 'part' ? 0 : Math.min(level, 3),
    text: plainText(label ? `${label} ${text}` : text),
    from,
  });
  c.level = level;
  return block(
    'heading',
    from,
    title.end,
    `<${tag}>${label ? `${esc(label)}${space}` : ''}${text}</${tag}>`,
  );
}

function caption(c, from, text) {
  const table = c.float === 'table';
  const number = itemNumber(c, c.float);
  c.current = { number, kind: c.float };
  const body = inline(c, text.from, text.to);
  const prefix = c.cjk
    ? `${table ? '表' : '图'} ${number}\u3000`
    : `${table ? 'Table' : 'Figure'} ${number}: `;
  c.outline.push({ level: Math.min(c.level + 1, 3), text: plainText(prefix + body), from });
  return block('caption', from, text.end, `<p class="ss-page__caption">${esc(prefix)}${body}</p>`);
}

function titleBlock(c, from, to) {
  const part = (range) => {
    if (!range) return '';
    const [a, b] = range.split(':').map(Number);
    return inline(c, a, b, { lines: true });
  };
  const title = part(c.title);
  const author = part(c.author);
  const date = part(c.date);
  if (title) c.outline.push({ level: 0, text: plainText(title), from });
  return block(
    'title',
    from,
    to,
    `<header class="ss-page__title">${title ? `<h1>${title}</h1>` : ''}${
      author ? `<p class="ss-page__center">${author}</p>` : ''
    }${date ? `<p class="ss-page__center">${date}</p>` : ''}</header>`,
  );
}

function bibliographyNote(c, from, to) {
  const title = c.cjk ? '参考文献' : 'References';
  return block(
    'bib',
    from,
    to,
    `<section class="ss-page__bib"><h2>${title}</h2><p class="ss-page__raw">${esc(
      t('文献列表在编译 PDF 时生成'),
    )}</p></section>`,
  );
}

// ---------- Environments ----------

/** @returns {TexBlock[]} */
function environment(c, name, from, innerFrom, innerTo, to) {
  const s = c.s;
  if (has(MATH, name)) return [displayMath(c, MATH[name], name, from, innerFrom, innerTo, to)];
  if (name === 'math')
    return [
      block(
        'p',
        from,
        to,
        `<p><span class="ss-eqbox ss-eqbox--inline" data-eq="${innerFrom},${innerTo}">${katexHtml(
          c,
          s.slice(innerFrom, innerTo),
          false,
        )}</span></p>`,
      ),
    ];
  if (has(LISTS, name)) return [list(c, LISTS[name], from, innerFrom, innerTo, to)];
  if (has(FLOATS, name)) return [float(c, FLOATS[name], name, from, innerFrom, innerTo, to)];
  if (has(TABULARS, name)) return [tabular(c, name, from, innerFrom, innerTo, to)];
  if (VERBATIM.has(name)) {
    const at =
      name === 'minted' ? skipArgs(s, innerFrom, 1, innerTo) : skipArgs(s, innerFrom, 0, innerTo);
    const text = c.source
      .slice(at, innerTo)
      .replace(/^[ \t]*\n/u, '')
      .replace(/\n[ \t]*$/u, '');
    return [block('pre', from, to, `<pre class="ss-page__pre">${esc(text)}</pre>`)];
  }
  if (has(TRANSPARENT, name))
    return flow(c, skipArgs(s, innerFrom, TRANSPARENT[name], innerTo), innerTo);
  const inner = (at = innerFrom) =>
    flow(c, at, innerTo)
      .map((item) => item.html)
      .join('');
  if (QUOTES.has(name)) return [block('quote', from, to, `<blockquote>${inner()}</blockquote>`)];
  if (name === 'center')
    return [block('center', from, to, `<div class="ss-page__center">${inner()}</div>`)];
  if (name === 'abstract') {
    const title = c.cjk ? '摘要' : 'Abstract';
    return [
      block(
        'abstract',
        from,
        to,
        `<section class="ss-page__abstract"><h3>${title}</h3>${inner()}</section>`,
      ),
    ];
  }
  if (name === 'thebibliography')
    return [bibliography(c, from, skipArgs(s, innerFrom, 1, innerTo), innerTo, to)];
  const bare = name.replace(/\*$/u, '');
  const theorem = has(c.theorems, bare) ? c.theorems[bare] : null;
  const names = c.cjk ? THEOREMS_CJK : THEOREMS_EN;
  const known = has(names, bare) ? names[bare] : '';
  if (theorem || known || name === 'proof') {
    const note = opt(s, innerFrom, innerTo);
    let head;
    if (name === 'proof') head = `<em>${c.cjk ? '证明' : 'Proof.'}</em>`;
    else {
      const numbered = theorem ? theorem.numbered && !name.endsWith('*') : !name.endsWith('*');
      const counter = theorem?.counter ?? bare;
      const number = numbered ? String(bump(c, `thm:${counter}`)) : '';
      if (number) c.current = { number, kind: 'theorem' };
      head = `<strong>${esc(theorem?.title ?? known)}${number ? ` ${number}` : ''}</strong>`;
    }
    if (note)
      head += c.cjk
        ? `（${inline(c, note.from, note.to)}）`
        : ` (${inline(c, note.from, note.to)})`;
    const parts = flow(c, note ? note.end : innerFrom, innerTo).map((item) => item.html);
    const space = c.cjk ? '\u3000' : ' ';
    if (parts[0]?.startsWith('<p'))
      parts[0] = parts[0].replace(/^<p[^>]*>/u, `<p class="ss-page__noindent">${head}${space}`);
    else parts.unshift(`<p class="ss-page__noindent">${head}</p>`);
    if (name === 'proof') parts.push('<p class="ss-page__qed">∎</p>');
    return [block('theorem', from, to, `<div class="ss-page__thm">${parts.join('')}</div>`)];
  }
  // Not known: the content as usual between its \begin and \end, shown faint.
  const open = esc(s.slice(from, innerFrom));
  const close = esc(s.slice(innerTo, to));
  return [
    block(
      'env',
      from,
      to,
      `<div class="ss-page__env"><p class="ss-page__raw">${open}</p>${inner()}<p class="ss-page__raw">${close}</p></div>`,
    ),
  ];
}

function list(c, tag, from, innerFrom, innerTo, to) {
  const s = c.s;
  const items = splitTop(s, innerFrom, innerTo, (i) =>
    s.startsWith('\\item', i) && !/[A-Za-z]/.test(s[i + 5] ?? '') ? 5 : 0,
  ).slice(1);
  const depth = (c.listDepth = (c.listDepth ?? 0) + 1);
  const html = items.map((item, index) => {
    const label = opt(s, item.from, item.to);
    const at = label ? label.end : item.from;
    if (tag === 'ol') {
      const number =
        depth === 1
          ? String(index + 1)
          : depth === 2
            ? String.fromCharCode(97 + index)
            : roman(index + 1);
      c.current = { number, kind: 'item' };
    }
    const parts = flow(c, at, item.to);
    // The item's first paragraph runs on from its label, as on the page.
    const body = parts
      .map((part, k) =>
        k === 0 && part.kind === 'p' ? part.html.replace(/^<p[^>]*>|<\/p>$/gu, '') : part.html,
      )
      .join('');
    const term = label ? inline(c, label.from, label.to) : '';
    if (tag === 'dl') return `<dt>${term}</dt><dd>${body}</dd>`;
    return label ? `<li data-label="${esc(plainText(term))}">${body}</li>` : `<li>${body}</li>`;
  });
  c.listDepth = depth - 1;
  return block('list', from, to, `<${tag}>${html.join('')}</${tag}>`);
}

function bibliography(c, from, innerFrom, innerTo, to) {
  const s = c.s;
  const items = splitTop(s, innerFrom, innerTo, (i) =>
    s.startsWith('\\bibitem', i) && !/[A-Za-z]/.test(s[i + 8] ?? '') ? 8 : 0,
  ).slice(1);
  const entries = items.map((item, index) => {
    const label = opt(s, item.from, item.to);
    const key = arg(s, label ? label.end : item.from, item.to);
    const number = label ? label.text : String(index + 1);
    if (key) for (const name of key.text.split(',')) c.bib.set(name.trim(), number);
    return `<li>[${esc(number)}] ${inline(c, key ? key.end : item.from, item.to)}</li>`;
  });
  const title = c.cjk ? '参考文献' : 'References';
  return block(
    'bib',
    from,
    to,
    `<section class="ss-page__bib"><h2>${title}</h2><ol>${entries.join('')}</ol></section>`,
  );
}

function float(c, kind, name, from, innerFrom, innerTo, to) {
  const s = c.s;
  const outer = c.float;
  c.float = kind;
  const at = skipArgs(s, innerFrom, name.startsWith('wrap') ? 2 : 0, innerTo);
  const parts = flow(c, at, innerTo);
  c.float = outer;
  const captions = parts.filter((part) => part.kind === 'caption');
  const tables = parts.filter((part) => part.kind === 'table');
  let html = parts.map((part) => part.html);
  // One caption and one table: the caption sits on the table, as on the page.
  if (captions.length === 1 && tables.length === 1) {
    const text = captions[0].html.replace(/^<p[^>]*>|<\/p>$/gu, '');
    html = parts
      .filter((part) => part.kind !== 'caption')
      .map((part) =>
        part.kind === 'table'
          ? part.html.replace('<table>', `<table><caption>${text}</caption>`)
          : part.html,
      );
  }
  return block(
    kind,
    from,
    to,
    `<div class="ss-page__float" data-float="${kind}">${html.join('')}</div>`,
  );
}

function tabular(c, name, from, innerFrom, innerTo, to) {
  const s = c.s;
  // \begin{tabular}{lcc}, \begin{tabular*}{width}{spec}, \begin{tabularx}{width}{spec}
  let at = innerFrom;
  if (TABULARS[name] === 2) at = skipArgs(s, at, 1, innerTo);
  const positional = opt(s, at, innerTo);
  if (positional) at = positional.end;
  const spec = arg(s, at, innerTo);
  if (spec) at = spec.end;
  const align = columnAlign(spec?.text ?? '');
  const rule =
    /^\s*(?:\\(?:hline|toprule|midrule|bottomrule|cline|cmidrule|addlinespace|specialrule|rowcolor)\b(?:\([^)]*\))?(?:\s*\[[^\]]*\])?(?:\s*\{[^}]*\})*\s*)+/u;
  const rows = splitTop(s, at, innerTo, (i) =>
    s.startsWith('\\\\', i) ? 2 : s.startsWith('\\tabularnewline', i) ? 15 : 0,
  ).map((piece) => {
    let start = piece.from;
    // \\[4pt] spacing after the row break.
    const space = /^\[[^\]]*\]/u.exec(s.slice(start, piece.to));
    if (space) start += space[0].length;
    const lead = rule.exec(s.slice(start, piece.to));
    const rules = lead ? lead[0] : '';
    return { from: start + rules.length, to: piece.to, rules };
  });
  const bodyRows = rows.filter((row) => /\S/.test(s.slice(row.from, row.to)));
  let head = rows.findIndex((row, index) => index > 0 && /\\midrule\b/.test(row.rules));
  if (head < 0 && /\\hline/.test(rows[0]?.rules ?? '')) {
    const second = rows.findIndex((row, index) => index > 0 && /\\hline/.test(row.rules));
    if (second > 0 && second < rows.length - 1) head = second;
  }
  const headCount =
    head < 0 ? 0 : rows.slice(0, head).filter((row) => bodyRows.includes(row)).length;
  const html = bodyRows.map((row, index) => {
    const cell = index < headCount ? 'th' : 'td';
    let column = 0;
    const cells = splitTop(s, row.from, row.to, (i) => (s[i] === '&' ? 1 : 0)).map((piece) => {
      let span = 1;
      const text = s.slice(piece.from, piece.to);
      let content = () => inline(c, piece.from, piece.to);
      const multi = /^\s*\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*/u.exec(text);
      if (multi) {
        span = Number(multi[1]) || 1;
        const inside = arg(s, piece.from + multi[0].length, piece.to);
        if (inside) content = () => inline(c, inside.from, inside.to);
      }
      const cellAlign = multi ? columnAlign(multi[2])[0] : align[column];
      column += span;
      return `<${cell}${span > 1 ? ` colspan="${span}"` : ''}${cellAlign && cellAlign !== 'c' ? ` data-align="${cellAlign}"` : ''}>${content().trim()}</${cell}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  const headHtml = headCount ? `<thead>${html.slice(0, headCount).join('')}</thead>` : '';
  return block(
    'table',
    from,
    to,
    `<table>${headHtml}<tbody>${html.slice(headCount).join('')}</tbody></table>`,
  );
}

/** Column alignments of a tabular spec: lcr, p{…} as l, *{3}{c} expanded. */
function columnAlign(spec) {
  const expanded = spec.replace(/\*\s*\{(\d+)\}\s*\{([^{}]*)\}/gu, (_, n, inner) =>
    inner.repeat(Number(n)),
  );
  const out = [];
  for (let i = 0; i < expanded.length; i++) {
    const char = expanded[i];
    if (char === '@' || char === '>' || char === '<' || char === '!') {
      const group = matching(expanded, expanded.indexOf('{', i));
      if (group > 0) i = group - 1;
    } else if ('lcr'.includes(char)) out.push(char);
    else if ('pmbX'.includes(char)) {
      out.push('l');
      if (expanded[i + 1] === '{') {
        const group = matching(expanded, i + 1);
        if (group > 0) i = group - 1;
      }
    } else if (char === 'S') out.push('c');
  }
  return out;
}

// ---------- Formulas ----------

/** Labels inside a formula: recorded with the formula's number and removed. */
function stripLabels(c, latex, number) {
  return latex.replace(/\\label\s*\{([^{}]*)\}/gu, (_, key) => {
    if (number) c.labels.set(key.trim(), { number, kind: 'equation' });
    return '';
  });
}

/** A short FNV-1a hash, to key cached formulas by the macros they saw. @param {string} text */
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 0x01000193);
  return (value >>> 0).toString(36);
}

function katexHtml(c, latex, display) {
  const key = `${c.macroKey}${display ? 'D' : 'I'}${latex}`;
  const cached = c.cache.get(key);
  if (cached != null) return cached;
  let html;
  try {
    html = katex.renderToString(latex, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      macros: { ...c.macros },
      output: 'html',
    });
  } catch (failure) {
    html = `<code class="ss-page__raw" title="${esc(failure.message)}">${esc(latex.trim())}</code>`;
  }
  if (c.cache.size > 4000) c.cache.clear();
  c.cache.set(key, html);
  return html;
}

/**
 * A display formula. `kind` is one (numbered once), rows (align and gather:
 * a number per row) or lines (multline); a trailing * means unnumbered.
 */
function displayMath(c, kind, name, from, innerFrom, innerTo, to) {
  const s = c.s;
  const raw = s.slice(innerFrom, innerTo);
  const numbered = !kind.endsWith('*');
  const base = kind.replace(/\*$/u, '');
  if (base === 'rows') {
    // KaTeX numbers rows itself; give each row its number with \tag on the starred form.
    const env = name.startsWith('eqnarray') ? 'align*' : name.replace(/\*?$/u, '*');
    const rows = splitTop(s, innerFrom, innerTo, (i) => (s.startsWith('\\\\', i) ? 2 : 0));
    const latex = rows
      .map((row, index) => {
        let text = s.slice(row.from, row.to);
        if (name.startsWith('eqnarray')) text = text.replace(/&\s*([^&]*?)\s*&/u, '&$1 ');
        const last = index === rows.length - 1 && !/\S/.test(text);
        if (!numbered || last) return stripLabels(c, text, '');
        if (/\\(?:nonumber|notag)\b/u.test(text))
          return stripLabels(c, text.replace(/\\(?:nonumber|notag)\b/gu, ''), '');
        const tag = /\\tag\*?\s*\{([^{}]*)\}/u.exec(text);
        if (tag) return stripLabels(c, text, tag[1]);
        const number = itemNumber(c, 'equation', c.cjk ? '-' : '.');
        c.current = { number, kind: 'equation' };
        return `${stripLabels(c, text, number)} \\tag{${number}}`;
      })
      .join('\\\\');
    // alignat's column count is the start of the first row, so it follows \begin.
    const html = katexHtml(c, `\\begin{${env}}${latex}\\end{${env}}`, true);
    return block(
      'math',
      from,
      to,
      `<p class="ss-page__eq"><span class="ss-eqbox ss-eqbox--wide" data-eq="${innerFrom},${innerTo}" data-rows>${html}</span></p>`,
    );
  }
  const tag = /\\tag\*?\s*\{([^{}]*)\}/u.exec(raw);
  const number = numbered && !tag ? itemNumber(c, 'equation', c.cjk ? '-' : '.') : '';
  if (number) c.current = { number, kind: 'equation' };
  let latex = stripLabels(c, raw, number || tag?.[1] || '');
  if (base === 'lines') latex = `\\begin{gathered}${latex}\\end{gathered}`;
  const html = katexHtml(c, latex, true);
  return block(
    'math',
    from,
    to,
    `<p class="ss-page__eq"><span class="ss-eqbox" data-eq="${innerFrom},${innerTo}"${
      number ? ` data-number="${number}"` : ''
    }>${html}</span>${number ? `<span class="ss-page__eqno">(${number})</span>` : ''}</p>`,
  );
}

// ---------- Inline text ----------

const cjkAt = (s, i) => i >= 0 && i < s.length && CJK.test(s[i]);

/**
 * Text, commands and inline formulas of s[from, to) as HTML.
 * @param {{ lines?: boolean, detached?: boolean }} [options] `detached`: s is not the
 * document (a macro's body), so formulas carry no position.
 */
function inline(c, from, to, options = {}, s = c.s, depth = 0) {
  let out = '';
  let text = '';
  const flushText = () => {
    out += esc(text);
    text = '';
  };
  for (let i = from; i < to;) {
    const char = s[i];
    if (/\s/.test(char)) {
      let j = i;
      while (j < to && /\s/.test(s[j])) j++;
      // Line breaks between Chinese characters vanish, as with xeCJK and ctex.
      if (!(cjkAt(s, i - 1) && cjkAt(s, j)) && i > from && j < to) text += ' ';
      i = j;
      continue;
    }
    if (char === '~') {
      text += '\u00a0';
      i++;
      continue;
    }
    if (char === '-' && s[i + 1] === '-') {
      const em = s[i + 2] === '-';
      text += em ? '—' : '–';
      i += em ? 3 : 2;
      continue;
    }
    if (char === '`' || char === "'") {
      const double = s[i + 1] === char;
      text += char === '`' ? (double ? '“' : '‘') : double ? '”' : '’';
      i += double ? 2 : 1;
      continue;
    }
    if (char === '{') {
      const end = matching(s, i, to);
      const close = end < 0 ? to : end - 1;
      flushText();
      out += inline(c, i + 1, close, options, s, depth);
      i = end < 0 ? to : end;
      continue;
    }
    if (char === '}') {
      i++;
      continue;
    }
    if (char === '$' || (char === '\\' && s[i + 1] === '(')) {
      const display = char === '$' && s[i + 1] === '$';
      const open = display ? 2 : char === '$' ? 1 : 2;
      const end = display ? s.indexOf('$$', i + 2) + 2 : closeMath(s, i, to);
      if (end > i && end <= to) {
        flushText();
        const inner = [i + open, end - open];
        const html = katexHtml(c, stripLabels(c, s.slice(inner[0], inner[1]), ''), display);
        const at = options.detached ? '' : ` data-eq="${inner[0]},${inner[1]}"`;
        out += `<span class="ss-eqbox ss-eqbox--inline"${at}>${html}</span>`;
        i = end;
        continue;
      }
      text += char;
      i++;
      continue;
    }
    if (char !== '\\') {
      text += char;
      i++;
      continue;
    }
    flushText();
    const result = inlineCommand(c, s, i, to, options, depth);
    out += result.html;
    if (result.rest) {
      out += `<${result.rest}>${inline(c, result.end, to, options, s, depth)}</${result.rest}>`;
      return out;
    }
    i = result.end;
  }
  flushText();
  return out;
}

/** One command in running text. `rest` wraps the rest of the group (\bfseries). */
function inlineCommand(c, s, i, to, options, depth) {
  const cmd = command(s, i);
  const { name } = cmd;
  const after = cmd.end;
  const one = (tag) => {
    const value = arg(s, after, to);
    if (!value) return { html: '', end: after };
    return {
      html: `<${tag}>${inline(c, value.from, value.to, options, s, depth)}</${tag}>`,
      end: value.end,
    };
  };
  if (name === '\\' || name === 'newline' || name === 'linebreak') {
    const end = name === '\\' ? skipArgs(s, after, 0, to) : after;
    return { html: options.lines !== false ? '<br>' : ' ', end };
  }
  if (has(SYMBOLS, name)) {
    // A control word eats the spaces after it.
    let end = after;
    if (/[A-Za-z]/.test(name)) {
      if (s[end] === '{' && s[end + 1] === '}') end += 2;
      else while (end < to && (s[end] === ' ' || s[end] === '\t')) end++;
    }
    return { html: esc(SYMBOLS[name]), end };
  }
  if (has(ACCENTS, name)) {
    const value = arg(s, after, to);
    const base = value ? value.text : s[skipSpace(s, after, to)];
    const end = value ? value.end : skipSpace(s, after, to) + 1;
    if (!base) return { html: '', end: after };
    return { html: esc((base.replace(/^\\i$/u, 'ı') + ACCENTS[name]).normalize('NFC')), end };
  }
  if (name === 'today') return { html: esc(new Date().toISOString().slice(0, 10)), end: after };
  if (has(WRAP, name)) return one(WRAP[name]);
  if (name === 'enquote') {
    const value = arg(s, after, to);
    if (!value) return { html: '', end: after };
    return { html: `“${inline(c, value.from, value.to, options, s, depth)}”`, end: value.end };
  }
  if (has(DECLARATIONS, name)) return { html: '', end: after, rest: DECLARATIONS[name] };
  if (has(PLAIN, name)) {
    const end = skipArgs(s, after, PLAIN[name], to);
    const value = arg(s, end, to);
    if (!value) return { html: '', end };
    return { html: inline(c, value.from, value.to, options, s, depth), end: value.end };
  }
  if (name === 'url') {
    const value = arg(s, after, to);
    if (!value) return { html: '', end: after };
    return { html: `<span class="ss-page__url">${esc(value.text)}</span>`, end: value.end };
  }
  if (name === 'href') {
    const target = arg(s, after, to);
    const value = target && arg(s, target.end, to);
    if (!value) return { html: '', end: after };
    return {
      html: `<span class="ss-page__url" title="${esc(target.text)}">${inline(c, value.from, value.to, options, s, depth)}</span>`,
      end: value.end,
    };
  }
  if (name === 'verb') {
    const delimiter = s[after];
    const end = delimiter ? s.indexOf(delimiter, after + 1) : -1;
    if (end < 0 || /\n/.test(s.slice(after, end)))
      return { html: esc(s.slice(i, after)), end: after };
    return { html: `<code>${esc(c.source.slice(after + 1, end))}</code>`, end: end + 1 };
  }
  if (name === 'footnote') {
    const mark = opt(s, after, to);
    const value = arg(s, mark ? mark.end : after, to);
    if (!value) return { html: '', end: after };
    const number = mark ? mark.text : String(bump(c, 'footnote'));
    c.footnotes.push(inline(c, value.from, value.to, options, s, depth));
    return { html: `<sup class="ss-page__fn">${esc(number)}</sup>`, end: value.end };
  }
  if (name === 'label') {
    const value = arg(s, after, to);
    if (!value) return { html: '', end: after };
    if (c.current.number) c.labels.set(value.text.trim(), { ...c.current });
    return { html: '', end: value.end };
  }
  if (CITES.has(name) || TEXT_CITES.has(name)) {
    const first = opt(s, after, to);
    const second = first && opt(s, first.end, to);
    const keys = arg(s, (second ?? first)?.end ?? after, to);
    if (!keys) return { html: '', end: after };
    const note = (range) =>
      range ? inline(c, range.from, range.to, options, s, depth).trim() : '';
    const pre = second ? note(first) : '';
    const post = note(second ?? first);
    return { html: citation(c, name, keys.text, pre, post), end: keys.end };
  }
  if (REFS.has(name)) {
    const value = arg(s, after, to);
    if (!value) return { html: '', end: after };
    return { html: esc(reference(c, name, value.text.trim())), end: value.end };
  }
  if (name === 'includegraphics') {
    const end = skipArgs(s, after, 1, to);
    const keys = opt(s, after, to);
    const file = arg(s, skipArgs(s, after, 0, to), to);
    const src = file ? file.text.trim() : '';
    const width = figureWidth(keys?.text ?? '');
    return {
      html: `<span class="ss-page__fig" data-src="${esc(src)}"${
        width ? ` style="--fig-w: ${width}"` : ''
      }>${esc(src)}</span>`,
      end,
    };
  }
  if (has(SILENT, name)) return { html: '', end: skipArgs(s, after, SILENT[name], to) };
  const macro = has(c.textMacros, name) ? c.textMacros[name] : null;
  if (macro && depth < 6) {
    let end = after;
    const values = [];
    for (let k = 0; k < macro.args; k++) {
      const value = arg(s, end, to);
      if (!value) break;
      values.push(value.text);
      end = value.end;
    }
    if (!macro.args) while (end < to && (s[end] === ' ' || s[end] === '\t')) end++;
    const body = macro.body.replace(/#(\d)/gu, (_, n) => values[Number(n) - 1] ?? '');
    return {
      html: inline(c, 0, body.length, { ...options, detached: true }, body, depth + 1),
      end,
    };
  }
  if (DEFINES.has(name)) {
    const end = define(c, cmd, i, to);
    return { html: '', end: end < 0 ? after : end };
  }
  // Not known: shown as written, arguments included.
  let end = after;
  for (;;) {
    const next = opt(s, end, to) ?? arg(s, end, to);
    if (!next || /\n[ \t]*\n/u.test(s.slice(end, next.end))) break;
    end = next.end;
  }
  return { html: `<span class="ss-page__raw">${esc(s.slice(i, end))}</span>`, end };
}

/** "ragin2008" as "Ragin, 2008"; numbered when the file has its own bibliography. */
function citation(c, name, keys, pre, post) {
  const names = keys
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
  c.cites = true;
  const bib = c.knownBib.size ? c.knownBib : c.bib;
  const label = (key) => {
    if (bib.has(key)) return bib.get(key);
    const match = /^([A-Za-z]+?)[_-]?((?:19|20)\d{2})[a-z]?$/u.exec(key);
    if (!match) return key;
    const author = match[1][0].toUpperCase() + match[1].slice(1);
    return TEXT_CITES.has(name) ? `${author} (${match[2]})` : `${author}, ${match[2]}`;
  };
  const text = esc(names.map(label).join(bib.size ? ', ' : '; '));
  const inner = [pre, text].filter(Boolean).join(' ') + (post ? `, ${post}` : '');
  const shown = TEXT_CITES.has(name) && !names.every((key) => bib.has(key)) ? inner : `[${inner}]`;
  return `<span class="ss-page__cite" title="${esc(names.join(', '))}">${shown}</span>`;
}

function reference(c, name, key) {
  c.refs = true;
  const found = c.known.get(key) ?? c.labels.get(key);
  if (!found) return '??';
  const number = found.number;
  if (name === 'eqref') return `(${number})`;
  if (name !== 'autoref' && name !== 'cref' && name !== 'Cref') return number;
  const words = c.cjk
    ? {
        equation: `式 (${number})`,
        table: `表 ${number}`,
        figure: `图 ${number}`,
        section: `第 ${number} 节`,
        chapter: `第 ${number} 章`,
      }
    : {
        equation: `Eq. (${number})`,
        table: `Table ${number}`,
        figure: `Figure ${number}`,
        section: `Section ${number}`,
        chapter: `Chapter ${number}`,
      };
  return words[found.kind] ?? number;
}

/** HTML to plain text, for the outline. */
function plainText(html) {
  return html
    .replace(/<span class="katex-mathml">[\s\S]*?<\/span>/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, '&')
    .replace(/\s+/gu, ' ')
    .trim();
}

// ---------- Writing a formula back ----------

const LABELS = /\\label\s*\{[^{}]*\}/gu;

/**
 * What the source becomes: the new LaTeX with the old surrounding whitespace
 * and labels; labels at either end stay there, others follow the formula.
 * @param {string} original the formula's source @param {string} latex
 */
export function formulaSource(original, latex) {
  const lead = /^(?:\s|\\label\s*\{[^{}]*\})*/u.exec(original)[0];
  const rest = original.slice(lead.length);
  const trail = /(?:\s|\\label\s*\{[^{}]*\})*$/u.exec(rest)[0];
  const inside = rest.slice(0, rest.length - trail.length).match(LABELS) ?? [];
  return `${lead}${[latex.trim(), ...inside].join(' ')}${trail}`;
}

/** The formula as the field shows it: no labels, no outer whitespace. @param {string} source */
export const formulaLatex = (source) => source.replace(LABELS, '').trim();
