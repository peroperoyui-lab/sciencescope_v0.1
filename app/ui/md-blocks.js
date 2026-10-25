// Markdown as an editable page (EDITING_DESK.md §10, U6b). The source is
// read with marked, the same reader as the read-only view, into ProseMirror
// blocks; each top-level block keeps its source text, the blank lines before
// it and where its characters sit in that text. A changed block is written
// back as Markdown, every other block keeps its text as it was. No DOM here,
// so node tests cover reading, writing and the position maps.
import { Marked } from 'marked';
import { Fragment, Schema } from './readers/vendor.js';
import { mathExtensions } from './markdown.js';

const lexer = new Marked({ gfm: true, breaks: true });
lexer.use({ extensions: mathExtensions(() => '') });

const block = { group: 'block' };
const inline = { group: 'inline', inline: true };

export const mdSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { ...block, content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    heading: {
      ...block,
      attrs: { level: { default: 1 } },
      content: 'inline*',
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${node.attrs.level}`, 0],
    },
    blockquote: {
      ...block,
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    },
    code_block: {
      ...block,
      attrs: { info: { default: '' }, fence: { default: '```' }, indent: { default: null } },
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: () => ['pre', { class: 'ss-page__pre' }, ['code', 0]],
    },
    bullet_list: {
      ...block,
      attrs: { marker: { default: '-' }, loose: { default: false } },
      content: 'list_item+',
      parseDOM: [{ tag: 'ul' }],
      toDOM: (node) => ['ul', node.attrs.loose ? {} : { 'data-tight': '' }, 0],
    },
    ordered_list: {
      ...block,
      attrs: { start: { default: 1 }, delim: { default: '.' }, loose: { default: false } },
      content: 'list_item+',
      parseDOM: [
        { tag: 'ol', getAttrs: (dom) => ({ start: Number(dom.getAttribute('start')) || 1 }) },
      ],
      toDOM: (node) => [
        'ol',
        {
          ...(node.attrs.start === 1 ? {} : { start: node.attrs.start }),
          ...(node.attrs.loose ? {} : { 'data-tight': '' }),
        },
        0,
      ],
    },
    list_item: {
      attrs: { checked: { default: null } },
      content: 'block+',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: (node) => [
        'li',
        node.attrs.checked == null
          ? {}
          : { class: 'ss-md-task', 'data-checked': String(node.attrs.checked) },
        0,
      ],
    },
    horizontal_rule: { ...block, atom: true, parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
    // $$ … $$, shown by the page's node view.
    math_block: {
      ...block,
      atom: true,
      attrs: { tex: { default: '' }, raw: { default: null } },
      toDOM: () => ['div', { class: 'ss-md-math' }],
    },
    // Tables, HTML, link definitions: kept as written, edited in the source.
    raw: {
      ...block,
      atom: true,
      attrs: { source: { default: '' }, kind: { default: 'html' } },
      toDOM: () => ['div', { class: 'ss-md-raw' }],
    },
    text: { group: 'inline' },
    hard_break: {
      ...inline,
      attrs: { raw: { default: '\n' } },
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      leafText: () => '\n',
      toDOM: () => ['br'],
    },
    image: {
      ...inline,
      atom: true,
      attrs: { src: { default: '' }, alt: { default: '' }, raw: { default: '' } },
      leafText: (node) => node.attrs.alt,
      toDOM: () => ['span', { class: 'ss-md-img' }],
    },
    math_inline: {
      ...inline,
      atom: true,
      attrs: { tex: { default: '' }, raw: { default: null } },
      leafText: (node) => `$${node.attrs.tex}$`,
      toDOM: () => ['span', { class: 'ss-eqbox ss-eqbox--inline' }],
    },
    html_inline: {
      ...inline,
      atom: true,
      attrs: { source: { default: '' } },
      leafText: (node) => node.attrs.source,
      toDOM: (node) => ['code', { class: 'ss-page__raw' }, node.attrs.source],
    },
  },
  marks: {
    link: {
      attrs: {
        href: { default: '' },
        dest: { default: '' },
        title: { default: '' },
        style: { default: 'inline' },
        label: { default: '' },
      },
      inclusive: false,
      parseDOM: [{ tag: 'a[href]', getAttrs: (dom) => ({ href: dom.getAttribute('href') }) }],
      toDOM: (mark) => ['a', { href: mark.attrs.href, class: 'ss-page__url' }, 0],
    },
    strong: {
      attrs: { marker: { default: '**' } },
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM: () => ['strong', 0],
    },
    em: {
      attrs: { marker: { default: '*' } },
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
      toDOM: () => ['em', 0],
    },
    strike: {
      attrs: { marker: { default: '~~' } },
      parseDOM: [{ tag: 's' }, { tag: 'del' }],
      toDOM: () => ['s', 0],
    },
    code: {
      attrs: { ticks: { default: '`' } },
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
  },
});

