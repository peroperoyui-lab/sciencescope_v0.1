import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, symlink, writeFile, realpath } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProtectedPathPolicy, canonicalPath, normalizePathSpelling } from '../adapters/runtime-dsh/protected-paths.mjs';
import { apply } from '../adapters/runtime-dsh/protected-path-policy.mjs';

test('protected paths normalize Windows case, traversal, namespace, localhost UNC, streams and sibling boundaries', async () => {
  const policy = createProtectedPathPolicy({ protectedPaths: ['C:\\App\\.sciencescope-local\\state'], platform: 'win32', env: {} });
  for (const value of ['c:/APP/.sciencescope-local/state/db', 'C:\\App\\folder\\..\\.sciencescope-local\\state\\db',
    '\\\\?\\C:\\App\\.sciencescope-local\\state\\db', '\\\\localhost\\C$\\App\\.sciencescope-local\\state\\db',
    'C:\\App\\.sciencescope-local\\state.\\db', 'C:\\App\\.sciencescope-local\\state\\db:stream']) {
    assert.equal((await policy.inspectPath(value)).protected, true, value);
  }
  assert.equal((await policy.inspectPath('C:\\App\\.sciencescope-local\\state2\\paper')).protected, false);
  assert.equal((await policy.inspectPath('C:\\App', { recursive: true })).protected, true);
  assert.equal((await policy.inspectPath('C:\\App\\paper.txt')).protected, false);
  assert.equal(normalizePathSpelling('\\\\?\\UNC\\server\\share\\path', { platform: 'win32' }), '\\\\server\\share\\path');
});

