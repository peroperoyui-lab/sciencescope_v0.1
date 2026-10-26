import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
const parse = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
function text(message) {
  return typeof message?.content === 'string'
    ? message.content
    : (message?.content ?? []).map((block) => block.text ?? '').join('\n');
}

/**
 * @param {any[]} messages
 * @returns {string}
 */
export function classifySession(messages) {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map(text)
    .join('\n');
  if (instructions.trim() === 'Reply with OK only.') return 'provider-test';
  if (
    instructions.includes('[ScienceScope memory extraction]') ||
    instructions.includes('[ScienceScope memory verification]')
  )
    return 'memory';
  if (instructions.includes('[ScienceScope paper card]')) return 'knowledge';
  if (instructions.includes("Organize manuscript version notes in the user's language."))
    return 'versionnotes';
  if (instructions.includes('You maintain the complete research meeting minutes in ScienceScope.'))
    return 'minutes';
  if (instructions.includes('Update the enabled research workbench sections from the minutes.'))
    return 'workbench';
  return 'answer';
}

function contextOf(messages, request) {
  if (['failed', 'cancelled'].includes(request.stopReason)) return { available: false };
  const end = Date.parse(request.time),
    start = end - request.totalMs;
  const candidates = messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        message.role === 'assistant' &&
        Number(message.timestamp) >= start - 1000 &&
        Number(message.timestamp) <= end + 1000,
    );
  if (request.purpose === 'compaction' || candidates.length !== 1) return { available: false };
  const prefix = messages
    .slice(0, candidates[0].index)
    .map(({ role, content }) => ({ role, content }));
  const serialized = JSON.stringify(prefix);
  const users = prefix.filter((message) => message.role === 'user');
  const input = text(users.at(-1));
  const evidence = new Set(serialized.match(/(?:msg|chunk|src)_[a-zA-Z0-9-]+/gu) ?? []);
  return {
    available: true,
    basis: 'persisted pre-assistant context reconstructed by timestamp',
    hash: digest(serialized),
    inputHash: digest(input),
    characters: serialized.length,
    messages: prefix.length,
    evidenceCount: evidence.size,
  };
}

/**
 * @param {string} dataRoot
 * @param {{startMs?:number,endMs?:number,scenario?:any,setup?:any}} [options]
 */