const S = mdSchema;
// What an inline atom counts as in the page: one position, never equal to its source.
const ATOM = String.fromCharCode(0);
const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCharCode(160),
};

/** Character references in text, as the reader shows them. @param {string} text */
function decode(text) {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/giu, (whole, name) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
    const code =
      name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
  });
}

/**
 * Reading state for one top-level block: where the next source piece is
 * looked for, the ProseMirror position reached, and the pieces found.
 * @typedef {{ src: string, cursor: number, limit: number, base: number, pos: number,
 *   segs: {pm:number,len:number,src:number,srcLen:number}[] }} Reading
 */

/** Find `piece` at or after the cursor, inside this block. @param {Reading} r @param {string} piece */
function find(r, piece) {
  if (!piece) return -1;
  const at = r.src.indexOf(piece, r.cursor);
  return at < 0 || at + piece.length > r.limit ? -1 : at;
}

/**
 * Record `text` (as shown) for the source `raw`, one to one when they are
 * the same, else as one piece. Lines are looked for one by one, since list
 * items and quotes drop their indent from the raw text.
 * @param {Reading} r @param {string} text @param {string} raw
 */
function place(r, text, raw) {
  if (text === raw) {
    let pm = r.pos;
    for (const line of raw.split(/(?<=\n)/u)) {
      const at = find(r, line);
      if (at >= 0) {
        r.segs.push({ pm, len: line.length, src: at - r.base, srcLen: line.length });
        r.cursor = at + line.length;
      }
      pm += line.length;
    }
  } else {
    const at = find(r, raw);
    if (at >= 0) {
      r.segs.push({ pm: r.pos, len: text.length, src: at - r.base, srcLen: raw.length });
      r.cursor = at + raw.length;
    }
  }
  r.pos += text.length;
}

/** @param {Reading} r @param {any[]} out @param {string} text @param {string} raw @param {readonly any[]} marks */
function addText(r, out, text, raw, marks) {
  if (!text) return;
  // A line break inside text is a break in the page, as in the reader.
  const parts = text === raw ? text.split('\n') : [text.replace(/\n/gu, ' ')];
  if (parts.length > 1) {
    parts.forEach((part, index) => {
      if (index) {
        const at = find(r, '\n');
        if (at >= 0) {
          r.segs.push({ pm: r.pos, len: 1, src: at - r.base, srcLen: 1 });
          r.cursor = at + 1;
        }
        r.pos += 1;
        out.push(S.nodes.hard_break.create());
      }
      if (part) {
        place(r, part, part);
        out.push(S.text(part, marks));
      }
    });
    return;
  }
  place(r, parts[0], raw);
  out.push(S.text(parts[0], marks));
}

/** An inline atom standing for its whole source. @param {Reading} r @param {any[]} out @param {any} node @param {string} raw */
function addAtom(r, out, node, raw) {
  place(r, ATOM, raw);
  out.push(node);
}

/** The parts of an inline link's source: destination and title as written. @param {string} raw */
function linkParts(raw) {
  const match =
    /\]\(\s*(<[^>]*>|[^\s)]*(?:\([^\s)]*\)[^\s)]*)*)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)$/u.exec(
      raw,
    );
  return match ? { dest: match[1], title: match[2] ?? '' } : null;
}

