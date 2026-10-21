export const ENTITY_ALIGNMENT_THRESHOLD = 0.92;

/**
 * Canonical names remain unchanged; aliases bridge abbreviations and typography.
 * @param {string} value
 * @returns {string}
 */
export const normalizedName = (value) =>
  String(value).normalize('NFKC').toLowerCase().replace(/\s/gu, '');

/**
 * Vector lookups happen before the write transaction. Exact matching is repeated
 * in the transaction so two concurrent cards cannot create the same entity.
 * @param {{core:import('../../core/index.js').Core,knowledge:any,semantic:any}} deps
 * @returns {any}
 */
export function createEntityAlignment({ core, knowledge, semantic }) {
  function exact(item, kind) {
    const names = new Set([item.name, ...(item.aliases ?? [])].map(normalizedName));
    return core.db
      .prepare(
        "SELECT * FROM kb_entities WHERE kind=? AND status='active' AND visibility<>'private' ORDER BY id",
      )
      .all(kind)
      .find((row) =>
        [row.name, row.name_en, ...JSON.parse(String(row.aliases_json))]
          .filter(Boolean)
          .some((name) => names.has(normalizedName(name))),
      );
  }
  async function nearest(item, kind) {
    if (exact(item, kind) || !semantic?.status().enabled) return null;
    const candidates = await semantic.entityNeighbors(item.name);
    for (const hit of candidates.slice(0, 3)) {
      if (hit.score < ENTITY_ALIGNMENT_THRESHOLD) continue;
      const row = core.db
        .prepare(
          "SELECT * FROM kb_entities WHERE id=? AND kind=? AND status='active' AND visibility<>'private'",
        )
        .get(hit.ref.id, kind);
      if (row) return row.id;
    }
    return null;
  }
  function resolve(item, kind, candidate, sourceRef, actor) {
    const found =
      exact(item, kind) ??
      (candidate &&
        core.db
          .prepare(
            "SELECT * FROM kb_entities WHERE id=? AND kind=? AND status='active' AND visibility<>'private'",
          )
          .get(candidate, kind));
    if (!found)
      return knowledge.createEntity(
        {
          name: item.name,
          aliases: item.aliases ?? [],
          kind,
          description: item.evidence.map((quote) => quote.quote).join('\n'),
          attrs: item.parameters ? { parameters: item.parameters } : {},
          producedFrom: sourceRef,
          evidence: item.evidence,
          layer: 'extracted',
        },
        actor,
      );
    const aliases = new Set(JSON.parse(String(found.aliases_json)));
    for (const name of [item.name, ...(item.aliases ?? [])])
      if (normalizedName(name) !== normalizedName(found.name)) aliases.add(name);
    // Record reuse as part of this build; withdrawing an earlier build then
    // skips an entity that another paper has subsequently incorporated.
    return knowledge.updateEntity(String(found.id), { aliases: [...aliases] }, actor);
  }
  return { nearest, resolve };
}
