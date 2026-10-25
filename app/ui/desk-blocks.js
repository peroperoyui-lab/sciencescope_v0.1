// Docx paragraphs between the desk session and the editor (EDITING_DESK.md §3).
// The server sends flat blocks with inline runs; the editor holds a document
// tree (paragraphs and tables of cells). Both sides are compared in one normal
// form so an untouched paragraph is never sent back. No editor imports here,
// so node tests cover the conversion and the change set.

/** Direct formatting the desk edits, in the order the server reads it. */
export const MARKS = ['b', 'i', 'u', 'sup', 'sub'];

/** Atoms that carry no identity and may be copied or typed again. */
export const COPYABLE = new Set(['tab', 'break', 'symbol']);

/** Markers that only hold a position (bookmarks, Word comment ranges). */
export const MARKERS = new Set(['bookmark', 'comment-start', 'comment-end', 'comment-reference']);

const has = (value) => value !== undefined && value !== null;

/**
 * One inline in its compared form: canonical mark order, no empty text, no
 * display-only fields, and neighbours with the same run and marks merged.
 * @param {any[]} inlines
 * @returns {any[]}
 */
export function normalizeInlines(inlines) {
  const result = [];
  for (const inline of inlines ?? []) {
    /** @type {any} */
    let next;
    if (has(inline.atom)) {
      next = { atom: inline.atom, ref: inline.ref, display: inline.display ?? '' };
    } else {
      if (!inline.text) continue;
      next = { text: inline.text, marks: MARKS.filter((mark) => inline.marks?.includes(mark)) };
    }
    if (has(inline.run)) next.run = inline.run;
    if (has(inline.wrap)) next.wrap = inline.wrap;
    const last = result.at(-1);
    if (
      last &&
      !has(last.atom) &&
      !has(next.atom) &&
      last.run === next.run &&
      last.wrap === next.wrap &&
      last.marks.join() === next.marks.join()
    )
      last.text += next.text;
    else result.push(next);
  }
  return result;
}

/** @param {any[]} left @param {any[]} right */
export const sameInlines = (left, right) => JSON.stringify(left) === JSON.stringify(right);

/** Heading level from the block or its Word style (Heading1, heading 2, 标题 3). */
export function headingLevel(block) {
  if (block.kind !== 'heading') return null;
  const named = /(?:heading|标题)\s*(\d)/iu.exec(block.style ?? '');
  return Math.min(Number(named?.[1] ?? block.level ?? 1) || 1, 6);
}

function inlineJSON(inline) {
  if (has(inline.atom))
    return {
      type: 'atom',
      attrs: {
        atom: inline.atom,
        ref: inline.ref,
        display: inline.display ?? '',
        run: inline.run ?? null,
        wrap: inline.wrap ?? null,
        media: !!inline.media,
        comment: inline.comment ?? null,
      },
    };
  if (!inline.text) return null;
  /** @type {any[]} */
  const marks = MARKS.filter((mark) => inline.marks?.includes(mark)).map((type) => ({ type }));
  if (has(inline.run) || has(inline.wrap))
    marks.push({ type: 'origin', attrs: { run: inline.run ?? null, wrap: inline.wrap ?? null } });
  return { type: 'text', text: inline.text, ...(marks.length ? { marks } : {}) };
}

function paraJSON(block) {
  if (block.kind === 'opaque')
    return { type: 'opaque', attrs: { id: block.id, text: block.text ?? '' } };
  const content = (block.inlines ?? []).map(inlineJSON).filter(Boolean);
  return {
    type: 'para',
    attrs: {
      id: block.id,
      kind: block.kind,
      level: headingLevel(block),
      style: block.style ?? null,
      section: !!block.section,
      like: block.like ?? null,
    },
    ...(content.length ? { content } : {}),
  };
}

/**
 * The editor document for session blocks. Cell paragraphs are grouped into
 * table > row > cell by the span indices the server sends.
 * @param {any[]} blocks
 * @returns {any}
 */