/** @param {Reading} r @param {any[]} tokens @param {readonly any[]} marks @param {any[]} out */
function inlines(r, tokens, marks, out) {
  for (const token of tokens ?? []) {
    const start = find(r, token.raw);
    switch (token.type) {
      case 'text':
        if (token.tokens?.length) inlines(r, token.tokens, marks, out);
        else addText(r, out, decode(token.text), token.raw, marks);
        break;
      case 'escape':
        addText(r, out, token.text, token.raw, marks);
        break;
      case 'strong':
      case 'em':
      case 'del': {
        const markerLength = token.type === 'strong' || token.type === 'del' ? 2 : 1;
        const type = token.type === 'del' ? S.marks.strike : S.marks[token.type];
        const mark = type.create({ marker: token.raw.slice(0, markerLength) });
        if (start >= 0) r.cursor = start + markerLength;
        inlines(r, token.tokens, mark.addToSet(marks), out);
        if (start >= 0) r.cursor = Math.max(r.cursor, start + token.raw.length);
        break;
      }
      case 'codespan': {
        const ticks = /^`+/u.exec(token.raw)?.[0] ?? '`';
        if (start >= 0) r.cursor = start + ticks.length;
        addText(r, out, token.text, token.text, S.marks.code.create({ ticks }).addToSet(marks));
        if (start >= 0) r.cursor = Math.max(r.cursor, start + token.raw.length);
        break;
      }
      case 'link': {
        const raw = token.raw;
        let attrs = { href: token.href, dest: '', title: '', style: 'inline', label: '' };
        if (raw.startsWith('<')) attrs.style = 'angle';
        else if (!raw.startsWith('[')) attrs.style = 'bare';
        else {
          const parts = linkParts(raw);
          const reference = /\]\[([^\]]*)\]$/u.exec(raw);
          if (parts) attrs = { ...attrs, ...parts };
          else attrs = { ...attrs, style: 'ref', label: reference ? reference[1] : '' };
        }
        if (start >= 0) r.cursor = start + (attrs.style === 'bare' ? 0 : 1);
        inlines(r, token.tokens, S.marks.link.create(attrs).addToSet(marks), out);
        if (start >= 0) r.cursor = Math.max(r.cursor, start + raw.length);
        break;
      }
      case 'image':
        addAtom(
          r,
          out,
          S.nodes.image.create({ src: token.href, alt: token.text, raw: token.raw }, null, marks),
          token.raw,
        );
        break;
      case 'br':
        addAtom(r, out, S.nodes.hard_break.create({ raw: token.raw }), token.raw);
        break;
      case 'scopeInlineMath':
        addAtom(r, out, S.nodes.math_inline.create({ tex: token.text, raw: token.raw }), token.raw);
        break;
      default:
        addAtom(r, out, S.nodes.html_inline.create({ source: token.raw }), token.raw);
    }
  }
}

/** A textblock's content: opened, its inlines, closed. @param {Reading} r */
function textblock(r, type, attrs, tokens) {
  r.pos += 1;
  const out = [];
  inlines(r, tokens, [], out);
  r.pos += 1;
  return type.create(attrs, Fragment.fromArray(out));
}

/** @param {Reading} r @param {any} token @returns {any | null} */
function blockNode(r, token) {
  const start = find(r, token.raw.split('\n')[0]);
  if (start >= 0) r.cursor = start;
  switch (token.type) {
    case 'paragraph':
    case 'text':
      return textblock(
        r,
        S.nodes.paragraph,
        null,
        token.tokens ?? [{ type: 'text', raw: token.raw, text: token.text }],
      );
    case 'heading':
      return textblock(r, S.nodes.heading, { level: token.depth }, token.tokens);
    case 'code': {
      const fence = /^ {0,3}(`{3,}|~{3,})/u.exec(token.raw)?.[1] ?? null;
      const indent = fence ? null : (/^( {4}|\t)/u.exec(token.raw)?.[1] ?? '    ');
      r.pos += 1;
      if (fence) {
        const newline = r.src.indexOf('\n', r.cursor);
        if (newline >= 0 && newline < r.limit) r.cursor = newline + 1;
      }
      const code = token.text.replace(/\n+$/u, '');
      if (code) place(r, code, code);
      r.pos += 1;
      return S.nodes.code_block.create(
        { info: token.lang ?? '', fence: fence ?? '```', indent },
        code ? S.text(code) : null,
      );
    }
    case 'blockquote': {
      r.pos += 1;
      const children = blocks(r, token.tokens);
      r.pos += 1;
      return S.nodes.blockquote.create(null, children.length ? children : [emptyParagraph(r)]);
    }
    case 'list': {
      const first = token.items[0]?.raw ?? '';
      const attrs = token.ordered
        ? {
            start: token.start === '' ? 1 : Number(token.start),
            delim: /^\s*\d+([.)])/u.exec(first)?.[1] ?? '.',
            loose: !!token.loose,
          }
        : { marker: /^\s*([-+*])/u.exec(first)?.[1] ?? '-', loose: !!token.loose };
      r.pos += 1;
      const items = token.items.map((item) => {
        const at = find(r, item.raw.split('\n')[0]);
        if (at >= 0) r.cursor = at;
        r.pos += 1;
        const children = blocks(
          r,
          item.tokens.filter((child) => child.type !== 'checkbox'),
        );
        r.pos += 1;
        return S.nodes.list_item.create(
          { checked: item.task ? !!item.checked : null },
          children.length ? children : [emptyParagraph(r)],
        );
      });
      r.pos += 1;
      return (token.ordered ? S.nodes.ordered_list : S.nodes.bullet_list).create(attrs, items);
    }
    case 'hr':
      r.pos += 1;
      return S.nodes.horizontal_rule.create();
    case 'scopeBlockMath':
      r.pos += 1;
      return S.nodes.math_block.create({ tex: token.text, raw: token.raw.replace(/\n+$/u, '') });
    case 'space':
      return null;
    default:
      r.pos += 1;
      return S.nodes.raw.create({ source: token.raw.replace(/\n+$/u, ''), kind: token.type });
  }
}

