const referenceHeading = /^(?:\d+[.\s]*)?(?:references|bibliography|参考文献)\s*[:：]?$/iu;

/**
 * Exact title comparison tolerates typography, not omitted or invented words.
 * @param {string} value
 * @returns {string}
 */
export function normalizeTitle(value) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]/gu, '');
}

function dois(text) {
  return [...text.matchAll(/10\.\d{4,9}\/[^\s<>"，。；]+/giu)].map((match) =>
    match[0].replace(/[.,;:)\]}]+$/u, '').toLowerCase(),
  );
}

function titleCandidates(line) {
  const clean = line.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/u, '');
  // Bibliographies commonly separate author, year, title and journal with full
  // stops, or mark a Chinese title with [J]/[M]. Only complete fields match.
  const fields = clean.split(/(?:\.(?:\s+|(?=\p{Script=Han}))|[。；]|\[[JMDCR]\])/iu);
  return [
    clean,
    ...fields,
    ...fields.map((field) => field.replace(/^.*?\b(?:19|20)\d{2}[a-z]?[).,\s]+/iu, '')),
    ...[...clean.matchAll(/["“「]([^"”」]+)["”」]/gu)].map((match) => match[1]),
  ]
    .map(normalizeTitle)
    .filter(Boolean);
}

/**
 * Prefer parser-labelled references; Markdown/DOCX headings can be attached
 * to the first paragraph, so inspect both section metadata and text lines.
 * @param {any[]} chunks
 * @returns {Array<{dois:string[],titles:string[],evidence:any}>}
 */
export function referenceEntries(chunks) {
  const labelled = chunks.filter((chunk) => chunk.kind === 'reference');
  let inReferences = false;
  const result = [];
  for (const chunk of labelled.length ? labelled : chunks) {
    if ((chunk.section ?? '').split(' > ').some((part) => referenceHeading.test(part)))
      inReferences = true;
    else if (chunk.section && inReferences && !labelled.length) inReferences = false;
    for (const line of chunk.text.split(/\r?\n/u)) {
      if (referenceHeading.test(line.trim())) {
        inReferences = true;
        continue;
      }
      if ((!labelled.length && !inReferences) || !line.trim()) continue;
      result.push({
        dois: dois(line),
        titles: titleCandidates(line),
        evidence: { ref: 'chunk:' + chunk.id, quote: line.trim(), page: chunk.page },
      });
    }
  }
  return result;
}

/**
 * Resolve references only against durable catalog identities.
 * @param {any[]} sources
 * @param {(id:string)=>any[]} chunks
 * @param {string} changedId
 * @returns {any[]}
 */
export function citationEdges(sources, chunks, changedId) {
  const byDoi = new Map(),
    byTitle = new Map();
  const add = (map, key, source) => {
    if (key) map.set(key, [...(map.get(key) ?? []), source.id]);
  };
  for (const source of sources) {
    add(byTitle, normalizeTitle(source.title), source);
    for (const doi of dois(String(source.metadata.doi ?? ''))) add(byDoi, doi, source);
  }
  const edges = new Map();
  for (const source of sources) {
    if (!['parsed', 'partial'].includes(source.contentStatus)) continue;
    for (const entry of referenceEntries(chunks(source.id))) {
      const targets = new Set([
        ...entry.dois.flatMap((doi) => byDoi.get(doi) ?? []),
        ...entry.titles.flatMap((title) => byTitle.get(title) ?? []),
      ]);
      for (const target of targets) {
        if (target === source.id || (source.id !== changedId && target !== changedId)) continue;
        const key = source.id + ':' + target;
        const edge = edges.get(key) ?? {
          fromRef: 'source:' + source.id,
          toRef: 'source:' + target,
          relation: 'cites',
          method: 'citation',
          evidence: [],
        };
        edge.evidence.push(entry.evidence);
        edges.set(key, edge);
      }
    }
  }
  return [...edges.values()];
}
