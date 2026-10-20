import { createHash } from 'node:crypto';
import { nowIso } from '../../core/ids.js';
import { createDerived } from './derived.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/**
 * Persistent derived work yields to turns. The reserved 'similar' topic holds
 * one full-rebuild checkpoint, attached to a catalog source for the existing FK.
 * Its version hashes settings; ordinary source jobs hash parsed paragraphs.
 * @param {{core:import('../../core/index.js').Core,research:any,semantic:any,derived?:any}} deps
 * @returns {any}
 */
export function createKnowledgeJobs({ core, research, semantic, derived }) {
  const worker = derived ?? createDerived({ core, research, semantic });
  const { db } = core;
  let closed = false,
    timer = null,
    running = null,
    unsubscribe = null,
    settingsRead = null;
  let similarity = null,
    settingsRevision = 0,
    checkpoint = null;
  const reset = new Set(),
    refresh = new Set();
  const busy = () => core.turns.running().length > 0;
  const rowFor = (id, topic = '') =>
    db
      .prepare("SELECT * FROM kb_jobs WHERE source_id=? AND layer='derived' AND topic=?")
      .get(id, topic);
  const fullJob = () => {
    const row = db
      .prepare("SELECT * FROM kb_jobs WHERE layer='derived' AND topic='similar' LIMIT 1")
      .get();
    if (row) checkpoint = row;
    return row;
  };
  const pending = () =>
    db
      .prepare(
        `SELECT * FROM kb_jobs WHERE layer='derived'
    AND (state='queued' OR (state='failed' AND attempts<3)) ORDER BY topic ASC,updated_at,source_id LIMIT 1`,
      )
      .get();
  function summary() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    for (const row of db
      .prepare(
        "SELECT state,count(*) AS n FROM kb_jobs WHERE layer='derived' AND topic='' GROUP BY state",
      )
      .all())
      counts[String(row.state)] = Number(row.n);
    const full = fullJob();
    return {
      counts,
      paused: busy(),
      similarity: full
        ? {
            state: full.state,
            attempts: full.attempts,
            error: full.error,
          }
        : null,
      failed: db
        .prepare(
          "SELECT source_id AS sourceId,topic,error,attempts FROM kb_jobs WHERE layer='derived' AND state='failed' ORDER BY source_id,topic",
        )
        .all(),
    };
  }
  function notify() {
    if (!closed) core.events.transient('knowledge.jobs.changed', summary());
  }
  function state(job, value, error = null, attempts = null) {
    db.prepare(
      `UPDATE kb_jobs SET state=?,error=?,attempts=coalesce(?,attempts),updated_at=?
      WHERE source_id=? AND layer='derived' AND topic=?`,
    ).run(value, error, attempts, nowIso(), job.source_id, job.topic);
    notify();
  }
  function queue(id, topic, version) {
    db.prepare(
      `INSERT INTO kb_jobs(source_id,layer,topic,state,content_version,updated_at)
      VALUES(?,'derived',?,'queued',?,?) ON CONFLICT(source_id,layer,topic)
      DO UPDATE SET state='queued',content_version=excluded.content_version,
      error=NULL,attempts=0,updated_at=excluded.updated_at`,
    ).run(id, topic, version, nowIso());
    notify();
    schedule();
  }
  function ensureSimilarityJob() {
    if (!similarity || closed) return;
    const previous = fullJob(),
      version = digest(similarity);
    if (previous?.content_version === version) return;
    const sourceId =
      previous?.source_id ?? db.prepare('SELECT id FROM rb_sources ORDER BY id LIMIT 1').get()?.id;
    // A deleted source cascades its checkpoint. Reattach without turning an
    // ordinary deletion into a full reorder of surviving papers.
    if (!previous && sourceId && checkpoint?.content_version === version) {
      db.prepare(
        `INSERT INTO kb_jobs(source_id,layer,topic,state,content_version,error,attempts,updated_at)
        VALUES(?,'derived','similar',?,?,?,?,?)`,
      ).run(
        sourceId,
        checkpoint.state === 'running' ? 'queued' : checkpoint.state,
        version,
        checkpoint.error,
        checkpoint.attempts,
        nowIso(),
      );
      notify();
      schedule();
      return;
    }
    if (sourceId) queue(sourceId, 'similar', version);
  }
  function loadSettings() {
    const revision = ++settingsRevision;
    settingsRead = (async () => {
      const value = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
      if (closed || revision !== settingsRevision) return;
      similarity = value.knowledge.similarity;
      ensureSimilarityJob();
    })();
    return settingsRead;
  }
  function enqueue(id) {
    const chunks = research.store.chunks(id);
    const version = digest(
      chunks.map((chunk) => [chunk.kind, chunk.section, chunk.page, chunk.text]),
    );
    const previous = rowFor(id);
    if (previous?.content_version === version || (!chunks.length && !previous)) return;
    reset.add(id);
    queue(id, '', version);
    ensureSimilarityJob();
  }
  function schedule() {
    if (closed || timer || running || busy() || !similarity) return;
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, 20);
    timer.unref?.();
  }
  async function drain() {
    if (closed || running || busy() || !similarity) return;
    running = (async () => {
      while (!closed && !busy()) {
        const job = pending();
        if (!job) break;
        const id = String(job.source_id);
        state(job, 'running');
        try {
          if (job.topic === '' && reset.has(id)) {
            worker.reset(id);
            reset.delete(id);
          }
          const result =
            job.topic === 'similar'
              ? await worker.similar(null, similarity)
              : await worker.run(id, similarity);
          // Reparse/settings edits while a vector query yields keep newer work queued.
          if (rowFor(id, String(job.topic))?.content_version === job.content_version)
            state(job, refresh.delete(id + ':' + job.topic) ? 'queued' : result, null, 0);
          if (result === 'queued') break;
        } catch (error) {
          if (rowFor(id, String(job.topic))?.content_version === job.content_version)
            state(job, 'failed', String(error?.message ?? error), Number(job.attempts) + 1);
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    })().finally(() => {
      running = null;
      if (!closed && pending()) schedule();
    });
    return running;
  }
  function retryFailed() {
    db.prepare(
      "UPDATE kb_jobs SET state='queued',attempts=0,error=NULL,updated_at=? WHERE layer='derived' AND state='failed'",
    ).run(nowIso());
    notify();
    schedule();
    return summary();
  }
  function vectorsReady() {
    for (const row of db
      .prepare("SELECT source_id,topic FROM kb_jobs WHERE layer='derived' AND state='running'")
      .all())
      refresh.add(row.source_id + ':' + row.topic);
    // Backfill skipped work without rebuilding completed citations or evicting
    // existing neighbours just because a newly imported paper gained a vector.
    db.prepare(
      `UPDATE kb_jobs SET state='queued',updated_at=? WHERE layer='derived' AND state='skipped'
      AND (topic='similar' OR source_id IN (
        SELECT id FROM rb_sources WHERE kind IN ('paper','preprint','thesis','report','chapter','book')
      ))`,
    ).run(nowIso());
    notify();
    schedule();
  }
  async function start() {
    db.prepare("UPDATE kb_jobs SET state='queued' WHERE layer='derived' AND state='running'").run();
    for (const row of db
      .prepare(
        "SELECT source_id FROM kb_jobs WHERE layer='derived' AND topic='' AND state='queued'",
      )
      .all())
      reset.add(String(row.source_id));
    unsubscribe = core.events.subscribe((event) => {
      if (event.type === 'research.changed' && event.payload.action === 'source.imported')
        enqueue(event.payload.sourceId);
      if (event.type === 'research.changed' && event.payload.action === 'source.deleted')
        ensureSimilarityJob();
      if (event.type === 'research.semantic.changed' && event.payload.state === 'ready')
        vectorsReady();
      if (event.type === 'resource.changed' && event.payload.resource === 'settings')
        void loadSettings().catch((error) =>
          core.events.transient('knowledge.jobs.changed', {
            ...summary(),
            error: String(error.message),
          }),
        );
      if (event.type === 'turn.started' || event.type === 'turn.ended') notify();
      if (event.type === 'turn.ended') schedule();
    });
    await loadSettings();
    for (const source of research.store.listSources()) enqueue(source.id);
    if (semantic.status().state === 'ready') vectorsReady();
    schedule();
  }
  async function idle() {
    await settingsRead;
    clearTimeout(timer);
    timer = null;
    await running;
    await drain();
  }
  async function close() {
    closed = true;
    unsubscribe?.();
    clearTimeout(timer);
    await settingsRead;
    await running;
  }
  return { start, summary, retryFailed, idle, close };
}
