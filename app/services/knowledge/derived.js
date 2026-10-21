import { newId, nowIso } from '../../core/ids.js';
import { citationEdges } from './citations.js';
import { LITERATURE_KINDS } from '../research/records.js';

const literature = new Set(LITERATURE_KINDS);
const edgeKey = (edge) => `${edge.fromRef}\0${edge.toRef}\0${edge.relation}`;

/**
 * Existing pairs occupy slots during imports. A full settings rebuild starts
 * with no occupied slots and ranks every qualifying candidate pair.
 * @param {any[]} rankings
 * @param {{threshold:number,maxPerPaper:number}} settings
 * @param {any[]} [existing]
 * @returns {any[]}
 */
export function similarEdges(rankings, settings, existing = []) {
  const pairs = new Map();
  for (const source of rankings) {
    for (const neighbour of source.neighbours) {
      if (neighbour.score < settings.threshold || source.id === neighbour.id) continue;
      const [from, to] = [source.id, neighbour.id].sort();
      const edge = {
        fromRef: 'source:' + from,
        toRef: 'source:' + to,
        relation: 'similar-to',
        method: 'similar',
        weight: neighbour.score,
        evidence: [],
      };
      pairs.set(edgeKey(edge), edge);
    }
  }
  const degrees = new Map(),
    selected = [...existing];
  for (const edge of existing) {
    pairs.delete(edgeKey(edge));
    for (const ref of [edge.fromRef, edge.toRef]) degrees.set(ref, (degrees.get(ref) ?? 0) + 1);
  }
  for (const edge of [...pairs.values()].sort(
    (a, b) => b.weight - a.weight || edgeKey(a).localeCompare(edgeKey(b)),
  )) {
    if ([edge.fromRef, edge.toRef].some((ref) => (degrees.get(ref) ?? 0) >= settings.maxPerPaper))
      continue;
    selected.push(edge);
    for (const ref of [edge.fromRef, edge.toRef]) degrees.set(ref, (degrees.get(ref) ?? 0) + 1);
  }
  return selected;
}

/**
 * A disposable projection: changes emit graph events, never editing revisions
 * or research.changed (edges do not alter embedding documents).
 * @param {{core:import('../../core/index.js').Core,research:any,semantic:any}} deps
 * @returns {any}
 */
