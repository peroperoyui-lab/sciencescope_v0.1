// Startup runs this before any workspace read can record an external edit.
// Credentials are durable first; file replacement and the DB transaction are
// retryable if shutdown interrupts the migration between those two stores.
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { backup } from 'node:sqlite';
import { hashText, readText, writeTextAtomic } from '../core/workspace/files.js';
import {
  redactProviderHeaders,
  headerReference,
  redactProviderToolArgs,
  redactProviderToolResult,
} from './export/sanitize.js';
import { storeProviderHeaders } from './providers.js';
import { migrateProviderSessions } from './provider-session-migration.js';

function withoutHeaders(value) {
  return JSON.stringify({
    ...value,
    providers: (value.providers ?? []).map((entry) => {
      const provider = { ...entry };
      delete provider.headers;
      return provider;
    }),
  });
}

function toolChanges(row) {
  try {
    const args = JSON.parse(String(row.args_json));
    const result = row.result_json == null ? null : JSON.parse(String(row.result_json));
    const nextArgs = redactProviderToolArgs(String(row.name), args);
    const nextResult = redactProviderToolResult(String(row.name), args, result);
    if (nextArgs === args && nextResult === result) return null;
    return {
      row,
      args: nextArgs === args ? row.args_json : JSON.stringify(nextArgs),
      result: nextResult === result ? row.result_json : JSON.stringify(nextResult),
    };
  } catch {
    // A corrupt receipt is not evidence of a provider configuration.
    return null;
  }
}

function eventChanges(row) {
  try {
    const event = JSON.parse(String(row.payload_json));
    const args = redactProviderToolArgs(event.name, event.args);
    const result = redactProviderToolResult(event.name, event.args, event.result);
    if (args === event.args && result === event.result) return null;
    return {
      row,
      text: JSON.stringify({
        ...event,
        args,
        ...(Object.hasOwn(event, 'result') ? { result } : {}),
      }),
    };
  } catch {
    return null;
  }
}

// Startup callers do not need the return value. Keep a non-sensitive receipt
// so interrupted or partially parseable historical sessions remain visible.
async function recordMigration(paths, result) {
  if (result.changed || result.runtime.errors || result.runtime.skippedFiles) {
    await mkdir(paths.logs, { recursive: true });
    const receipt = {
      time: new Date().toISOString(),
      rows: result.rows,
      backup: result.backup == null ? null : path.relative(paths.root, result.backup),
      runtime: {
        ...result.runtime,
        backupFolders: result.runtime.backupFolders.map((folder) =>
          path.relative(paths.root, folder),
        ),
      },
    };
    await appendFile(
      path.join(paths.logs, 'provider-header-migration.log'),
      `${JSON.stringify(receipt)}\n`,
      'utf8',
    );
  }
  return result;
}

/**
 * Move live values and redact only settings' historical provider headers.
 * Backups intentionally retain the pre-migration database for recovery.
 * @param {import('../core/index.js').Core} core
 * @returns {Promise<{changed:boolean,backup:string|null,rows:Record<string,number>,
 *   runtime:Awaited<ReturnType<typeof migrateProviderSessions>>}>}
 */
export async function migrateProviderHeaders(core) {
  const { db, paths } = core;
  const text = await readText(paths.settings);
  const current = text == null ? null : JSON.parse(text);
  const hasPlaintext = (current?.providers ?? []).some((provider) =>
    Object.values(provider.headers ?? {}).some((value) => !headerReference(value)),
  );
  const revisions = db
    .prepare(
      "SELECT rowid,before_text,after_text FROM revisions WHERE resource='settings' ORDER BY rowid",
    )
    .all()
    .map((row) => {
      const before = redactProviderHeaders(row.before_text).value;
      const after = redactProviderHeaders(row.after_text).value;
      return { row, before, after };
    });
  const snapshots = db
    .prepare("SELECT rowid,content_text FROM resource_snapshots WHERE resource='settings'")
    .all()
    .map((row) => ({ row, text: redactProviderHeaders(row.content_text).value }));
  const tools = db
    .prepare("SELECT rowid,name,args_json,result_json FROM tool_calls WHERE name='workspace_edit'")
    .all()
    .map(toolChanges)
    .filter(Boolean);
  const events = db
    .prepare(
      "SELECT seq,payload_json FROM events WHERE type IN ('tool.started','tool.updated','tool.ended')",
    )
    .all()
    .map(eventChanges)
    .filter(Boolean);
  const rows = { revisions: 0, resource_snapshots: 0, tool_calls: 0, events: 0 };
  if (
    !hasPlaintext &&
    !revisions.some(
      ({ row, before, after }) => before !== row.before_text || after !== row.after_text,
    ) &&
    !snapshots.some(({ row, text: value }) => value !== row.content_text) &&
    !tools.length &&
    !events.length
  ) {
    const runtime = await migrateProviderSessions(paths);
    return recordMigration(paths, { changed: runtime.files > 0, backup: null, rows, runtime });
  }

  await mkdir(paths.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(paths.backups, `provider-headers-${stamp}.sqlite`);
  await backup(db.raw, backupFile);
  let updatedText = text;
  if (hasPlaintext) {
    const providers = await storeProviderHeaders(paths, current.providers);
    updatedText = `${JSON.stringify({ ...current, providers }, null, 2)}\n`;
    await writeTextAtomic(paths.settings, updatedText);
  }
  // Keep the latest revision's projection aligned with the migrated file. This
  // also recovers a crash after the atomic file replacement but before COMMIT,
  // without inventing a new external edit or adding a history row.
  const latest = revisions.at(-1);
  if (latest && updatedText != null && latest.row.after_text != null) {
    try {
      if (
        withoutHeaders(JSON.parse(String(latest.row.after_text))) ===
        withoutHeaders(JSON.parse(updatedText))
      )
        latest.after = updatedText;
    } catch {
      // Malformed old snapshots remain readable; only structured headers move.
    }
  }
  db.transaction(() => {
    for (const { row, before, after } of revisions) {
      if (before === row.before_text && after === row.after_text) continue;
      db.prepare('UPDATE revisions SET before_text=?,after_text=?,after_hash=? WHERE rowid=?').run(
        before,
        after,
        hashText(after),
        row.rowid,
      );
      rows.revisions++;
    }
    for (const { row, text: value } of snapshots) {
      if (value === row.content_text) continue;
      db.prepare('UPDATE resource_snapshots SET content_text=?,content_hash=? WHERE rowid=?').run(
        value,
        hashText(value),
        row.rowid,
      );
      rows.resource_snapshots++;
    }
    for (const { row, args, result } of tools) {
      db.prepare('UPDATE tool_calls SET args_json=?,result_json=? WHERE rowid=?').run(
        args,
        result,
        row.rowid,
      );
      rows.tool_calls++;
    }
    for (const { row, text: value } of events) {
      db.prepare('UPDATE events SET payload_json=? WHERE seq=?').run(value, row.seq);
      rows.events++;
    }
  });
  const runtime = await migrateProviderSessions(paths);
  return recordMigration(paths, { changed: true, backup: backupFile, rows, runtime });
}