export function toDocJSON(blocks) {
  const content = [];
  let table = null;
  let row = null;
  let cell = null;
  for (const block of blocks) {
    const place = block.kind === 'table-cell' ? block.cell : null;
    if (!place) {
      table = row = cell = null;
      content.push(paraJSON(block));
      continue;
    }
    if (table?.attrs.key !== place.table) {
      table = { type: 'table', attrs: { key: place.table }, content: [] };
      row = cell = null;
      content.push(table);
    }
    if (row?.attrs.key !== place.row) {
      row = { type: 'row', attrs: { key: place.row }, content: [] };
      cell = null;
      table.content.push(row);
    }
    if (cell?.attrs.key !== place.cell) {
      cell = { type: 'cell', attrs: { key: place.cell }, content: [] };
      row.content.push(cell);
    }
    cell.content.push(paraJSON(block));
  }
  if (!content.length)
    content.push({ type: 'para', attrs: { id: null, kind: 'paragraph', level: null } });
  return { type: 'doc', content };
}

function inlinesOf(node) {
  return normalizeInlines(
    (node.content ?? []).map((child) => {
      if (child.type === 'atom') return child.attrs;
      const marks = child.marks ?? [];
      const origin = marks.find((mark) => mark.type === 'origin')?.attrs ?? {};
      return {
        text: child.text,
        marks: marks.map((mark) => mark.type),
        run: origin.run,
        wrap: origin.wrap,
      };
    }),
  );
}

/**
 * Editor document back to flat blocks, in reading order. `container` is the
 * cell key (or 'body'), which decides where a new paragraph may be anchored.
 * @param {any} doc editor document as JSON
 * @returns {{id:string|null,kind:string,like:string|null,container:string,opaque?:boolean,inlines?:any[]}[]}
 */
export function fromDocJSON(doc) {
  const blocks = [];
  const visit = (node, container, place) => {
    if (node.type === 'para')
      blocks.push({
        id: node.attrs?.id ?? null,
        kind: node.attrs?.kind ?? 'paragraph',
        style: node.attrs?.style ?? null,
        level: node.attrs?.level ?? null,
        like: node.attrs?.like ?? null,
        container,
        ...(place.cell != null ? { cell: place } : {}),
        inlines: inlinesOf(node),
      });
    else if (node.type === 'opaque')
      blocks.push({ id: node.attrs.id, kind: 'opaque', like: null, container, opaque: true });
    else
      for (const child of node.content ?? [])
        visit(
          child,
          node.type === 'cell' ? `cell:${node.attrs.key}` : container,
          node.type === 'doc' ? {} : { ...place, [node.type]: node.attrs.key },
        );
  };
  visit(doc, 'body', {});
  return blocks;
}

/**
 * After the server moved on (another writer, or a conflict), rebuild the
 * paragraph list: the server's text, except paragraphs changed here and not
 * yet sent, which keep this side's text. `force` takes the server's text for
 * those ids as well ('all' drops every local change).
 * @param {any[]} server session blocks
 * @param {Map<string, any>} confirmed what the server had confirmed before
 * @param {ReturnType<typeof fromDocJSON>} local
 * @param {Set<string> | 'all' | null} [force]
 * @returns {any[]} blocks in the server's shape, for toDocJSON
 */
export function mergeBlocks(server, confirmed, local, force = null) {
  const forced = (id) => force === 'all' || !!force?.has(id);
  const present = new Set(server.map((block) => block.id));
  const mine = new Map(local.filter((block) => block.id).map((block) => [block.id, block]));
  // New paragraphs here follow the nearest paragraph both sides still have.
  const following = new Map();
  let anchor = '^';
  for (const block of local) {
    if (block.id && confirmed.has(block.id)) {
      if (present.has(block.id)) anchor = block.id;
      continue;
    }
    if (force === 'all' || block.opaque) continue;
    if (!following.has(anchor)) following.set(anchor, []);
    following.get(anchor).push(block);
    anchor = block.id;
  }
  const result = [];
  const emit = (block) => {
    result.push(block);
    for (const next of following.get(block.id) ?? []) emit(next);
  };
  for (const next of following.get('^') ?? []) emit(next);
  for (const block of server) {
    const known = confirmed.get(block.id);
    const edited = mine.get(block.id);
    if (block.kind === 'opaque' || !known || forced(block.id)) emit(block);
    else if (!edited) continue;
    else if (sameInlines(known.inlines, edited.inlines)) emit(block);
    else emit({ ...block, inlines: edited.inlines });
  }
  return result;
}