test('protected paths resolve links and absent descendants under linked ancestors', async () => {
  const base = path.resolve('.sciencescope-local/temp'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'protected-paths-'));
  try {
    const protectedRoot = path.join(root, 'private'); await mkdir(protectedRoot);
    await writeFile(path.join(protectedRoot, 'key.txt'), 'LOCAL_FIXTURE');
    const alias = path.join(root, 'alias'); await symlink(protectedRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const policy = createProtectedPathPolicy({ protectedPaths: [protectedRoot] });
    assert.equal((await policy.inspectPath(path.join(alias, 'key.txt'))).protected, true);
    assert.equal((await policy.inspectPath(path.join(alias, 'missing/new.txt'))).protected, true);
    assert.equal(await canonicalPath(alias), await realpath(protectedRoot));
    if (process.platform === 'win32') {
      const { stdout } = await promisify(execFile)(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe'),
        ['/d', '/c', 'for %I in (key.txt) do @echo %~sI'], { cwd: protectedRoot, windowsHide: true });
      const short = stdout.trim(); assert.ok(short);
      assert.equal((await policy.inspectPath(short)).protected, true, `native Windows short-file spelling resolves to the protected target: ${short}`);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('shell commands recognize protected paths and common variable expansions, without blocking routine research commands', async () => {
  const env = { HOME: 'C:\\App', USERPROFILE: 'C:\\App', LOCALAPPDATA: 'C:\\App', DATA_ROOT: 'C:\\App' };
  const policy = createProtectedPathPolicy({ protectedPaths: ['C:\\App\\.sciencescope-local\\state'], platform: 'win32', env });
  const matched = [
    'Get-Content C:\\App\\.sciencescope-local\\state\\db', 'type C:/App/.sciencescope-local/state/db',
    'cat "$HOME/.sciencescope-local/state/db"', 'Get-Content "$env:LOCALAPPDATA/.sciencescope-local/state/db"',
    'type %LOCALAPPDATA%\\.sciencescope-local\\state\\db', 'cat ~/.sciencescope-local/state/db',
    'cat ${DATA_ROOT}/.sciencescope-local/state/db', 'Get-Content ${env:USERPROFILE}/.sciencescope-local/state/db',
    'python -c "open(\'C:/App/.sciencescope-local/state/db\').read()"',
    'Get-Content ..\\.sciencescope-local\\state\\db',
    'type \\\\localhost\\C$\\App\\.sciencescope-local\\state\\db',
    'Get-Content C:/App/.sciencescope`-local/state/db',
    'pwsh -EncodedCommand ' + Buffer.from('Get-Content C:\\App\\.sciencescope-local\\state\\db', 'utf16le').toString('base64'),
  ];
  for (const command of matched) assert.equal((await policy.inspectShell({ command, cwd: 'C:\\App\\research' })).protected, true, command);
  const clean = ['Get-Content paper.md', 'type methods.txt', 'cat notes.md', 'Get-ChildItem .', 'python analysis.py',
    'Rscript plot.R', 'git status', 'curl https://example.org/paper', 'Invoke-WebRequest https://example.org',
    'Get-Content C:\\App\\.sciencescope-local\\state2\\paper', 'echo no secret', 'cat "$HOME/research/paper.md"'];
  for (const command of clean) assert.equal((await policy.inspectShell({ command, cwd: 'C:\\App\\research' })).protected, false, command);
  assert.equal((await policy.inspectShell({ command: 'Get-ChildItem .', workdir: 'C:\\App\\.sciencescope-local\\state' })).protected, true);
  assert.equal((await policy.inspectShell({ command: 'Get-Content state', cwd: 'C:\\App\\.sciencescope-local' })).protected, true, 'bare protected directory argument is inspected');
});

test('tool guard denies built-in file operations, recursive parent search and presentation; leaves normal files accessible', async () => {
  const callbacks = new Map(); const paths = path.win32;
  const ctx = { fs: { resolve: async (value, { cwd }) => ({ path: paths.resolve(cwd, value) }), processPath: target => target.path },
    on: (name, callback) => callbacks.set(name, callback), bail: async () => undefined };
  // Use actual host platform paths for this adapter fixture.
  const protectedRoot = path.resolve('.sciencescope-local/temp/policy-private');
  ctx.fs.resolve = async (value, { cwd }) => ({ path: path.resolve(cwd, value) });
  apply(ctx, { protectedPaths: [protectedRoot] });
  const run = callbacks.get('tools/execute'); const cwd = path.dirname(protectedRoot);
  const agent = { session: { header: { cwd } } }; const signal = new AbortController().signal;
  const calls = [
    ...['read', 'write', 'edit', 'read_image'].map(name => ({ name, arguments: { file_path: path.join(protectedRoot, 'file') } })),
    { name: 'str_replace_editor', arguments: { path: protectedRoot } },
    { name: 'grep', arguments: { path: cwd, pattern: '.' } }, { name: 'glob', arguments: { path: protectedRoot, pattern: '**' } },
    { name: 'present', arguments: { files: [{ path: path.join(protectedRoot, 'file') }] } },
  ];
  let dispatched = 0;
  for (const call of calls) await assert.rejects(run({ ...call, agent, signal }, async () => { dispatched++; }), error => error.code === 'FS_PERMISSION_DENIED');
  assert.equal(dispatched, 0);
  await run({ name: 'read', arguments: { file_path: path.join(cwd, 'paper') }, agent, signal }, async () => { dispatched++; });
  assert.equal(dispatched, 1);
});

test('mandatory shell approval rejects without executing and logs a paired durable decision even under full mode', async () => {
  const callbacks = new Map(), events = []; const cwd = path.resolve('.sciencescope-local/temp');
  const protectedRoot = path.join(cwd, 'private'); let approvals = 0, dispatched = 0;
  const ctx = { fs: { resolve: async (value, options) => ({ path: path.resolve(options.cwd, value) }), processPath: target => target.path },
    on: (name, callback) => callbacks.set(name, callback), bail: async (name, exec, args) => {
      approvals++; assert.equal(name, 'sciencescope/protected-approval'); assert.equal(args.classification, 'protected-path'); return { allowed: false };
    } };
  apply(ctx, { protectedPaths: [protectedRoot] });
  const agent = { session: { header: { cwd }, append: (type, data) => events.push({ type, data }) } };
  await assert.rejects(callbacks.get('tools/execute')({ name: 'pwsh', arguments: { command: `Get-Content '${protectedRoot}/db'` },
    callId: 'private-call', signal: new AbortController().signal, agent }, async () => { dispatched++; }), /未获批准/u);
  assert.equal(approvals, 1); assert.equal(dispatched, 0);
  assert.deepEqual(events.map(event => event.type), ['approval/asked', 'approval/decided']);
  assert.equal(events[1].data.outcome, 'rejected'); assert.equal(events[1].data.id, events[0].data.id);
  await assert.rejects(callbacks.get('tools/execute')({ name: 'run_code', arguments: { code: `require('node:fs').readFileSync('${protectedRoot.replaceAll('\\', '/')}')` },
    callId: 'protected-code', signal: new AbortController().signal, agent }, async () => { dispatched++; }), /未获批准/u);
  await callbacks.get('tools/execute')({ name: 'run_code', arguments: { code: 'return 1 + 1;' },
    callId: 'research-code', signal: new AbortController().signal, agent }, async () => { dispatched++; });
  assert.equal(approvals, 2); assert.equal(dispatched, 1);
});
