export const knowledgeNodeTables = {
  entity: 'kb_entities',
  source: 'rb_sources',
  item: 'rb_items',
  chunk: 'rb_chunks',
  edge: 'kb_edges',
};

/**
 * @param {string} ref
 * @param {any} row
 * @returns {{ref:string,name:string,kind:string}}
 */
export function describeKnowledgeRef(ref, row) {
  const type = ref.split(':')[0];
  return {
    ref,
    name: row?.name ?? row?.title ?? row?.relation ?? row?.label ?? ref,
    kind: row?.kind ?? row?.type ?? type,
  };
}

/**
 * History snapshots and current endpoint descriptions keep their existing shapes.
 * @param {any} row
 * @param {(ref:string,snapshot?:any)=>{ref:string,name:string,kind:string}} describe
 * @returns {any}
 */
export function projectRevisionDetails(row, describe) {
  const snapshot = row.after ?? row.before;
  const detail = { ...row, ...describe(row.ref, snapshot) };
  if (!row.ref.startsWith('edge:') || !snapshot) return detail;
  // An edge reads as 「from —relation→ to」 with its evidence (「本轮修改了知识库」).
  const from = describe(snapshot.from_ref ?? snapshot.fromRef);
  const to = describe(snapshot.to_ref ?? snapshot.toRef);
  const proof = snapshot.evidence_json ?? snapshot.evidence ?? '[]';
  return {
    ...detail,
    from: { ref: from.ref, name: from.name, kind: from.kind },
    to: { ref: to.ref, name: to.name, kind: to.kind },
    evidence: typeof proof === 'string' ? JSON.parse(proof) : proof,
  };
}
