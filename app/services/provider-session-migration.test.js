import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from '../testing.js';
import { dataPaths } from '../core/paths.js';
import { createCore } from '../core/index.js';
import { migrateProviderHeaders } from './provider-header-migration.js';
import { migrateProviderSessions } from './provider-session-migration.js';

test('runtime header migration preserves bytes outside confirmed values and reuses an interrupted backup', async (t) => {
  const { dir, cleanup } = await tempDir('provider-session-migration');
  const paths = dataPaths(dir);
  const folder = path.join(paths.runtime, 'pi', 'sessions');
  await mkdir(folder, { recursive: true });
  /** @param {string} value @returns {any} */
  const record = (value) => ({
    schema: 1,
    messages: [
      { role: 'user', content: [{ type: 'text', text: `Keep ordinary text: ${value}` }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '保留思考与格式' },
          {
            type: 'toolCall',
            id: 'keep-call-id',
            name: 'workspace_edit',
            arguments: {
              resource: 'settings',
              key: 'app',
              op: 'patch',
              args: {
                changes: {
                  profile: {
                    bio: JSON.stringify({
                      baseUrl: 'https://example.invalid',
                      api: 'example',
                      headers: { Example: value },
                    }),
                  },
                  providers: [
                    {
                      id: 'legacy',
                      headers: { 'X-Token': value, Referenced: { keyRef: 'keep-ref' } },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    ],
  });
  const first = record('FAKE_RUNTIME_HEADER_A');
  first.messages[1].content[1].arguments.args.changes.providers[0].headers['另一个头'] =
    'FAKE_RUNTIME_HEADER_B';
  const second = record('Bearer FAKE_RUNTIME_HEADER_C');
  const firstText = JSON.stringify(first, null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const secondText = JSON.stringify(second);
  const firstFile = path.join(folder, 'first.json');
  const secondFile = path.join(folder, 'second.json');
  await writeFile(firstFile, firstText);
  await writeFile(secondFile, secondText);
  const unknownText = JSON.stringify({ schema: 2, messages: first.messages });
  await writeFile(path.join(folder, 'unknown.json'), unknownText);
  try {
    await assert.rejects(
      migrateProviderSessions(paths, {
        replace: async () => {
          throw new Error('synthetic interruption before rename');
        },
      }),
      /synthetic interruption/,
    );
    assert.equal(await readFile(firstFile, 'utf8'), firstText);
    assert.equal(await readFile(secondFile, 'utf8'), secondText);
    const [backupDirectory] = await readdir(paths.backups);
    const interruptedFiles = await readdir(path.join(paths.backups, backupDirectory));
    assert.equal(interruptedFiles.length, 1);
    const backedUp = await readFile(path.join(paths.backups, backupDirectory, interruptedFiles[0]));
    assert.ok(backedUp.equals(Buffer.from(firstText)) || backedUp.equals(Buffer.from(secondText)));
    // A restart on another date must find the existing original, not copy it again.
    const oldDate = path.join(paths.backups, 'provider-header-sessions-1999-01-01');
    await rename(path.join(paths.backups, backupDirectory), oldDate);
    const core = await createCore({ dataRoot: dir });
    let result;
    try {
      result = await migrateProviderHeaders(core);
    } finally {
      core.close();
    }
    assert.equal(result.backup, null, 'runtime-only cleanup does not rewrite the database');
    assert.deepEqual(result.rows, {
      revisions: 0,
      resource_snapshots: 0,
      tool_calls: 0,
      events: 0,
    });
    assert.equal(result.runtime.files, 2);
    assert.equal(result.runtime.values, 3);
    assert.equal(result.runtime.backupsCreated, 1);
    assert.equal(result.runtime.skippedFiles, 1);
    assert.ok(result.runtime.backupFolders.includes(oldDate));
    const expectedFirst = structuredClone(first);
    const expectedSecond = structuredClone(second);
    for (const expected of [expectedFirst, expectedSecond]) {
      const headers = expected.messages[1].content[1].arguments.args.changes.providers[0].headers;
      for (const name of Object.keys(headers))
        if (typeof headers[name] === 'string') headers[name] = '<已移除>';
    }
    assert.equal(
      await readFile(firstFile, 'utf8'),
      JSON.stringify(expectedFirst, null, 2).replaceAll('\n', '\r\n') + '\r\n',
    );
    assert.equal(await readFile(secondFile, 'utf8'), JSON.stringify(expectedSecond));
    assert.equal(await readFile(path.join(folder, 'unknown.json'), 'utf8'), unknownText);
    assert.deepEqual(await migrateProviderSessions(paths), {
      files: 0,
      values: 0,
      errors: 0,
      unparsed: [],
      backupsCreated: 0,
      backupFolders: [],
      skippedFiles: 1,
    });
    const originals = [];
    for (const directory of result.runtime.backupFolders)
      for (const name of await readdir(directory))
        originals.push(await readFile(path.join(directory, name), 'utf8'));
    assert.deepEqual(originals.sort(), [firstText, secondText].sort());
    t.diagnostic(
      `isolated runtime fixture: files=${result.runtime.files},values=${result.runtime.values},originals=${originals.length},backupFolders=${result.runtime.backupFolders.map((name) => path.relative(dir, name)).join(',')}`,
    );
  } finally {
    await cleanup();
  }
});

for (const copy of ['details', 'content']) {
  test(`runtime migration redacts matched ${copy} results and reports unparsed text without values`, async (t) => {
    const { dir, cleanup } = await tempDir(`provider-session-result-${copy}`);
    const paths = dataPaths(dir);
    const folder = path.join(paths.runtime, 'pi', 'sessions');
    await mkdir(folder, { recursive: true });
    const call = {
      type: 'toolCall',
      id: 'matched',
      name: 'workspace_edit',
      arguments: { resource: 'settings', key: 'app', op: 'patch', args: { changes: {} } },
    };
    const result = {
      revisionId: 'keep',
      value: {
        providers: [{ id: 'old', headers: { Token: 'FAKE_RESULT_HEADER' } }],
        profile: { bio: 'Keep FAKE_RESULT_HEADER' },
      },
    };
    const resultText = JSON.stringify(result, null, 2);
    const invalidText = 'not JSON: FAKE_UNPARSED_HEADER';
    const message = {
      role: 'toolResult',
      toolCallId: 'matched',
      toolName: 'workspace_edit',
      ...(copy === 'details'
        ? { details: result }
        : {
            content: [
              { type: 'text', text: resultText },
              { type: 'text', text: invalidText },
            ],
          }),
    };
    const record = {
      schema: 1,
      messages: [
        { role: 'assistant', content: [call] },
        message,
        { ...message, toolCallId: 'unmatched' },
        {
          role: 'assistant',
          content: [
            { ...call, id: 'other', arguments: { ...call.arguments, resource: 'profile' } },
          ],
        },
        { ...message, toolCallId: 'other' },
      ],
    };
    const file = path.join(folder, `result-${copy}.json`);
    const original = JSON.stringify(record, null, 2).replaceAll('\n', '\r\n') + '\r\n';
    await writeFile(file, original);
    const core = await createCore({ dataRoot: dir });
    try {
      const migrated = await migrateProviderHeaders(core);
      // Session JSON has no shared object identities between separate results.
      const expected = JSON.parse(JSON.stringify(record));
      if (copy === 'details')
        expected.messages[1].details.value.providers[0].headers.Token = '<已移除>';
      else
        expected.messages[1].content[0].text = resultText.replace(
          '"Token": "FAKE_RESULT_HEADER"',
          '"Token": "<已移除>"',
        );
      assert.equal(
        await readFile(file, 'utf8'),
        JSON.stringify(expected, null, 2).replaceAll('\n', '\r\n') + '\r\n',
      );
      assert.equal(migrated.runtime.files, 1);
      assert.equal(migrated.runtime.values, 1);
      assert.equal(migrated.runtime.errors, copy === 'content' ? 1 : 0);
      assert.deepEqual(
        migrated.runtime.unparsed,
        copy === 'content' ? [{ file: path.relative(dir, file), toolCallId: 'matched' }] : [],
      );
      const [backupDirectory] = migrated.runtime.backupFolders;
      const [backupName] = await readdir(backupDirectory);
      assert.equal(await readFile(path.join(backupDirectory, backupName), 'utf8'), original);
      const receipt = await readFile(
        path.join(paths.logs, 'provider-header-migration.log'),
        'utf8',
      );
      assert.ok(!receipt.includes('FAKE_'));
      assert.ok(!receipt.includes(dir));
      assert.deepEqual(JSON.parse(receipt.trim()).runtime.unparsed, migrated.runtime.unparsed);
      const again = await migrateProviderSessions(paths);
      assert.equal(again.files, 0);
      assert.equal(again.values, 0);
      assert.equal(again.backupsCreated, 0);
      assert.equal(again.errors, copy === 'content' ? 1 : 0);
      t.diagnostic(
        `isolated ${copy} result: files=1,values=1,errors=${migrated.runtime.errors},backup=${path.relative(dir, backupDirectory)}`,
      );
    } finally {
      core.close();
      await cleanup();
    }
  });
}