/** An empty paragraph where a container has no blocks. @param {Reading} r */
function emptyParagraph(r) {
  r.pos += 2;
  return S.nodes.paragraph.create();
}

/** @param {Reading} r @param {any[]} tokens */
function blocks(r, tokens) {
  const out = [];
  for (const token of tokens ?? []) {
    const node = blockNode(r, token);
    if (node) out.push(node);
  }
  return out;
}

/**
 * One block of a page: its node, its text in the source, the text between
 * the previous block and it, and its characters' places in that text
 * (`pm` counts from just before the node, `src` from the start of `text`).
 * @typedef {{ node: any, text: string, gap: string,
 *   segs: {pm:number,len:number,src:number,srcLen:number}[] }} MdBlock
 */

/**
 * Read Markdown into page blocks. The blocks' gaps and texts, then `tail`,
 * add up to the source exactly.
 * @param {string} source with \n line breaks
 * @returns {{ blocks: MdBlock[], tail: string }}
 */
export function parseMarkdown(source) {
  const tokens = lexer.lexer(source);
  const result = [];
  let at = 0;
  let gap = '';
  for (const token of tokens) {
    const raw = token.raw;
    if (token.type === 'space') {
      gap += raw;
      at += raw.length;
      continue;
    }
    const text = raw.replace(/\n+$/u, '');
    /** @type {Reading} */
    const r = { src: source, cursor: at, limit: at + text.length, base: at, pos: 0, segs: [] };
    const node = blockNode(r, token);
    if (node) {
      result.push({ node, text, gap, segs: r.segs });
      gap = raw.slice(text.length);
    } else gap += raw;
    at += raw.length;
  }
  return { blocks: result, tail: gap };
}

// Writing ----------------------------------------------------------------