export function createDerived({ core, research, semantic }) {
  const { db } = core;
  function changed(rows) {
    if (!rows.length) return;
    core.events.record(
      'knowledge.changed',
      {
        refs: [...new Set(rows.flatMap((row) => ['edge:' + row.id, row.from_ref, row.to_ref]))],
      },
      { actorId: 'system' },
    );
  }
  function reset(sourceId) {
    const ref = 'source:' + sourceId;
    db.transaction(() => {
      const rows = db
        .prepare("SELECT * FROM kb_edges WHERE layer='derived' AND (from_ref=? OR to_ref=?)")
        .all(ref, ref);
      for (const row of rows) db.prepare('DELETE FROM kb_edges WHERE id=?').run(row.id);
      changed(rows);
    });
  }
  function reconcile(desired, existing) {
    db.transaction(() => {
      const byKey = new Map(
        existing.map((row) => [
          edgeKey({
            fromRef: row.from_ref,
            toRef: row.to_ref,
            relation: row.relation,
          }),
          row,
        ]),
      );
      const affected = [];
      for (const edge of desired) {
        const key = edgeKey(edge),
          previous = byKey.get(key);
        byKey.delete(key);
        const evidence = JSON.stringify(edge.evidence);
        if (
          previous?.status === 'active' &&
          previous.evidence_json === evidence &&
          previous.weight === (edge.weight ?? null)
        )
          continue;
        const id = previous?.id ?? newId('edg'),
          now = nowIso();
        db.prepare(
          `INSERT INTO kb_edges
          (id,from_ref,to_ref,relation,evidence_json,layer,origin,method,weight,created_by,created_at,updated_at)
          VALUES(?,?,?,?,?,'derived','system',?,?,'system',?,?)
          ON CONFLICT(id) DO UPDATE SET evidence_json=excluded.evidence_json,
            weight=excluded.weight,status='active',updated_at=excluded.updated_at`,
        ).run(
          id,
          edge.fromRef,
          edge.toRef,
          edge.relation,
          evidence,
          edge.method,
          edge.weight ?? null,
          now,
          now,
        );
        affected.push({ id, from_ref: edge.fromRef, to_ref: edge.toRef });
      }
      for (const row of byKey.values()) {
        db.prepare('DELETE FROM kb_edges WHERE id=?').run(row.id);
        affected.push(row);
      }
      changed(affected);
    });
  }
  async function similar(sourceId, settings) {
    if (
      !Number.isFinite(settings.threshold) ||
      settings.threshold < -1 ||
      settings.threshold > 1 ||
      !Number.isInteger(settings.maxPerPaper) ||
      settings.maxPerPaper < 0
    )
      throw new Error(
        'knowledge.similarity requires threshold between -1 and 1 and a nonnegative integer maxPerPaper.',
      );
    const existing = db
      .prepare("SELECT * FROM kb_edges WHERE layer='derived' AND method='similar'")
      .all();
    if (settings.maxPerPaper === 0) {
      reconcile([], existing);
      return 'done';
    }
    const sources = research.store.listSources().filter((source) => literature.has(source.kind));
    if (sourceId && !sources.some((source) => source.id === sourceId)) return 'skipped';
    const retained = sourceId
      ? existing.map((row) => ({
          fromRef: row.from_ref,
          toRef: row.to_ref,
          relation: row.relation,
          method: 'similar',
          weight: row.weight,
          evidence: JSON.parse(String(row.evidence_json)),
        }))
      : [];
    const degree = new Map();
    for (const edge of retained)
      for (const ref of [edge.fromRef, edge.toRef]) degree.set(ref, (degree.get(ref) ?? 0) + 1);
    // Imports cannot displace a paper's already established neighbours.
    const candidates = sourceId
      ? sources.filter(
          (source) =>
            source.id === sourceId ||
            (degree.get('source:' + source.id) ?? 0) < settings.maxPerPaper,
        )
      : sources;
    const result = await semantic.sourceNeighbors(
      candidates.map((source) => source.id),
      {
        sourceIds: sourceId ? [sourceId] : candidates.map((source) => source.id),
        limit: sourceId ? settings.maxPerPaper : candidates.length,
        threshold: settings.threshold,
      },
    );
    if (result?.paused) return 'queued';
    if (!result) return 'skipped';
    // Deletions can run while vector queries yield. Never resurrect their edges.
    const currentIds = new Set(research.store.listSources().map((source) => source.id));
    const valid = (edge) =>
      currentIds.has(edge.fromRef.slice(7)) && currentIds.has(edge.toRef.slice(7));
    reconcile(
      similarEdges(
        result.rankings
          .filter((source) => currentIds.has(source.id))
          .map((source) => ({
            ...source,
            neighbours: source.neighbours.filter((other) => currentIds.has(other.id)),
          })),
        settings,
        retained.filter(valid),
      ),
      db.prepare("SELECT * FROM kb_edges WHERE layer='derived' AND method='similar'").all(),
    );
    return !sourceId || result.rankings.some((source) => source.id === sourceId)
      ? 'done'
      : 'skipped';
  }
  async function run(sourceId, settings) {
    const sources = research.store.listSources();
    if (!sources.some((source) => source.id === sourceId)) return 'done';
    const ref = 'source:' + sourceId;
    reconcile(
      citationEdges(sources, research.store.chunks, sourceId),
      db
        .prepare(
          "SELECT * FROM kb_edges WHERE layer='derived' AND relation='cites' AND (from_ref=? OR to_ref=?)",
        )
        .all(ref, ref),
    );
    return similar(sourceId, settings);
  }
  return { run, reset, similar };
}
