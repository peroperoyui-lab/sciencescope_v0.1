import { nowIso } from '../../core/ids.js';
import { cardInput, paragraphHash } from './card-input.js';
import { CARD_COST, CARD_KINDS } from './cards.js';
import { startSettingsStage } from '../../core/workspace/settings-observation.js';

/**
 * Card lane of the knowledge queue. The parent schedules derived work first;
 * this lane owns two model slots and the same durable kb_jobs checkpoints.
 * @param {{core:import('../../core/index.js').Core,research:any,worker:any,busy:()=>boolean,notify:()=>void,schedule:()=>void,versionFor?:(id:string)=>string}} deps
 * @returns {any}
 */
export function createCardQueue({ core, research, worker, busy, notify, schedule, versionFor }) {
  const { db } = core;
  const contentVersion = versionFor ?? ((id) => paragraphHash(research.store.chunks(id)));
  const active = new Map();
  let settings = null,
    closed = false;
  let configuration = null;
  let configuring = null;
  let configurationVersion = 0;
  const get = (id) =>
    db.prepare("SELECT * FROM kb_jobs WHERE source_id=? AND layer='card' AND topic=''").get(id);
  function enqueue(id, manual = false) {
    if (!worker || !settings || closed) return;
    const source = research.store.getSource(id);
    const previous = get(id);
    if (!manual && (!settings.knowledge.cards.enabled || !CARD_KINDS.includes(source.kind))) return;
    const version = contentVersion(id);
    if (
      previous?.content_version === version &&
      (!manual || previous.state === 'running' || previous.state === 'queued')
    )
      return;
    db.prepare(
      `INSERT INTO kb_jobs(source_id,layer,topic,state,content_version,manual,updated_at)
      VALUES(?,'card','','queued',?,?,?) ON CONFLICT(source_id,layer,topic)
      DO UPDATE SET state='queued',content_version=excluded.content_version,manual=excluded.manual,error=NULL,attempts=0,result_json=NULL,updated_at=excluded.updated_at`,
    ).run(id, version, Number(manual), nowIso());
    notify();
    schedule();
  }
  const derivedFinished = (id) => {
    const row = db
      .prepare(
        "SELECT state,content_version FROM kb_jobs WHERE source_id=? AND layer='derived' AND topic=''",
      )
      .get(id);
    return (
      row && ['done', 'skipped'].includes(row.state) && row.content_version === contentVersion(id)
    );
  };
  function pending() {
    if (!worker || !settings || closed) return [];
    return db
      .prepare(
        "SELECT * FROM kb_jobs WHERE layer='card' AND (state='queued' OR (state='failed' AND attempts<3)) ORDER BY updated_at,source_id",
      )
      .all()
      .filter(
        (row) =>
          !active.has(row.source_id) &&
          (row.manual || settings.knowledge.cards.enabled) &&
          derivedFinished(row.source_id),
      );
  }
  function state(job, value, error, result, attempts) {
    const previous = job.result_json ? JSON.parse(job.result_json) : null;
    if (result?.usage && previous?.usage) {
      result = { ...result, usage: { ...result.usage } };
      for (const key of [
        'requests',
        'inputTokens',
        'outputTokens',
        'totalTokens',
        'unknownRequests',
      ])
        result.usage[key] =
          result.usage[key] == null || previous.usage[key] == null
            ? null
            : result.usage[key] + previous.usage[key];
      result.usage.source =
        result.usage.totalTokens == null
          ? 'unreported'
          : result.usage.unknownRequests
            ? 'partial'
            : 'reported';
    }
    result ??= previous;
    db.prepare(
      `UPDATE kb_jobs SET state=?,error=?,result_json=?,attempts=?,updated_at=?
      WHERE source_id=? AND layer='card' AND topic='' AND content_version=?`,
    ).run(
      value,
      error ?? null,
      result ? JSON.stringify(result) : null,
      attempts,
      nowIso(),
      job.source_id,
      job.content_version,
    );
    notify();
  }
  function fill() {
    if (closed || busy()) return;
    for (const job of pending()) {
      if (active.size >= 2 || busy()) break;
      state(job, 'running', null, null, job.attempts);
      const work = worker
        .run(
          job,
          settings,
          () => !closed && !busy() && (job.manual || settings.knowledge.cards.enabled),
        )
        .then((result) =>
          state(
            job,
            result.state,
            result.error,
            result.result,
            result.state === 'done' ? 0 : job.attempts,
          ),
        )
        .catch((error) =>
          state(
            job,
            closed ? 'queued' : 'failed',
            String(error.message),
            error.cardResult ?? {
              usage: {
                requests: 0,
                inputTokens: 0,
                outputTokens: 0,
                totalTokens: 0,
                unknownRequests: 0,
                source: 'not-requested',
              },
            },
            Number(job.attempts) + (closed ? 0 : 1),
          ),
        )
        .finally(() => {
          active.delete(job.source_id);
          schedule();
        });
      active.set(job.source_id, work);
    }
  }
  function configure(value, { force = false } = {}) {
    settings = value;
    const signature = JSON.stringify([
      value.knowledge.cards,
      value.memory.model,
      value.models.default,
      value.providers,
    ]);
    if (!force && configuration === signature) return configuring ?? Promise.resolve();
    configuration = signature;
    const version = ++configurationVersion;
    const finishConfigure = startSettingsStage('knowledge.cards.configure');
    const work = (async () => {
      if (!worker) return;
      const finishModel = startSettingsStage('knowledge.cards.model');
      const model = await worker.model(settings);
      finishModel();
      if (closed || version !== configurationVersion) return;
      if (model)
        db.prepare(
          "UPDATE kb_jobs SET state='queued',error=NULL,updated_at=? WHERE layer='card' AND state='skipped' AND error='no-model'",
        ).run(nowIso());
      const finishBackfill = startSettingsStage('knowledge.cards.backfill');
      let scanned = 0;
      for (const row of db
        .prepare(
          "SELECT source_id FROM kb_jobs WHERE layer='derived' AND topic='' AND state IN ('done','skipped')",
        )
        .all()) {
        scanned++;
        enqueue(row.source_id);
      }
      finishBackfill(scanned);
      notify();
      schedule();
    })()
      .catch((error) => {
        if (version === configurationVersion) configuration = null;
        throw error;
      })
      .finally(() => {
        finishConfigure();
        if (version === configurationVersion) configuring = null;
      });
    configuring = work;
    return work;
  }
  function summary() {
    const counts = { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    const rows = db
      .prepare(
        "SELECT source_id AS sourceId,state,error,attempts,content_version AS contentVersion,result_json FROM kb_jobs WHERE layer='card' ORDER BY source_id",
      )
      .all();
    for (const row of rows) counts[String(row.state)]++;
    return {
      counts,
      jobs: rows.map(({ result_json, ...row }) => ({
        ...row,
        result: result_json ? JSON.parse(String(result_json)) : null,
      })),
    };
  }
  function estimate(projectId) {
    const sources = research.store.listSources(
      projectId ? { projectId, includePersonal: false } : {},
    );
    const count = sources.filter((source) => {
      const job = get(source.id);
      const chunks = research.store.chunks(source.id);
      return (
        CARD_KINDS.includes(source.kind) &&
        cardInput(source, chunks).paragraphs.length > 0 &&
        !(
          job?.content_version === paragraphHash(chunks) &&
          ['done', 'running'].includes(String(job?.state))
        )
      );
    }).length;
    const perPaper =
      (CARD_COST.inputTokens * CARD_COST.inputPerMillion +
        CARD_COST.outputTokens * CARD_COST.outputPerMillion) /
      1e6;
    return {
      count,
      currency: CARD_COST.currency,
      upperCost: count * perPaper * CARD_COST.uncertainty,
      assumptions: CARD_COST,
      estimated: true,
    };
  }
  async function start() {
    await worker?.start();
    db.prepare("UPDATE kb_jobs SET state='queued' WHERE layer='card' AND state='running'").run();
  }
  async function close() {
    closed = true;
    await worker?.close();
    await Promise.allSettled(active.values());
  }
  return {
    start,
    enqueue,
    configure,
    summary,
    estimate,
    fill,
    pending,
    close,
    running: () => active.size,
    wait: () => Promise.race(active.values()),
  };
}
