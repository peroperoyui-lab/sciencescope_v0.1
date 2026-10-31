import { paragraphHash } from './card-input.js';

const imports = `FROM events WHERE type='research.changed'
  AND json_extract(payload_json,'$.action')='source.imported'`;

/**
 * Parsed versions are validated against durable imports, not original-byte hashes.
 * Only ordinary derived jobs own this private result_json checkpoint.
 * @param {{core:import('../../core/index.js').Core,research:any}} deps
 * @returns {any}
 */
export function createJobVersions({ core, research }) {
  const { db } = core;
  const entries = new Map();
  const removed = new Set();
  const latest = (id) =>
    db
      .prepare(`SELECT max(seq) AS seq ${imports} AND json_extract(payload_json,'$.sourceId')=?`)
      .get(id).seq;
  function read(id, seq = latest(id)) {
    const chunks = research.store.chunks(id);
    const entry = { id, seq, version: paragraphHash(chunks), count: chunks.length, saved: false };
    entries.set(id, entry);
    removed.delete(id);
    return entry;
  }
  function valid(row, seq) {
    if (seq == null || !row?.result_json) return false;
    try {
      const checkpoint = JSON.parse(row.result_json);
      return (
        checkpoint.schema === 1 &&
        checkpoint.sourceEventSeq === seq &&
        checkpoint.paragraphHash === row.content_version
      );
    } catch {
      return false;
    }
  }
  async function restore(stopped) {
    const sources = research.store.listSources();
    const heads = new Map(
      db
        .prepare(
          `SELECT json_extract(payload_json,'$.sourceId') AS id,max(seq) AS seq ${imports}
          GROUP BY json_extract(payload_json,'$.sourceId')`,
        )
        .all()
        .map((row) => [row.id, row.seq]),
    );
    const jobs = new Map(
      db
        .prepare("SELECT * FROM kb_jobs WHERE layer='derived' AND topic=''")
        .all()
        .map((row) => [row.source_id, row]),
    );
    const pending = [];
    for (let index = 0; index < sources.length && !stopped(); index++) {
      const { id } = sources[index];
      if (!removed.has(id)) {
        const row = jobs.get(id),
          seq = heads.get(id) ?? null;
        const existing = entries.get(id);
        if (existing) {
          if (!existing.saved) pending.push(existing);
        } else if (valid(row, seq))
          entries.set(id, { id, seq, version: row.content_version, count: null, saved: true });
        else pending.push(read(id, seq));
      }
      if ((index + 1) % 25 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    return pending;
  }
  function save(entry) {
    const text = JSON.stringify({
      schema: 1,
      sourceEventSeq: entry.seq,
      paragraphHash: entry.version,
    });
    db.prepare(
      `UPDATE kb_jobs SET result_json=? WHERE source_id=? AND layer='derived'
      AND topic='' AND content_version=? AND result_json IS NOT ?`,
    ).run(text, entry.id, entry.version, text);
    entry.saved = true;
  }
  return {
    read,
    restore,
    save,
    versionFor: (id) => (entries.get(id) ?? read(id)).version,
    current: (entry) => entries.get(entry.id) === entry && !removed.has(entry.id),
    forget(id) {
      entries.delete(id);
      removed.add(id);
    },
  };
}
