import { AppError } from '../../core/errors.js';
import { newId, nowIso } from '../../core/ids.js';
import { publicRow, recordRef } from './records.js';

function provenance(actor) {
  const origin = actor.origin ?? (actor.turnId ? 'ai' : 'user');
  if (origin === 'ai' && (!actor.meetingId || !actor.turnId))
    throw new AppError(
      'KNOWLEDGE_AI_CONTEXT_REQUIRED',
      'AI knowledge writes require meeting and turn identifiers.',
    );
  return {
    origin,
    created_by: actor.actorId ?? 'person_user',
    meeting_id: actor.meetingId ?? null,
    turn_id: actor.turnId ?? null,
  };
}

/**
 * Mutations share a transaction and one editing version, including merge side effects.
 * @param {import('../../core/index.js').Core} core
 * @param {ReturnType<typeof import('./records.js').createRecords>} records
 * @param {any} versions
 * @returns {any}
 */
export function createKnowledgeMutations(core, records, versions) {
  const { db } = core;
  function group(actor, work) {
    return db.transaction(() => {
      provenance(actor);
      const version = versions.begin(actor),
        refs = [];
      const change = (ref, after, op = 'update') => {
        const before = records.read(ref);
        if (!before && !after) return null;
        records.write(ref, after);
        versions.record(version.id, ref, before ? op : 'create', before, after, actor);
        refs.push(ref);
        return publicRow(after);
      };
      const result = work(change);
      if (version.automatic) versions.close(version.id);
      versions.changed(refs, actor);
      return result;
    });
  }
  function createEntity(input, actor = {}) {
    return group(actor, (change) => {
      const row = {
        id: newId('ent'),
        kind: input.kind,
        name: input.name,
        name_en: input.nameEn ?? null,
        aliases_json: JSON.stringify(input.aliases ?? []),
        description: input.description ?? '',
        attrs_json: JSON.stringify(input.attrs ?? {}),
        layer: input.layer ?? 'curated',
        produced_from: input.producedFrom ?? null,
        evidence_json: JSON.stringify(input.evidence ?? []),
        ...provenance(actor),
        visibility: input.visibility ?? 'shared',
        status: 'active',
        merged_into: null,
        revision: 1,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      return change(recordRef('entity', row.id), row);
    });
  }
  function edited(row, patch, actor, fields) {
    const result = { ...row, revision: Number(row.revision) + 1, updated_at: nowIso() };
    for (const [key, column] of Object.entries(fields))
      if (Object.hasOwn(patch, key))
        result[column] = column.endsWith('_json') ? JSON.stringify(patch[key]) : patch[key];
    // A user's correction is curated; the first author's provenance remains in history.
    if ((actor.origin ?? (actor.turnId ? 'ai' : 'user')) === 'user') {
      result.origin = 'user';
      if (result.layer === 'extracted') result.layer = 'curated';
    }
    return result;
  }
  const entityFields = {
    kind: 'kind',
    name: 'name',
    nameEn: 'name_en',
    aliases: 'aliases_json',
    description: 'description',
    attrs: 'attrs_json',
    visibility: 'visibility',
  };
  const edgeFields = {
    fromRef: 'from_ref',
    toRef: 'to_ref',
    relation: 'relation',
    attrs: 'attrs_json',
    evidence: 'evidence_json',
    weight: 'weight',
    validFrom: 'valid_from',
    validTo: 'valid_to',
  };
  function updateEntity(id, patch, actor = {}) {
    return group(actor, (change) =>
      change(
        recordRef('entity', id),
        edited(records.requireNode('entity:' + id), patch, actor, entityFields),
      ),
    );
  }
  function removeEntity(id, actor = {}) {
    return group(actor, (change) => {
      const ref = 'entity:' + id,
        row = records.requireNode(ref);
      for (const edge of db
        .prepare(
          "SELECT * FROM kb_edges WHERE (from_ref=? OR to_ref=?) AND layer<>'derived' AND status='active'",
        )
        .all(ref, ref))
        change(
          'edge:' + edge.id,
          { ...edge, status: 'removed', revision: Number(edge.revision) + 1, updated_at: nowIso() },
          'remove',
        );
      return change(
        ref,
        { ...row, status: 'removed', revision: Number(row.revision) + 1, updated_at: nowIso() },
        'remove',
      );
    });
  }
  function mergePreview({ into, from }) {
    records.requireNode('entity:' + into);
    const selected = [...new Set(from)].filter((id) => id !== into);
    for (const id of selected) records.requireNode('entity:' + id);
    const refs = new Set(selected.map((id) => 'entity:' + id));
    const edges = db
      .prepare("SELECT * FROM kb_edges WHERE status='active'")
      .all()
      .filter((edge) => refs.has(String(edge.from_ref)) || refs.has(String(edge.to_ref)));
    return { into, from: selected, edges, relationCount: edges.length };
  }
  function mergeEntities(input, actor = {}) {
    return group(actor, (change) => {
      const preview = mergePreview(input),
        target = records.requireNode('entity:' + preview.into),
        aliases = new Set(JSON.parse(String(target.aliases_json)));
      for (const id of preview.from) {
        const row = records.requireNode('entity:' + id);
        for (const alias of [row.name, row.name_en, ...JSON.parse(String(row.aliases_json))])
          if (alias) aliases.add(alias);
        change(
          'entity:' + id,
          {
            ...row,
            status: 'merged',
            merged_into: target.id,
            revision: Number(row.revision) + 1,
            updated_at: nowIso(),
          },
          'merge',
        );
      }
      const selected = new Set(preview.from.map((id) => 'entity:' + id));
      const rewired = (end) => (selected.has(String(end)) ? 'entity:' + target.id : end);
      for (const edge of preview.edges) {
        const fromRef = rewired(edge.from_ref),
          toRef = rewired(edge.to_ref);
        // An edge between merged entities would become a self-loop: a derived
        // one is dropped (it is rebuilt), a recorded one is removed and comes
        // back when the merge is withdrawn.
        if (fromRef === toRef) {
          if (edge.layer === 'derived') records.write('edge:' + edge.id, null);
          else
            change(
              'edge:' + edge.id,
              {
                ...edge,
                status: 'removed',
                revision: Number(edge.revision) + 1,
                updated_at: nowIso(),
              },
              'merge',
            );
          continue;
        }
        if (edge.layer === 'derived') {
          updateEdge(String(edge.id), { fromRef, toRef }, actor);
          continue;
        }
        change(
          'edge:' + edge.id,
          {
            ...edited(edge, {}, actor, edgeFields),
            from_ref: fromRef,
            to_ref: toRef,
            revision: Number(edge.revision) + 1,
            updated_at: nowIso(),
          },
          'merge',
        );
      }
      const entity = change(
        'entity:' + target.id,
        edited(target, { aliases: [...aliases] }, actor, entityFields),
        'merge',
      );
      return { entity, relationCount: preview.relationCount };
    });
  }
  function validateEndpoints(input) {
    for (const endpoint of [input.fromRef, input.toRef])
      if (!/^(entity|source|item|chunk):/.test(endpoint))
        throw new AppError(
          'KNOWLEDGE_REF_INVALID',
          'Edge endpoints must reference knowledge nodes.',
        );
    records.requireNode(input.fromRef);
    records.requireNode(input.toRef);
  }
  function edgeRow(input, actor) {
    validateEndpoints(input);
    return {
      id: newId('edg'),
      from_ref: input.fromRef,
      to_ref: input.toRef,
      relation: input.relation,
      attrs_json: JSON.stringify(input.attrs ?? {}),
      evidence_json: JSON.stringify(input.evidence ?? []),
      layer: input.layer ?? 'curated',
      ...provenance(actor),
      method: input.method ?? null,
      produced_from: input.producedFrom ?? null,
      weight: input.weight ?? null,
      valid_from: input.validFrom ?? null,
      valid_to: input.validTo ?? null,
      status: 'active',
      revision: 1,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
  }
  function createEdge(input, actor = {}) {
    if (input.layer === 'derived')
      return db.transaction(() => {
        const row = edgeRow(input, { ...actor, origin: 'system' });
        const existing = db
          .prepare(
            "SELECT * FROM kb_edges WHERE from_ref=? AND to_ref=? AND relation=? AND layer='derived'",
          )
          .get(row.from_ref, row.to_ref, row.relation);
        if (existing)
          Object.assign(row, {
            id: existing.id,
            created_at: existing.created_at,
            revision: Number(existing.revision) + 1,
          });
        records.write('edge:' + row.id, row);
        versions.changed(['edge:' + row.id], actor);
        return publicRow(row);
      });
    return group(actor, (change) => {
      const row = edgeRow(input, actor);
      return change('edge:' + row.id, row);
    });
  }
  function updateEdge(id, patch, actor = {}) {
    const before = records.requireNode('edge:' + id);
    const after = edited(before, patch, actor, edgeFields);
    validateEndpoints({ fromRef: after.from_ref, toRef: after.to_ref });
    if (before.layer === 'derived')
      return db.transaction(() => {
        const saved = createEdge({ ...publicRow(after), layer: 'derived' }, actor);
        if (saved.id !== id) records.write('edge:' + id, null);
        return saved;
      });
    return group(actor, (change) => change('edge:' + id, after));
  }
  function removeEdge(id, actor = {}) {
    const row = records.requireNode('edge:' + id),
      after = {
        ...row,
        status: 'removed',
        revision: Number(row.revision) + 1,
        updated_at: nowIso(),
      };
    if (row.layer === 'derived')
      return db.transaction(() => {
        records.write('edge:' + id, after);
        versions.changed(['edge:' + id], actor);
        return publicRow(after);
      });
    return group(actor, (change) => change('edge:' + id, after, 'remove'));
  }
  function setLabel(ref, label, enabled, actor = {}) {
    records.requireNode(ref);
    return group(actor, (change) =>
      change(
        recordRef('label', ref, label),
        enabled
          ? { ref, label, created_by: actor.actorId ?? 'person_user', created_at: nowIso() }
          : null,
        enabled ? 'update' : 'remove',
      ),
    );
  }
  function membership(projectId, ref, enabled, actor = {}) {
    core.projects.get(projectId);
    records.requireNode(ref);
    return group(actor, (change) =>
      change(
        recordRef('membership', projectId, ref),
        enabled
          ? {
              project_id: projectId,
              ref,
              added_by: actor.actorId ?? 'person_user',
              created_at: nowIso(),
            }
          : null,
        enabled ? 'update' : 'remove',
      ),
    );
  }
  return {
    createEntity,
    updateEntity,
    removeEntity,
    mergePreview,
    mergeEntities,
    createEdge,
    updateEdge,
    removeEdge,
    label: setLabel,
    membership,
  };
}