const LINE_START = /^(\s{0,3})([#>+=-]|\d{1,9}(?=[.)])|\*(?=\s)|\|)/u;

/** Text with Markdown's special characters escaped, for the second try. @param {string} text */
function escapeText(text, atLineStart) {
  let out = text.replace(/[\\*_`[\]<$~&|]/gu, (char) => `\\${char}`);
  if (atLineStart) {
    const digits = /^(\s{0,3})(\d{1,9})([.)])/u.exec(out);
    if (digits) out = `${digits[1]}${digits[2]}\\${digits[3]}${out.slice(digits[0].length)}`;
    else out = out.replace(LINE_START, (whole, space, char) => `${space}\\${char}`);
  }
  return out;
}

/** The backticks around code `text`: longer than any run inside it. @param {string} text @param {string} ticks */
function codeSpan(text, ticks) {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length));
  const fence = ticks.length > longest ? ticks : '`'.repeat(longest + 1);
  const pad =
    /^`|`$/u.test(text) || (/^ /u.test(text) && / $/u.test(text) && text.trim()) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

const MARK_ORDER = ['link', 'strong', 'em', 'strike', 'code'];

/**
 * A textblock's inline content as Markdown. Marks that run longer open
 * first, so they close last and nest properly; spaces at a mark's edge go
 * outside its delimiters.
 * Modes: 0 writes text as it is, 1 escapes Markdown's characters, 2 also
 * moves punctuation at a mark's edge outside it (CJK punctuation there can
 * keep ** from closing).
 * @param {any} parent @param {number} mode
 */
function inlineText(parent, mode) {
  // Full-width punctuation only: ASCII marks may be Markdown's own.
  const edge = mode === 2 ? /(?:[ \t]|(?![!-~])\p{P})+$/u : /[ \t]+$/u;
  const lead = mode === 2 ? /^(?:[ \t]|(?![!-~])\p{P})+/u : /^[ \t]+/u;
  const nodes = [];
  parent.forEach((node) => nodes.push(node));
  let out = '';
  /** @type {any[]} */
  let open = [];
  const closer = (mark) => {
    const name = mark.type.name;
    if (name === 'code') return '';
    if (name !== 'link') return mark.attrs.marker;
    if (mark.attrs.style === 'ref') return mark.attrs.label ? `][${mark.attrs.label}]` : ']';
    const dest = mark.attrs.dest || mark.attrs.href.replace(/[ ()]/gu, encodeURIComponent);
    return `](${dest}${mark.attrs.title ? ` ${mark.attrs.title}` : ''})`;
  };
  const close = (marks) => {
    if (!marks.length) return;
    const space = edge.exec(out)?.[0] ?? '';
    out = out.slice(0, out.length - space.length);
    for (let index = marks.length - 1; index >= 0; index--) out += closer(marks[index]);
    out += space;
  };
  const extent = (mark, from) => {
    let end = from;
    while (end < nodes.length && mark.isInSet(nodes[end].marks)) end++;
    return end - from;
  };
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    // Keep the open marks this node still carries, up to the first it does not.
    let keep = 0;
    while (keep < open.length && open[keep].isInSet(node.marks)) keep++;
    close(open.slice(keep));
    open = open.slice(0, keep);
    const fresh = node.marks
      .filter((mark) => !open.some((other) => other.eq(mark)))
      .sort(
        (a, b) =>
          Number(a.type.name === 'code') - Number(b.type.name === 'code') ||
          extent(b, index) - extent(a, index) ||
          MARK_ORDER.indexOf(a.type.name) - MARK_ORDER.indexOf(b.type.name),
      );
    let text = node.isText ? node.text : '';
    if (fresh.length && node.isText) {
      const space = lead.exec(text)?.[0] ?? '';
      out += mode ? escapeText(space, false) : space;
      text = text.slice(space.length);
    }
    let skipped = false;
    for (const mark of fresh) {
      if (
        mark.type.name === 'link' &&
        mark.attrs.style !== 'inline' &&
        mark.attrs.style !== 'ref'
      ) {
        // An autolink whose text is still its address stays an autolink.
        const end = index + extent(mark, index);
        const run = nodes.slice(index, end);
        const shown = run.map((item) => item.text ?? '').join('');
        if (
          run.every((item) => item.isText && item.marks.length === 1) &&
          shown === mark.attrs.href
        ) {
          out += mark.attrs.style === 'angle' ? `<${shown}>` : shown;
          index = end - 1;
          skipped = true;
          break;
        }
      }
      if (mark.type.name === 'link') out += '[';
      else if (mark.type.name !== 'code') out += mark.attrs.marker;
      open.push(mark);
    }
    if (skipped) continue;
    const code = node.marks.find((mark) => mark.type.name === 'code');
    if (node.isText) {
      if (code) out += codeSpan(text, code.attrs.ticks);
      else out += mode ? escapeText(text, !out || out.endsWith('\n')) : text;
    } else if (node.type.name === 'hard_break') out += node.attrs.raw || '\n';
    else if (node.type.name === 'image') out += node.attrs.raw;
    else if (node.type.name === 'math_inline') out += node.attrs.raw ?? `$${node.attrs.tex}$`;
    else if (node.type.name === 'html_inline') out += node.attrs.source;
  }
  close(open);
  return out;
}

/** Indent every line after the first by `width` spaces. @param {string} text @param {number} width */
const hang = (text, width) =>
  text
    .split('\n')
    .map((line, index) => (index && line ? ' '.repeat(width) + line : line))
    .join('\n');

/**
 * One block as Markdown. `known` gives the text of list items read from the
 * source, which a changed list keeps.
 * @param {any} node @param {number} mode @param {WeakMap<any, {text:string,gap:string}>} [known]
 */
export function blockText(node, mode, known) {
  const name = node.type.name;
  if (name === 'paragraph') return inlineText(node, mode);
  if (name === 'heading') return `${'#'.repeat(node.attrs.level)} ${inlineText(node, mode)}`;
  if (name === 'horizontal_rule') return '---';
  if (name === 'math_block') return node.attrs.raw ?? `$$\n${node.attrs.tex}\n$$`;
  if (name === 'raw') return node.attrs.source;
  if (name === 'code_block') {
    const text = node.textContent;
    if (node.attrs.indent)
      return text
        .split('\n')
        .map((line) => node.attrs.indent + line)
        .join('\n');
    const runs =
      text.match(new RegExp(`${node.attrs.fence[0] === '~' ? '~' : '`'}{3,}`, 'gu')) ?? [];
    const length = Math.max(node.attrs.fence.length, ...runs.map((run) => run.length + 1));
    const fence = node.attrs.fence[0].repeat(length);
    return `${fence}${node.attrs.info}\n${text}${text ? '\n' : ''}${fence}`;
  }
  if (name === 'blockquote') {
    const inner = [];
    node.forEach((child) => inner.push(blockText(child, mode)));
    return inner
      .join('\n\n')
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n');
  }
  if (name === 'bullet_list' || name === 'ordered_list') {
    const loose = node.attrs.loose;
    let out = '';
    let number = node.attrs.start - 1;
    node.forEach((item, _offset, index) => {
      const kept = known?.get(item);
      const previous = /^\s*(\d+)/u.exec(kept?.text ?? '');
      number = previous ? Number(previous[1]) : number + 1;
      const marker = name === 'bullet_list' ? node.attrs.marker : `${number}${node.attrs.delim}`;
      const text = kept ? kept.text : itemText(item, marker, loose, mode);
      out += (index === 0 ? '' : kept ? kept.gap : loose ? '\n\n' : '\n') + text;
    });
    return out;
  }
  return node.textContent;
}

/** @param {any} item @param {string} marker @param {boolean} loose @param {number} mode */
function itemText(item, marker, loose, mode) {
  const parts = [];
  item.forEach((child) => parts.push(blockText(child, mode)));
  const check = item.attrs.checked == null ? '' : item.attrs.checked ? '[x] ' : '[ ] ';
  const body = parts.join(loose ? '\n\n' : '\n');
  return `${marker} ${check}${hang(body, marker.length + 1)}`.replace(/ +$/u, '');
}

/**
 * The list items of a top-level list with their text, so a changed list
 * keeps the items that did not change.
 * @param {MdBlock} entry
 * @returns {[any, {text:string,gap:string}][]}
 */
export function listItems(entry) {
  const { node, text } = entry;
  if (node.type.name !== 'bullet_list' && node.type.name !== 'ordered_list') return [];
  const tokens = /** @type {any} */ (lexer.lexer(text).find((token) => token.type === 'list'));
  if (!tokens || tokens.items.length !== node.childCount) return [];
  const out = [];
  let gap = '';
  tokens.items.forEach((token, index) => {
    const body = token.raw.replace(/\n+$/u, '');
    out.push([node.child(index), { text: body, gap }]);
    gap = token.raw.slice(body.length);
  });
  return out;
}

// Attributes that only say how something was written, not what is shown.
const WRITTEN = new Set([
  'raw',
  'marker',
  'dest',
  'style',
  'label',
  'fence',
  'indent',
  'delim',
  'loose',
]);

/** @param {any} a @param {any} b */
const sameAttrs = (a, b) =>
  Object.keys(a.attrs).every((key) => WRITTEN.has(key) || a.attrs[key] === b.attrs[key]);

/** @param {readonly any[]} marks */
const marksKey = (marks) =>
  marks
    .map((mark) => (mark.type.name === 'link' ? `link:${mark.attrs.href}` : mark.type.name))
    .sort()
    .join(' ');

/**
 * A textblock's content as shown: runs of text with their marks, and atoms.
 * Spaces at the block's edges and around line breaks are dropped, since
 * Markdown drops them when it reads the text back.
 * @param {any} node
 */
function shownRuns(node) {
  const runs = [];
  const add = (text, marks) => {
    const last = runs.at(-1);
    if (last?.text != null && last.marks === marks) last.text += text;
    else if (text) runs.push({ text, marks });
  };
  node.forEach((child) => {
    const marks = marksKey(child.marks);
    // Spaces at a mark's edge are written outside it; they look the same.
    if (child.isText) {
      const [, before, middle, after] = /^([ \t]*)([\s\S]*?)([ \t]*)$/u.exec(child.text) ?? [];
      add(before, '');
      add(middle, marks);
      add(after, '');
    } else
      runs.push({
        type: child.type.name,
        attrs: Object.entries(child.attrs).filter(([key]) => !WRITTEN.has(key)),
        marks,
      });
  });
  runs.forEach((run, index) => {
    if (run.text == null) return;
    const before = runs[index - 1];
    const after = runs[index + 1];
    if (!before || before.type === 'hard_break') run.text = run.text.replace(/^[ \t]+/u, '');
    if (!after || after.type === 'hard_break') run.text = run.text.replace(/[ \t]+$/u, '');
  });
  return JSON.stringify(runs.filter((run) => run.text !== ''));
}

/**
 * True when `a` and `b` show the same: structure, text, marks and attributes,
 * apart from how they were written.
 * @param {any} a @param {any} b
 */
function sameShown(a, b) {
  if (a.type !== b.type || !sameAttrs(a, b)) return false;
  if (a.isTextblock) return shownRuns(a) === shownRuns(b);
  if (a.childCount !== b.childCount) return false;
  for (let index = 0; index < a.childCount; index++)
    if (!sameShown(a.child(index), b.child(index))) return false;
  return true;
}

/**
 * Write a changed block: plain first, escaped when plain would read back
 * differently. When neither reads back the same (`exact` false), the page
 * takes `parsed` as the block's new state: the tidied text when it keeps
 * the block's kind, else the plain text. `defs` are the page's link
 * definitions, so reference links read back as links.
 * @param {any} node @param {WeakMap<any, {text:string,gap:string}>} [known] @param {string} [defs]
 * @returns {{ text: string, exact: boolean, parsed: MdBlock[] }}
 */
export function writeBlock(node, known, defs = '') {
  if (node.type.name === 'paragraph' && node.content.size === 0)
    return { text: '', exact: true, parsed: [{ node, text: '', gap: '', segs: [] }] };
  const tries = [];
  for (const mode of [0, 1, 2]) {
    const text = blockText(node, mode, known);
    const parsed = parseMarkdown(defs ? `${text}\n\n${defs}` : text).blocks.filter(
      (entry, index) => index === 0 || entry.node.attrs.kind !== 'def',
    );
    const exact = parsed.length === 1 && !parsed[0].gap && sameShown(parsed[0].node, node);
    if (exact) return { text, exact, parsed };
    tries.push({ text, exact, parsed });
  }
  const tidy = tries[2];
  return tidy.parsed.length === 1 && tidy.parsed[0].node.type === node.type ? tidy : tries[0];
}

/** The link definitions of a page, for writeBlock. @param {MdBlock[]} entries */
export const linkDefs = (entries) =>
  entries
    .filter((entry) => entry.node.type.name === 'raw' && entry.node.attrs.kind === 'def')
    .map((entry) => entry.text)
    .join('\n');

// Positions ------------------------------------------------------------------

/**
 * Map a position inside one block between its page positions (`pm`, from
 * just before the node) and its text (`src`). Where the position falls
 * between two places (markup, a boundary), `bias` < 0 takes the end of the
 * one before and `bias` > 0 the start of the one after.
 * @param {MdBlock} entry @param {number} value @param {'pm'|'src'} from @param {number} bias
 */
export function mapInBlock(entry, value, from, bias) {
  const to = from === 'pm' ? 'src' : 'pm';
  const size = (seg, key) => (key === 'pm' ? seg.len : seg.srcLen);
  let previous = null;
  let next = null;
  for (const seg of entry.segs) {
    const start = seg[from];
    const end = start + size(seg, from);
    if (value > start && value < end) {
      if (seg.len === seg.srcLen) return seg[to] + (value - start);
      return bias < 0 ? seg[to] + size(seg, to) : seg[to];
    }
    if (end <= value && (!previous || end >= previous[from] + size(previous, from))) previous = seg;
    if (start >= value && (!next || start < next[from])) next = seg;
  }
  if (!previous && !next) {
    if (from === 'pm') return value <= 1 ? 0 : entry.text.length;
    if (value > 0 && bias < 0)
      return entry.node.isTextblock ? entry.node.nodeSize - 1 : entry.node.nodeSize;
    return entry.node.isTextblock ? 1 : 0;
  }
  const after = bias < 0 ? !previous : !!next;
  return after ? next[to] : previous[to] + size(previous, to);
}
