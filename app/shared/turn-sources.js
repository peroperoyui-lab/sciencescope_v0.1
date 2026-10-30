// 「本轮用到的资料」 from an answer's tool calls: the sources it read, and the
// search hits it cited or found along the knowledge graph, with that path.

/** The 「经由：…」 line search adds to a hit found along the graph. @param {any} hit */
function viaText(hit) {
  if (!hit.via?.length) return '';
  return (
    String(hit.text ?? '')
      .split('\n')
      .reverse()
      .find((line) => line.startsWith('经由：'))
      ?.slice(3) ?? hit.via.map((step) => step.name ?? `—${step.relation}→`).join(' ')
  );
}

/** `S3` from `[S3 p.4]`. @param {string | null | undefined} citation */
const labelOf = (citation) => /S\d+/u.exec(citation ?? '')?.[0] ?? null;

/**
 * Sources the turn read, or found and cited, with their graph paths.
 * @param {any[]} calls @param {string} text
 */
export function usedSources(calls, text) {
  const cited = new Set(text.match(/S\d+/gu) ?? []);
  /** @type {Map<string, any>} */
  const sources = new Map();
  const add = (id, values) => {
    const entry = sources.get(id) ?? { id, pages: new Set(), via: [] };
    for (const [key, value] of Object.entries(values))
      if (value != null && entry[key] == null) entry[key] = value;
    sources.set(id, entry);
    return entry;
  };
  for (const call of calls) {
    if (call.status === 'error' || !call.result) continue;
    if (call.name === 'research_read' && call.result.source) {
      const { source } = call.result;
      const entry = add(source.id, {
        title: source.title,
        label: source.label,
        folderPath: source.folderPath,
        projectId: source.projectId,
        kind: source.kind,
        read: true,
      });
      for (const chunk of call.result.chunks ?? []) if (chunk.page) entry.pages.add(chunk.page);
    }
    if (call.name === 'research_search')
      for (const hit of call.result.hits ?? []) {
        if (!hit.sourceId) continue;
        const via = viaText(hit);
        const label = labelOf(hit.citation);
        if (!via && !(label && cited.has(label))) continue;
        const entry = add(hit.sourceId, {
          title: hit.title,
          label,
          folderPath: hit.folderPath,
          projectId: hit.projectId,
        });
        if (hit.page) entry.pages.add(hit.page);
        if (via && !entry.via.includes(via)) entry.via.push(via);
      }
  }
  return [...sources.values()];
}
