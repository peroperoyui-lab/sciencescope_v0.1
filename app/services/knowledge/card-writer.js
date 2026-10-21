import { createKnowledgeStore } from './store.js';
import { createRecords } from './records.js';
import { createEntityAlignment, normalizedName } from './align.js';

export const CARD_ACTOR_ID = 'actor_card_builder';
const kinds = {
  methods: 'method',
  datasets: 'dataset',
  variables: 'variable',
  metrics: 'metric',
  software: 'software',
  code: 'code',
};

/**
 * A paper's replacements and additions commit as one reversible build.
 * @param {{core:import('../../core/index.js').Core,research:any,semantic:any}} deps
 * @returns {any}
 */
export function createCardWriter({ core, research, semantic }) {
  const knowledge = createKnowledgeStore(core);
  const { versions } = knowledge;
  const records = createRecords(core.db);
  const alignment = createEntityAlignment({ core, knowledge, semantic });
  async function plan(card) {
    const entries = [];
    for (const [field, kind] of Object.entries(kinds))
      for (const item of card[field]) {
        const actualKind = field === 'methods' && item.variantOf ? 'variant' : kind;
        entries.push({
          field,
          item,
          kind: actualKind,
          candidate: await alignment.nearest(item, actualKind),
        });
        if (item.variantOf) {
          const parent = { name: item.variantOf, evidence: item.evidence };
          entries.push({
            field: 'parents',
            item: parent,
            kind: 'method',
            candidate: await alignment.nearest(parent, 'method'),
          });
        }
      }
    return entries;
  }
  function replaceOld(sourceRef, actor) {
    for (const edge of core.db
      .prepare(
        "SELECT id FROM kb_edges WHERE produced_from=? AND layer='extracted' AND status='active'",
      )
      .all(sourceRef))
      knowledge.removeEdge(String(edge.id), actor);
    for (const entity of core.db
      .prepare(
        "SELECT id FROM kb_entities WHERE produced_from=? AND layer='extracted' AND status='active'",
      )
      .all(sourceRef)) {
      const ref = 'entity:' + entity.id;
      if (
        !core.db
          .prepare(
            "SELECT 1 FROM kb_edges WHERE status='active' AND (from_ref=? OR to_ref=?) LIMIT 1",
          )
          .get(ref, ref)
      )
        knowledge.removeEntity(String(entity.id), actor);
    }
    for (const row of core.db
      .prepare(
        "SELECT * FROM rb_items WHERE status='active' AND json_extract(payload_json,'$.cardSource')=?",
      )
      .all(sourceRef)) {
      const ref = 'item:' + row.id;
      const latest = versions.history(ref, { limit: 1 }).rows[0];
      if (latest?.after?.revision !== row.revision) continue;
      research.store.updateItem(String(row.id), { status: 'archived' }, actor);
      versions.record(actor.versionId, ref, 'remove', row, records.read(ref), actor);
    }
  }
  function save(source, card, entries, response) {
    return core.db.transaction(() => {
      const sourceRef = 'source:' + source.id;
      const actor = {
        actorId: CARD_ACTOR_ID,
        origin: 'ai',
        meetingId: response.meetingId,
        turnId: response.turnId,
        projectId: source.projectId,
      };
      const version = versions.open({ ...actor, source: 'build', description: source.title });
      const context = { ...actor, versionId: version.id };
      replaceOld(sourceRef, context);
      const item = research.store.createItem(
        {
          type: 'note',
          subtype: 'summary',
          projectId: null,
          title: source.title,
          body: [card.question?.text, ...card.findings.map((finding) => finding.text)]
            .filter(Boolean)
            .join('\n'),
          payload: { card, cardSource: sourceRef },
          origin: {
            type: 'external',
            sourceRef,
            layer: 'extracted',
            meetingId: response.meetingId,
            turnId: response.turnId,
          },
        },
        context,
      );
      const cardRef = 'item:' + item.id;
      versions.record(version.id, cardRef, 'create', null, records.read(cardRef), context);
      const entities = new Set();
      const resolved = [];
      const member = (ref) => {
        if (
          source.projectId &&
          !knowledge.memberships(ref).some((row) => row.projectId === source.projectId)
        )
          knowledge.membership(source.projectId, ref, true, context);
      };
      member(cardRef);
      for (const entry of entries) {
        const entity = alignment.resolve(
          entry.item,
          entry.kind,
          entry.candidate,
          sourceRef,
          context,
        );
        const ref = 'entity:' + entity.id;
        entities.add(ref);
        resolved.push({ ...entry, ref });
        member(ref);
      }
      const add = (fromRef, toRef, relation, entry) =>
        knowledge.createEdge(
          {
            fromRef,
            toRef,
            relation,
            layer: 'extracted',
            method: 'card',
            producedFrom: sourceRef,
            evidence: entry.evidence.map(({ chunkId, quote, page }) => ({
              ref: 'chunk:' + chunkId,
              chunkId,
              quote,
              page,
            })),
            attrs: entry.parameters ? { parameters: entry.parameters } : {},
          },
          context,
        );
      for (const { field, item: entry, ref } of resolved) {
        if (field === 'parents') continue;
        const relation = field === 'datasets' ? 'evaluates-on' : 'uses';
        add(
          sourceRef,
          ref,
          ['uses', 'proposes', 'evaluates-on'].includes(entry.relation) ? entry.relation : relation,
          entry,
        );
        if (entry.variantOf) {
          const parent = resolved.find(
            (value) =>
              value.kind === 'method' &&
              normalizedName(value.item.name) === normalizedName(entry.variantOf),
          );
          if (parent) add(ref, parent.ref, 'variant-of', entry);
        }
        if (field === 'code')
          for (const name of [].concat(entry.implements ?? [])) {
            const method = resolved.find(
              (value) =>
                value.field === 'methods' &&
                normalizedName(value.item.name) === normalizedName(name),
            );
            if (method) add(ref, method.ref, 'implements', entry);
          }
      }
      versions.changed([sourceRef, cardRef, ...entities], context);
      versions.close(version.id);
      return { versionId: version.id, cardId: item.id, entities: [...entities] };
    });
  }
  return { plan, save };
}
