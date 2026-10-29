import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { collectUsage } from './usage.mjs';

test('usage attributes concurrent minutes by unique source ownership and retains model and unknown usage', async () => {
  const parent = path.resolve('.sciencescope-local/temp/p4b');
  await mkdir(parent, { recursive: true });
  const data = await mkdtemp(path.join(parent, 'usage-test-'));
  await mkdir(path.join(data, 'logs'));
  await mkdir(path.join(data, 'runtime/pi/sessions'), { recursive: true });
  const db = new DatabaseSync(path.join(data, 'sciencescope.sqlite'));
  db.exec(`
    CREATE TABLE meetings(id TEXT,project_id TEXT);
    CREATE TABLE turns(id TEXT,meeting_id TEXT,participant_id TEXT,started_at TEXT,ended_at TEXT);
    CREATE TABLE kb_jobs(source_id TEXT,layer TEXT,state TEXT,meeting_id TEXT,result_json TEXT);
    CREATE TABLE rb_sources(id TEXT,project_id TEXT);
    CREATE TABLE manuscript_versions(id TEXT,notes_turn_id TEXT);
    CREATE TABLE memory_runs(meeting_id TEXT,status_json TEXT);
    CREATE TABLE revisions(turn_id TEXT,resource TEXT);
    CREATE TABLE runtime_sessions(session_id TEXT,meeting_id TEXT,participant_id TEXT);
    CREATE TABLE messages(id TEXT,meeting_id TEXT);
    CREATE TABLE tool_calls(id TEXT,turn_id TEXT,name TEXT,args_json TEXT,status TEXT,started_at TEXT,ended_at TEXT,kind TEXT);
    INSERT INTO meetings VALUES('mtg_a','prj_a'),('mtg_b','prj_b');
    INSERT INTO turns VALUES
      ('turn_a','mtg_a','agent_secretary','2026-10-27T07:00:00Z','2026-10-27T07:00:10Z'),
      ('turn_b','mtg_b','agent_secretary','2026-10-27T07:00:00Z','2026-10-27T07:00:10Z'),
      ('foreground','mtg_a','agent_main','2026-10-27T07:00:04.500Z','2026-10-27T07:00:04.750Z');
    INSERT INTO revisions VALUES('turn_a','minutes'),('turn_b','minutes');
    INSERT INTO messages VALUES('msg_a','mtg_a'),('msg_b','mtg_b');
    INSERT INTO tool_calls VALUES
      ('read_a','turn_a','workspace_read','{"target":"minutes"}','done','2026-10-27T07:00:01Z','2026-10-27T07:00:02Z','tool'),
      ('read_b','turn_a','workspace_read','{"target":"minutes"}','done','2026-10-27T07:00:03Z','2026-10-27T07:00:04Z','tool'),
      ('thinking','turn_a','thinking','{}','done','2026-10-27T07:00:01Z','2026-10-27T07:00:02Z','thinking'),
      ('other','turn_b','research_read','{}','done','2026-10-27T07:00:01Z','2026-10-27T07:00:02Z','tool');
  `);
  db.close();
  const endMs = Date.parse('2026-10-27T07:00:05Z');
  const session = (input) => ({
    messages: [
      {
        role: 'system',
        content: 'You maintain the complete research meeting minutes in ScienceScope.',
      },
      { role: 'user', content: input },
      { role: 'assistant', content: 'minutes', timestamp: endMs },
    ],
  });
  await writeFile(
    path.join(data, 'runtime/pi/sessions/unique.json'),
    JSON.stringify(session('msg_a')),
  );
  await writeFile(
    path.join(data, 'runtime/pi/sessions/ambiguous.json'),
    JSON.stringify(session('msg_a msg_b')),
  );
  const request = (session, usage) => ({
    time: new Date(endMs).toISOString(),
    session,
    totalMs: 1000,
    provider: 'opencode-go',
    model: 'deepseek-v4.1-flash',
    api: 'openai-completions',
    httpStatus: 200,
    stopReason: 'stop',
    usage,
  });
  await writeFile(
    path.join(data, 'logs/model-requests.jsonl'),
    [
      request('unique', { input: 20, output: 5, cacheRead: 10, cacheWrite: 0, totalTokens: 35 }),
      request('ambiguous', null),
    ]
      .map(JSON.stringify)
      .join('\n') + '\n',
  );
  const report = await collectUsage(data, {
    scenario: {
      projectId: 'prj_a',
      meetingId: 'mtg_a',
      idleStartMs: endMs + 1000,
      windows: [{ name: 'round-1', startMs: endMs - 2000, endMs }],
    },
  });
  assert.equal(report.requests, 2);
  assert.equal(report.rows[0].turnId, 'turn_a');
  assert.match(report.rows[0].attributionBasis, /message ownership/);
  assert.equal(report.rows[0].provider, 'opencode-go');
  assert.equal(report.rows[0].model, 'deepseek-v4.1-flash');
  assert.equal(report.rows[0].inputIncludingCacheTokens, 30);
  assert.equal(report.rows[0].foregroundOverlap, true);
  assert.equal(report.rows[0].foregroundOverlapMs, 250);
  assert.equal(report.rows[0].startedDuringForeground, false);
  assert.equal(report.rows[1].turnId, null);
  assert.equal(report.rows[1].attributionBasis, null);
  assert.equal(report.rows[1].totalTokens, null);
  assert.equal(report.groups[0].unknownRequests, 1);
  assert.equal(report.scopes.scenario.requests, 1);
  assert.equal(report.scopes.otherProfileWork.requests, 1);
  assert.equal(report.tools.calls, 2);
  assert.equal(report.tools.reads, 2);
  assert.equal(report.tools.repeatedReads, 1);
  assert.deepEqual(report.roundStarts[0].requestsByKind, { minutes: 2 });
  assert.deepEqual(report.contextCoverage, { reconstructed: 2, unavailable: 0 });
});