export async function collectUsage(
  dataRoot,
  { startMs = -Infinity, endMs = Infinity, scenario = null, setup = null } = {},
) {
  const logs = path.join(dataRoot, 'logs');
  const requests = [];
  let malformedLogLines = 0;
  for (const name of ['model-requests.previous.jsonl', 'model-requests.jsonl']) {
    const contents = await readFile(path.join(logs, name), 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return '';
      throw error;
    });
    for (const line of contents.split('\n').filter(Boolean)) {
      const row = parse(line);
      if (!row) malformedLogLines++;
      if (row && Date.parse(row.time) >= startMs && Date.parse(row.time) <= endMs)
        requests.push(row);
    }
  }
  const db = new DatabaseSync(path.join(dataRoot, 'sciencescope.sqlite'), { readOnly: true });
  let turns, jobs, versions, memories, revisions, runtimeSessions;
  try {
    turns = db
      .prepare(
        'SELECT t.id,t.meeting_id,t.participant_id,t.started_at,t.ended_at,m.project_id FROM turns t JOIN meetings m ON m.id=t.meeting_id',
      )
      .all();
    jobs = db
      .prepare(
        "SELECT j.source_id,j.layer,j.state,j.meeting_id,j.result_json,s.project_id FROM kb_jobs j JOIN rb_sources s ON s.id=j.source_id WHERE j.layer='card'",
      )
      .all();
    versions = db
      .prepare('SELECT id,notes_turn_id FROM manuscript_versions WHERE notes_turn_id IS NOT NULL')
      .all();
    memories = db
      .prepare(
        'SELECT r.meeting_id,m.project_id,r.status_json FROM memory_runs r JOIN meetings m ON m.id=r.meeting_id',
      )
      .all();
    revisions = db
      .prepare("SELECT turn_id FROM revisions WHERE resource='minutes' AND turn_id IS NOT NULL")
      .all();
    runtimeSessions = db
      .prepare('SELECT session_id,meeting_id,participant_id FROM runtime_sessions')
      .all();
  } finally {
    db.close();
  }
  const sessions = new Map();
  const folder = path.join(dataRoot, 'runtime/pi/sessions');
  for (const name of await readdir(folder).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  })) {
    if (!name.endsWith('.json')) continue;
    const value = parse(await readFile(path.join(folder, name), 'utf8'));
    if (Array.isArray(value?.messages)) sessions.set(name.slice(0, -5), value.messages);
  }
  const foreground = turns.filter(
    (turn) => !['agent_secretary', 'actor_card_builder'].includes(turn.participant_id),
  );
  const linked = new Map();
  for (const version of versions)
    linked.set(version.notes_turn_id, {
      kind: 'versionnotes',
      versionId: version.id,
    });
  for (const job of jobs) {
    const result = parse(job.result_json);
    if (result?.turnId)
      linked.set(result.turnId, {
        kind: 'knowledge',
        sourceId: job.source_id,
        projectId: job.project_id,
      });
  }
  for (const memory of memories)
    for (const result of parse(memory.status_json)?.retainedOutputs ?? [])
      if (result.turnId) linked.set(result.turnId, { kind: 'memory', stage: result.stage });
  for (const revision of revisions)
    if (!linked.has(revision.turn_id)) linked.set(revision.turn_id, { kind: 'minutes' });
  const rows = requests.map((request) => {
    const messages = sessions.get(request.session);
    const kind = messages ? classifySession(messages) : 'unclassified';
    const background = ['minutes', 'memory', 'versionnotes', 'knowledge', 'workbench'].includes(
      kind,
    );
    const ended = Date.parse(request.time),
      started = ended - request.totalMs;
    const session = runtimeSessions.find((entry) => entry.session_id === request.session);
    const candidates = turns.filter(
      (turn) =>
        Date.parse(turn.started_at) <= ended &&
        (turn.ended_at == null || Date.parse(turn.ended_at) >= started) &&
        (session
          ? turn.meeting_id === session.meeting_id && turn.participant_id === session.participant_id
          : linked.get(turn.id)?.kind === kind),
    );
    const match = candidates.length === 1 ? candidates[0] : null;
    const overlaps = foreground.filter(
      (turn) =>
        Date.parse(turn.started_at) < ended &&
        (turn.ended_at == null || Date.parse(turn.ended_at) > started),
    );
    const intervals = overlaps
      .map((turn) => [
        Math.max(started, Date.parse(turn.started_at)),
        Math.min(ended, Date.parse(turn.ended_at) || ended),
      ])
      .sort((a, b) => a[0] - b[0]);
    let overlapsMs = 0;
    let previousEnd = -Infinity;
    for (const [from, to] of intervals) {
      overlapsMs += Math.max(0, to - Math.max(from, previousEnd));
      previousEnd = Math.max(previousEnd, to);
    }
    const usage = request.usage;
    return {
      kind,
      sessionId: request.session,
      sessionHash: digest(request.session).slice(0, 16),
      purpose: request.purpose === 'compaction' ? 'compaction' : 'generation',
      linkedTurnHash: match ? digest(match.id).slice(0, 16) : null,
      turnId: match?.id ?? null,
      meetingId: match?.meeting_id ?? null,
      projectId: match?.project_id ?? linked.get(match?.id)?.projectId ?? null,
      turnStartMs: match ? Date.parse(match.started_at) : null,
      newJobStartedDuringForeground:
        background &&
        Boolean(match) &&
        foreground.some(
          (turn) =>
            Date.parse(turn.started_at) <= Date.parse(match.started_at) &&
            (turn.ended_at == null || Date.parse(turn.ended_at) >= Date.parse(match.started_at)),
        ),
      job: match ? (linked.get(match.id) ?? null) : null,
      startMs: started,
      endMs: ended,
      durationMs: request.totalMs,
      httpStatus: request.httpStatus,
      outcome: ['failed', 'cancelled'].includes(request.stopReason)
        ? request.stopReason
        : 'completed',
      reported: Boolean(usage),
      inputTokens: usage?.input ?? null,
      inputIncludingCacheTokens: usage
        ? (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
        : null,
      outputTokens: usage?.output ?? null,
      cacheReadTokens: usage?.cacheRead ?? null,
      cacheWriteTokens: usage?.cacheWrite ?? null,
      totalTokens: usage?.totalTokens ?? null,
      context: messages ? contextOf(messages, request) : { available: false },
      foregroundOverlap: background && overlaps.length > 0,
      foregroundOverlapMs: background ? overlapsMs : 0,
      startedDuringForeground:
        background &&
        overlaps.some(
          (turn) =>
            Date.parse(turn.started_at) <= started &&
            (turn.ended_at == null || Date.parse(turn.ended_at) >= started),
        ),
    };
  });
  const perTurn = new Map();
  for (const row of [...rows].sort((a, b) => a.endMs - b.endMs)) {
    const key = row.turnId ?? row.sessionHash;
    row.requestInTurn = (perTurn.get(key) ?? 0) + 1;
    perTurn.set(key, row.requestInTurn);
  }
  const groups = [...new Set(rows.map((row) => row.kind))].map((kind) => {
    const selected = rows.filter((row) => row.kind === kind);
    const sum = (field) => {
      if (field.endsWith('Tokens') && !selected.some((row) => row[field] != null)) return null;
      return selected.reduce((total, row) => total + (row[field] ?? 0), 0);
    };
    const known = selected.filter((row) => row.reported);
    const hashes = new Map(),
      inputs = new Map();
    for (const row of selected.filter((entry) => entry.context.available)) {
      hashes.set(row.context.hash, (hashes.get(row.context.hash) ?? 0) + 1);
      inputs.set(row.context.inputHash, (inputs.get(row.context.inputHash) ?? 0) + 1);
    }
    return {
      kind,
      requests: selected.length,
      reportedRequests: known.length,
      unknownRequests: selected.length - known.length,
      inputTokens: sum('inputTokens'),
      inputIncludingCacheTokens: sum('inputIncludingCacheTokens'),
      outputTokens: sum('outputTokens'),
      cacheReadTokens: sum('cacheReadTokens'),
      cacheWriteTokens: sum('cacheWriteTokens'),
      totalTokens: sum('totalTokens'),
      requestMs: sum('durationMs'),
      failedRequests: selected.filter((row) => row.outcome !== 'completed').length,
      repeatedContextRequests: [...hashes.values()].reduce((total, count) => total + count - 1, 0),
      repeatedInputRequests: [...inputs.values()].reduce((total, count) => total + count - 1, 0),
      overlapRequests: selected.filter((row) => row.foregroundOverlap).length,
      startsDuringForeground: selected.filter((row) => row.startedDuringForeground).length,
    };
  });
  function scopeSummary(selected) {
    return {
      requests: selected.length,
      groups: [...new Set(selected.map((row) => row.kind))].map((kind) => {
        const subset = selected.filter((row) => row.kind === kind);
        const total = (field) =>
          subset.some((row) => row[field] != null)
            ? subset.reduce((sum, row) => sum + (row[field] ?? 0), 0)
            : null;
        return {
          kind,
          requests: subset.length,
          unknownRequests: subset.filter((row) => !row.reported).length,
          inputTokens: total('inputTokens'),
          inputIncludingCacheTokens: total('inputIncludingCacheTokens'),
          outputTokens: total('outputTokens'),
          totalTokens: total('totalTokens'),
          requestMs: total('durationMs'),
        };
      }),
    };
  }
  const inScenario = (row) =>
    scenario &&
    (row.projectId === scenario.projectId ||
      row.meetingId === scenario.meetingId ||
      scenario.versionIds?.includes(row.job?.versionId) ||
      row.job?.sourceId === scenario.sourceId);
  const inSetup = (row) =>
    setup?.setupTest &&
    row.endMs >= setup.setupTest.startMs &&
    row.startMs <= setup.setupTest.endMs;
  return {
    schema: 1,
    requests: rows.length,
    malformedLogLines,
    groups,
    rows,
    scopes: scenario
      ? {
          scenario: {
            projectId: scenario.projectId,
            meetingId: scenario.meetingId,
            sourceId: scenario.sourceId,
            versionIds: scenario.versionIds,
            throughMs: scenario.drainEndMs ?? scenario.endMs,
            ...scopeSummary(rows.filter(inScenario)),
          },
          setup: scopeSummary(rows.filter(inSetup)),
          otherProfileWork: scopeSummary(rows.filter((row) => !inScenario(row) && !inSetup(row))),
        }
      : null,
    knowledgeJobs: jobs.map((job) => ({
      sourceId: job.source_id,
      projectId: job.project_id,
      state: job.state,
      hasRecordedTurn: Boolean(parse(job.result_json)?.turnId),
      reportedRequests: parse(job.result_json)?.usage?.requests ?? null,
    })),
    memoryRuns: memories.map((row) => {
      const value = parse(row.status_json) ?? {};
      return {
        meetingId: row.meeting_id,
        projectId: row.project_id,
        state: value.state,
        skipReason: value.skipReason,
        requiredTokens: value.requiredTokens,
        tokenLimit: value.tokenLimit,
        requests: value.usage?.requests ?? 0,
      };
    }),
    caveats: [
      'Token totals sum reported requests only; unknownRequests identifies missing usage. inputIncludingCacheTokens includes input plus cache reads/writes.',
      'Request duration is summed work time; concurrent requests can overlap.',
      'Context hashes are reconstructed only when one persisted assistant timestamp matches; failed/discarded/compaction context can be unavailable.',
      'Overlap distinguishes a running request from a new request started during foreground work.',
    ],
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, all) => {
      if (index % 2 === 0) pairs.push([value.replace(/^--/u, ''), all[index + 1]]);
      return pairs;
    }, []),
  );
  if (!args.data || !args.out) {
    process.stderr.write(
      'Usage: node tools/perf/usage.mjs --data <test-data> --out usage.json [--windows live.json]\n',
    );
    process.exitCode = 1;
  } else {
    const scope = args.windows ? JSON.parse(await readFile(args.windows, 'utf8')) : {};
    const scenario = args.scenario ? JSON.parse(await readFile(args.scenario, 'utf8')) : null;
    const setup = args.setup ? JSON.parse(await readFile(args.setup, 'utf8')) : null;
    const report = await collectUsage(path.resolve(args.data), {
      startMs: scope.startMs,
      endMs: scope.endMs,
      scenario,
      setup,
    });
    await mkdir(path.dirname(path.resolve(args.out)), { recursive: true });
    await writeFile(args.out, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(
      JSON.stringify({ requests: report.requests, groups: report.groups }) + '\n',
    );
  }
}
