import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { tempDir } from '../../../testing.js';
import { openDatabase } from '../database.js';
import { migrations } from './index.js';
import { createCore } from '../../index.js';
import { createSecretaryChat } from '../../../services/secretary/chat.js';

test('v5 upgrade preserves old research, and attached secretary/proposals/cursors survive database reopen', async () => {
  const { dir, cleanup } = await tempDir('secretary-migration');
  const file = path.join(dir, 'sciencescope.sqlite');
  const backupDir = path.join(dir, 'backups');
  let database;
  let core;
  try {
    database = await openDatabase(file, { migrations: migrations.slice(0, 5), backupDir });
    database
      .prepare(
        "INSERT INTO participants (id, kind, name, created_at) VALUES ('person_user', 'human', '我', '2026-10-07')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO meetings (id, title, policy_json, created_at, updated_at) VALUES ('main', '研究', '{}', '2026-10-07', '2026-10-07')",
      )
      .run();
    database
      .prepare(
        "INSERT INTO messages (id, meeting_id, seq, author_id, text, created_at, updated_at) VALUES ('old', 'main', 1, 'person_user', '原有消息', '2026-10-07', '2026-10-07')",
      )
      .run();
    database.close();
    database = null;
    core = await createCore({ dataRoot: dir });
    const minutes = { coverage: () => 0, coveredMessageIds: () => [] };
    const secretary = createSecretaryChat({ core, minutes });
    const attached = secretary.ensure('main');
    const proposal = secretary.propose(
      { meetingId: attached.id, participantId: 'agent_secretary' },
      { text: '需要保留的提案' },
    );
    (await secretary.catchUp(attached.id)).commit({ status: 'done' });
    core.close();
    core = await createCore({ dataRoot: dir });
    const reopened = createSecretaryChat({ core, minutes });
    const snapshot = reopened.snapshot('main');
    assert.equal(core.db.prepare('PRAGMA user_version').get().user_version, 6);
    assert.equal(snapshot.meeting.id, attached.id);
    assert.equal(snapshot.cursor.throughSeq, 1);
    assert.equal(snapshot.proposals[0].id, proposal.id);
    assert.equal(snapshot.proposals[0].text, '需要保留的提案');
    assert.equal(core.messages.since('main', 0)[0].text, '原有消息');
    assert.equal(
      (await readdir(backupDir)).filter((name) => name.startsWith('sciencescope-v5-')).length,
      1,
    );
  } finally {
    database?.close();
    core?.close();
    await cleanup();
  }
});
