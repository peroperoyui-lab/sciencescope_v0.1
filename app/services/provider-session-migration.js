// pi sessions are schema-1 JSON records, not the request log's JSONL format.
// JSON.parse confirms the record and exact tool paths first. Replacing only
// their string tokens preserves every other byte, including line endings.
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renameWithRetry } from '../core/rename.js';
import { REMOVED_VALUE } from './export/sanitize.js';

function addHeaders(targets, providers, prefix) {
  if (!Array.isArray(providers)) return;
  for (const [providerIndex, provider] of providers.entries()) {
    for (const [name, value] of Object.entries(provider?.headers ?? {})) {
      if (typeof value !== 'string' || value === REMOVED_VALUE) continue;
      targets.set(JSON.stringify([...prefix, providerIndex, 'headers', name]), {
        value: REMOVED_VALUE,
        values: 1,
      });
    }
  }
}

function headerPaths(record) {
  const result = new Map();
  const unparsed = new Set();
  const calls = new Map();
  if (record?.schema !== 1 || !Array.isArray(record.messages)) return { targets: result, unparsed };
  for (const [messageIndex, message] of record.messages.entries()) {
    if (message?.role === 'toolResult') {
      const call = calls.get(message.toolCallId);
      if (!call || (message.toolName != null && message.toolName !== 'workspace_edit')) continue;
      addHeaders(result, message.details?.value?.providers, [
        'messages',
        messageIndex,
        'details',
        'value',
        'providers',
      ]);
      for (const [index, block] of (Array.isArray(message.content)
        ? message.content
        : []
      ).entries()) {
        if (block?.type !== 'text' || typeof block.text !== 'string') continue;
        let parsed;
        try {
          parsed = JSON.parse(block.text);
        } catch {
          unparsed.add(String(message.toolCallId));
          continue;
        }
        const nested = new Map();
        addHeaders(nested, parsed?.value?.providers, ['value', 'providers']);
        if (!nested.size) continue;
        const redacted = redactTokens(block.text, nested);
        result.set(JSON.stringify(['messages', messageIndex, 'content', index, 'text']), {
          value: redacted.text,
          values: redacted.values,
        });
      }
      continue;
    }
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    for (const [blockIndex, block] of message.content.entries()) {
      const args = block?.arguments;
      if (block?.type === 'toolCall' && typeof block.id === 'string') {
        if (block.name === 'workspace_edit' && args?.resource === 'settings')
          calls.set(block.id, true);
        else calls.delete(block.id);
      }
      if (
        block?.type !== 'toolCall' ||
        block.name !== 'workspace_edit' ||
        args?.resource !== 'settings'
      )
        continue;
      const field = args.op === 'patch' ? 'changes' : args.op === 'write' ? 'settings' : null;
      const providers = field && args.args?.[field]?.providers;
      addHeaders(result, providers, [
        'messages',
        messageIndex,
        'content',
        blockIndex,
        'arguments',
        'args',
        field,
        'providers',
      ]);
    }
  }
  return { targets: result, unparsed };
}

function redactTokens(text, targets) {
  const stack = [];
  const replacements = [];
  const valuePath = (frame) =>
    frame ? [...frame.path, frame.array ? frame.index : frame.key] : [];
  const finish = (frame) => {
    if (!frame) return;
    if (frame.array) frame.index++;
    else frame.keyExpected = true;
  };
  // The input has already passed JSON.parse; this walk only tracks container
  // positions, avoiding a second JSON serializer that would change line counts.
  const tokens = /"(?:\\.|[^"\\])*"|[{}[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/gu;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    const parent = stack.at(-1);
    if (token === '{' || token === '[') {
      stack.push({
        path: valuePath(parent),
        array: token === '[',
        index: 0,
        key: '',
        keyExpected: true,
      });
    } else if (token === '}' || token === ']') {
      stack.pop();
      finish(stack.at(-1));
    } else if (token !== ':' && token !== ',') {
      if (parent && !parent.array && parent.keyExpected) {
        parent.key = JSON.parse(token);
        parent.keyExpected = false;
      } else {
        const target = targets.get(JSON.stringify(valuePath(parent)));
        if (token.startsWith('"') && target)
          replacements.push({ start: match.index, end: match.index + token.length, ...target });
        finish(parent);
      }
    }
  }
  let start = 0;
  let output = '';
  let values = 0;
  for (const replacement of replacements) {
    output += text.slice(start, replacement.start) + JSON.stringify(replacement.value);
    start = replacement.end;
    values += replacement.values;
  }
  return { text: output + text.slice(start), values };
}

async function backupOriginal(file, bytes, backups, folders) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const name = `${path.basename(file, '.json')}-${hash}.json`;
  for (const directory of folders) {
    const candidate = path.join(backups, directory, name);
    try {
      const existing = await readFile(candidate);
      if (!existing.equals(bytes))
        throw new Error('A session migration backup does not match its original.');
      return { file: candidate, created: false };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const folder = `provider-header-sessions-${new Date().toISOString().slice(0, 10)}`;
  const directory = path.join(backups, folder);
  await mkdir(directory, { recursive: true });
  if (!folders.includes(folder)) folders.push(folder);
  const destination = path.join(directory, name);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyFile(file, temporary);
    if (!(await readFile(temporary)).equals(bytes))
      throw new Error('The session changed while it was being backed up.');
    await renameWithRetry(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  return { file: destination, created: true };
}

/**
 * Only known pi session records and confirmed workspace_edit header arguments
 * and toolCallId-associated result copies
 * are touched. A content-addressed original backup also survives a retry on a
 * different date without making a second copy of that original.
 * @param {ReturnType<typeof import('../core/paths.js').dataPaths>} paths
 * @param {{replace?:(temporary:string,file:string)=>Promise<void>}} [options]
 * @returns {Promise<{files:number,values:number,errors:number,unparsed:Array<{file:string,toolCallId:string}>,backupsCreated:number,backupFolders:string[],skippedFiles:number}>}
 */
export async function migrateProviderSessions(paths, { replace = renameWithRetry } = {}) {
  const result = {
    files: 0,
    values: 0,
    errors: 0,
    unparsed: [],
    backupsCreated: 0,
    backupFolders: [],
    skippedFiles: 0,
  };
  const folder = path.join(paths.runtime, 'pi', 'sessions');
  const entries = await readdir(folder, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const backupFolders = (
    await readdir(paths.backups).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })
  ).filter((name) => /^provider-header-sessions-\d{4}-\d{2}-\d{2}$/u.test(name));
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(folder, entry.name);
    const original = await readFile(file);
    const text = original.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(original)) {
      result.skippedFiles++;
      continue;
    }
    let record;
    try {
      record = JSON.parse(text);
    } catch {
      result.skippedFiles++;
      continue;
    }
    if (record?.schema !== 1 || !Array.isArray(record.messages)) {
      result.skippedFiles++;
      continue;
    }
    const { targets, unparsed } = headerPaths(record);
    for (const toolCallId of unparsed)
      result.unparsed.push({ file: path.relative(paths.root, file), toolCallId });
    result.errors += unparsed.size;
    if (!targets.size) continue;
    const redacted = redactTokens(text, targets);
    if (!redacted.values) continue;
    const backedUp = await backupOriginal(file, original, paths.backups, backupFolders);
    result.backupsCreated += Number(backedUp.created);
    const backupDirectory = path.dirname(backedUp.file);
    if (!result.backupFolders.includes(backupDirectory)) result.backupFolders.push(backupDirectory);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, redacted.text, 'utf8');
      await replace(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    result.files++;
    result.values += redacted.values;
  }
  return result;
}
