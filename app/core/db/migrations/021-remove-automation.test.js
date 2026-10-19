import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { createApp } from '../../../app.js';
import { createScriptedRuntime } from '../../../runtime/scripted.js';
import { TOOL_SPECS } from '../../../services/tools.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';

test('v20 paused automation upgrades to a direct chat and answers a new message once', async () => {
  const { dir, cleanup } = await tempDir('remove-automation');
  let app;
  try {
    const db = await openDatabase(path.join(dir, 'sciencescope.sqlite'), {
      migrations: migrations.filter((migration) => migration.version <= 20),
      backupDir: path.join(dir, 'backups'),
    });
    try {
      db.exec(`INSERT INTO participants VALUES ('person_user','human','User','date');
        INSERT INTO meetings (id,title,policy_json,created_at,updated_at)
        VALUES ('old-chat','旧自动化对话','{"mode":"autonomous","goal":"Old task","approval":"ask","respondent":"agent_main"}','date','date');
        INSERT INTO messages (id,meeting_id,seq,author_id,text,status,created_at,updated_at)
        VALUES ('old-question','old-chat',1,'person_user','保留旧消息','done','date','date');
        INSERT INTO meeting_goals (meeting_id,text,status,started_at,updated_at)
        VALUES ('old-chat','Old task','paused','date','date');`);
    } finally {
      db.close();
    }
    await writeFile(
      path.join(dir, 'settings.json'),
      JSON.stringify({
        models: { default: { provider: 'test', model: 'test' } },
        python: { defaultEnvironment: 'system' },
      }),
    );
    let calls = 0;
    app = await createApp({
      dataRoot: dir,
      token: 'migration-test',
      runtime: createScriptedRuntime({
        script: async function* () {
          calls += 1;
          yield '普通回答';
        },
      }),
    });
    assert.deepEqual(app.core.meetings.get('old-chat').policy, {
      mode: 'direct',
      approval: 'ask',
      respondent: 'agent_main',
    });
    assert.equal(
      app.core.db.prepare("SELECT name FROM sqlite_master WHERE name='meeting_goals'").get(),
      undefined,
    );
    assert.equal(
      TOOL_SPECS.some((tool) => tool.name === 'goal_update'),
      false,
    );
    app.core.meetings.addMember('old-chat', { participantId: 'agent_main' });
    const base = await app.listen();
    const headers = { authorization: 'Bearer migration-test', 'content-type': 'application/json' };
    const response = await fetch(`${base}/api/meetings/old-chat/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: '现在照常回答' }),
    });
    assert.equal(response.status, 200);
    await app.conductor.idle();
    assert.equal(calls, 1);
    const messages = app.core.messages.since('old-chat', 0);
    assert.equal(messages[0].text, '保留旧消息');
    assert.equal(messages.at(-1).text, '普通回答');
    assert.equal(messages.at(-1).status, 'done');
    const activity = await fetch(`${base}/api/activity`, { headers }).then((result) =>
      result.json(),
    );
    assert.equal(Object.hasOwn(activity, 'goals'), false);
    assert.equal((await fetch(`${base}/api/meetings/old-chat/goal`, { headers })).status, 404);
    app.core.meetings.update('old-chat', { policy: { mode: 'round' } });
    assert.equal(app.core.meetings.get('old-chat').policy.mode, 'round');
  } finally {
    await app?.close();
    await cleanup();
  }
});
