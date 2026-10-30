import { extractCitationLabels } from '../research/citations.js';

/**
 * Single-message and batch readers share citation parsing and target projection.
 * @param {string} text
 * @param {any[]} selected
 * @param {(citation:any,chosen:any)=>any} resolveSource
 * @param {(source:any,citation:any)=>string} highlight
 * @returns {Array<ReturnType<typeof extractCitationLabels>[number] & {targets:any[]}>}
 */
export function projectCitations(text, selected, resolveSource, highlight) {
  return extractCitationLabels(text).map((label) => ({
    ...label,
    targets: label.citations
      .filter((citation) => citation.kind === 'source')
      .flatMap((citation) => {
        const chosen = selected.find((entry) => entry.label === citation.label);
        const source = resolveSource(citation, chosen);
        if (!source) return [];
        return [
          {
            kind: 'source',
            id: source.id,
            projectId: source.projectId,
            page: citation.fromPage ?? 1,
            highlight: highlight(source, citation),
          },
        ];
      }),
  }));
}
