import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createCore } from '../core/index.js';
import { tempDir } from '../testing.js';
import { hashText } from '../core/workspace/files.js';
import { migrateProviderHeaders } from './provider-header-migration.js';
import { readCredentials } from './providers.js';
import { providerSettings } from './provider-settings.js';

test('startup backs up, migrates and retries one atomic history redaction without adding rows', async (t) => {
  const { dir, cleanup } = await tempDir('provider-header-migration');
  let core = await createCore({ dataRoot: dir });
  const target = { resource: 'settings', key: 'app' };
  const bio = JSON.stringify({
    baseUrl: 'https://example.invalid',
    api: 'openai-completions',
    headers: { Example: 'PUBLIC_EXAMPLE' },
  });
  try {
    for (const header of ['FAKE_OLD_HEADER', 'FAKE_CURRENT_HEADER']) {
      await core.workspace.edit({
        ...target,
        op: 'patch',
        args: {
          changes: {
            providers: [
              { id: 'old', keyRef: 'unchanged-api-key-ref', headers: { 'X-Token': header } },
            ],
            profile: { bio },
            mcp: { servers: [{ id: 'mcp', headers: { Other: { keyRef: 'keep-mcp-ref' } } }] },
          },
        },
      });
      await core.workspace.captureSnapshot(target);
    }
    const meeting = core.meetings.create({
      title: 'Legacy provider',
      members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
    });
    const turn = core.turns.start({ meetingId: meeting.id, participantId: 'agent_main' });
    core.turns.startToolCall({
      turnId: turn.id,
      callId: 'legacy-header',
      name: 'workspace_edit',
      args: {
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: {
          changes: {
            providers: [{ id: 'old', headers: { 'X-Token': 'FAKE_OLD_HEADER' } }],
            profile: { bio },
          },
        },
      },
    });
    core.turns.endToolCall(turn.id, 'legacy-header', {
      isError: false,
      result: {
        revisionId: 'keep-revision-id',
        value: JSON.parse(await readFile(core.paths.settings, 'utf8')),
      },
    });
    const rows = () => ({
      revisions: core.db.prepare('SELECT * FROM revisions').all(),
      snapshots: core.db.prepare('SELECT * FROM resource_snapshots').all(),
      tool_calls: core.db.prepare('SELECT * FROM tool_calls').all(),
      events: core.db.prepare('SELECT * FROM events').all(),
    });
    const before = rows();
    core.db.exec(
      "CREATE TRIGGER fail_header_migration BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END;",
    );
    await assert.rejects(migrateProviderHeaders(core), /synthetic migration failure/);
    assert.deepEqual(rows(), before, 'all four historical tables roll back together');
    assert.equal(
      (await readCredentials(core.paths)).refs['provider.old.headers.X-Token'],
      'FAKE_CURRENT_HEADER',
    );
    core.db.exec('DROP TRIGGER fail_header_migration');
    const migrated = await migrateProviderHeaders(core);
    assert.equal(migrated.changed, true);
    assert.deepEqual(migrated.rows, {
      revisions: 2,
      resource_snapshots: 2,
      tool_calls: 1,
      events: 2,
    });
    t.diagnostic(`isolated fixture redacted rows: ${JSON.stringify(migrated.rows)}`);
    assert.ok(
      (await readdir(core.paths.backups)).some((file) => file.startsWith('provider-headers-')),
    );
    const backup = new DatabaseSync(migrated.backup, { readOnly: true });
    try {
      assert.ok(
        JSON.stringify(backup.prepare('SELECT * FROM revisions').all()).includes('FAKE_OLD_HEADER'),
      );
    } finally {
      backup.close();
    }
    const settingsText = await readFile(core.paths.settings, 'utf8');
    const settings = JSON.parse(settingsText);
    assert.deepEqual(settings.providers[0].headers['X-Token'], {
      keyRef: 'provider.old.headers.X-Token',
    });
    assert.equal(settings.profile.bio, bio);
    const after = rows();
    assert.doesNotMatch(JSON.stringify(after), /FAKE_(?:OLD|CURRENT)_HEADER/);
    assert.doesNotMatch(settingsText, /FAKE_(?:OLD|CURRENT)_HEADER/);
    assert.equal(after.revisions.length, before.revisions.length);
    assert.equal(after.snapshots.length, before.snapshots.length);
    assert.equal(after.tool_calls.length, before.tool_calls.length);
    assert.equal(after.events.length, before.events.length);
    const tool = after.tool_calls[0];
    assert.equal(
      JSON.parse(tool.args_json).args.changes.providers[0].headers['X-Token'],
      '<已移除>',
    );
    assert.equal(JSON.parse(tool.args_json).args.changes.profile.bio, bio);
    assert.equal(JSON.parse(tool.result_json).value.profile.bio, bio);
    assert.equal(JSON.parse(tool.result_json).revisionId, 'keep-revision-id');
    for (const [index, event] of after.events.entries()) {
      const old = before.events[index];
      const { payload_json: payload, ...metadata } = event;
      const { payload_json: oldPayload, ...oldMetadata } = old;
      assert.deepEqual(metadata, oldMetadata);
      if (!['tool.started', 'tool.ended'].includes(String(event.type)))
        assert.equal(payload, oldPayload);
      else {
        const value = JSON.parse(payload);
        assert.equal(value.args.args.changes.profile.bio, bio);
        if (value.result) assert.equal(value.result.value.profile.bio, bio);
      }
    }
    for (const row of after.revisions) {
      if (row.resource !== 'settings') continue;
      for (const text of [row.before_text, row.after_text]) {
        if (text == null) continue;
        const configuration = JSON.parse(text);
        assert.equal(configuration.profile.bio, bio);
        for (const provider of configuration.providers ?? [])
          assert.notEqual(provider.headers?.['X-Token'], 'FAKE_OLD_HEADER');
        assert.equal(configuration.mcp.servers[0].headers.Other.keyRef, 'keep-mcp-ref');
      }
      assert.equal(row.after_hash, hashText(row.after_text));
    }
    for (const row of after.snapshots) {
      assert.equal(JSON.parse(row.content_text).providers[0].headers['X-Token'], '<已移除>');
      assert.equal(row.content_hash, hashText(row.content_text));
    }
    await core.workspace.read(target);
    assert.equal(
      rows().revisions.length,
      before.revisions.length,
      'migration creates no external revision',
    );
    assert.deepEqual(await migrateProviderHeaders(core), {
      changed: false,
      backup: null,
      rows: { revisions: 0, resource_snapshots: 0, tool_calls: 0, events: 0 },
      runtime: {
        files: 0,
        values: 0,
        errors: 0,
        unparsed: [],
        backupsCreated: 0,
        backupFolders: [],
        skippedFiles: 0,
      },
    });
    const oldSnapshot = after.snapshots[0].id;
    core.close();
    core = await createCore({ dataRoot: dir, settingsResource: providerSettings(dir) });
    const restored = await core.workspace.restoreSnapshot(oldSnapshot);
    assert.deepEqual(restored.value.providers[0].headers['X-Token'], {
      keyRef: 'provider.old.headers.X-Token',
    });
    assert.equal(
      (await readCredentials(core.paths)).refs['provider.old.headers.X-Token'],
      'FAKE_CURRENT_HEADER',
    );
  } finally {
    core.close();
    await cleanup();
  }
});