/**
 * Three-way merge of a text file: both changes when they do not overlap,
 * otherwise this side's text.
 * @param {string} base @param {string} local @param {string} remote
 */
export function mergeText(base, local, remote) {
  if (local === base) return remote;
  if (remote === base || remote === local) return local;
  const span = (next) => {
    let from = 0;
    while (from < base.length && from < next.length && base[from] === next[from]) from++;
    let tail = 0;
    while (
      tail < base.length - from &&
      tail < next.length - from &&
      base[base.length - 1 - tail] === next[next.length - 1 - tail]
    )
      tail++;
    return { from, to: base.length - tail, insert: next.slice(from, next.length - tail) };
  };
  const [first, second] = [span(local), span(remote)].sort((a, b) => a.from - b.from);
  if (first.to > second.from) return local;
  return (
    base.slice(0, first.from) +
    first.insert +
    base.slice(first.to, second.from) +
    second.insert +
    base.slice(second.to)
  );
}

/**
 * What the server has confirmed, keyed by block id, in compared form.
 * @param {any[]} blocks session blocks
 * @returns {Map<string, any>}
 */
export function confirmedOf(blocks) {
  return new Map(
    blocks.map((block) => [
      block.id,
      {
        kind: block.kind,
        inlines: block.kind === 'opaque' ? null : normalizeInlines(block.inlines),
      },
    ]),
  );
}

/**
 * The PATCH body that turns the confirmed blocks into the edited ones. A new
 * paragraph is anchored after the paragraph before it in the same cell or in
 * the body, and takes its paragraph properties from `like`: the paragraph it
 * was split from, or for a plain paragraph the nearest plain one (so Enter
 * after a heading does not make another heading).
 * @param {Map<string, any>} confirmed
 * @param {ReturnType<typeof fromDocJSON>} edited
 * @returns {{blocks:Record<string,any[]>,inserted:any[],removed:string[]}|null} null when nothing changed
 */
export function blockDelta(confirmed, edited) {
  /** @type {Record<string, any[]>} */
  const blocks = {};
  const inserted = [];
  const present = new Set();
  edited.forEach((block, index) => {
    if (block.id && confirmed.has(block.id) && !present.has(block.id)) {
      present.add(block.id);
      if (!block.opaque && !sameInlines(confirmed.get(block.id).inlines, block.inlines))
        blocks[block.id] = block.inlines;
      return;
    }
    if (block.opaque) return;
    const before = edited.slice(0, index).reverse();
    const sibling = before.find((entry) => entry.container === block.container);
    const after = sibling?.id ?? (block.container === 'body' ? '^' : (before[0]?.id ?? '^'));
    // `like` must name a paragraph the server knows by the time it reads this entry.
    let like =
      block.like && (confirmed.has(block.like) || inserted.some((entry) => entry.id === block.like))
        ? block.like
        : null;
    const plain = (entry) => entry.container === 'body' && entry.kind === 'paragraph';
    if (!like && block.kind === 'paragraph' && block.container === 'body')
      like =
        before.find(plain)?.id ??
        edited.slice(index + 1).find((entry) => plain(entry) && confirmed.has(entry.id))?.id ??
        null;
    inserted.push({
      id: block.id,
      after,
      ...(like ? { like } : {}),
      inlines: block.inlines,
    });
  });
  const removed = [...confirmed.keys()].filter((id) => !present.has(id));
  if (!Object.keys(blocks).length && !inserted.length && !removed.length) return null;
  return { blocks, inserted, removed };
}

/**
 * Words for the status bar: characters for Chinese and Japanese, words for the rest.
 * @param {string} text
 */
export function countWords(text) {
  const wide = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
  const characters = text.match(wide)?.length ?? 0;
  const words = text.replace(wide, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return characters + (words?.length ?? 0);
}

/**
 * Line endings and BOM of a text file, so the source editor writes them back
 * unchanged. Mixed endings keep '\n' as the separator and leave '\r' in place.
 * @param {string} text
 */
export function textShape(text) {
  const bom = text.startsWith('﻿');
  const body = bom ? text.slice(1) : text;
  const crlf = body.includes('\r\n') && !/(^|[^\r])\n/u.test(body);
  return { bom, separator: crlf ? '\r\n' : '\n', body };
}
