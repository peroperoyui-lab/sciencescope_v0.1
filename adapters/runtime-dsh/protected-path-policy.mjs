import { randomUUID } from 'node:crypto';
import { FsError } from '@deepseek-ai/dsh-fs';
import { createProtectedPathPolicy, PROTECTED_PATH_MESSAGE } from './protected-paths.mjs';

export const name = 'sciencescope-protected-path-policy';
export const inject = ['fs'];

export function apply(ctx, config = {}) {
  const policy = createProtectedPathPolicy({ protectedPaths: config.protectedPaths ?? [],
    resolvePath: async (value, cwd) => ctx.fs.processPath(await ctx.fs.resolve(value, { cwd })) });
  ctx.on('tools/execute', async (exec, next) => {
    const args = exec.arguments ?? {}; const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
    let targets = [];
    if (['read', 'write', 'edit', 'read_image'].includes(exec.name)) targets = typeof args.file_path === 'string' ? [args.file_path] : [];
    if (exec.name === 'str_replace_editor') targets = typeof args.path === 'string' ? [args.path] : [];
    if (['glob', 'grep'].includes(exec.name)) targets = [typeof args.path === 'string' ? args.path : cwd];
    if (exec.name === 'present') targets = Array.isArray(args.files) ? args.files.map(file => file?.path).filter(value => typeof value === 'string') : [];
    for (const value of targets) {
      const match = await policy.inspectPath(value, { cwd, recursive: ['glob', 'grep'].includes(exec.name) });
      if (match.protected) throw new FsError(PROTECTED_PATH_MESSAGE, 'FS_PERMISSION_DENIED');
    }
    if (!['bash', 'pwsh', 'run_code'].includes(exec.name)) return next();
    const command = exec.name === 'run_code' ? args.code : args.command;
    const match = await policy.inspectShell({ command, workdir: args.workdir, cwd });
    if (!match.protected) return next();
    if (!exec.agent?.session) throw new FsError(PROTECTED_PATH_MESSAGE, 'FS_PERMISSION_DENIED');
    const id = randomUUID();
    const reason = '涉及应用内部数据：此命令需要单独确认。';
    exec.agent.session.append('approval/asked', { id, toolName: exec.name, callId: String(exec.callId), reason });
    let outcome = 'rejected';
    try {
      const decision = await ctx.bail('sciencescope/protected-approval', exec, {
        toolName: exec.name, commandSummary: String(command ?? '').slice(0, 4000), callId: String(exec.callId),
        auditId: id, classification: 'protected-path', targetPaths: match.targetPaths, reason,
      });
      outcome = exec.signal.aborted ? 'cancelled' : decision?.allowed === true ? 'allowed-once' : 'rejected';
    } finally {
      if (exec.signal.aborted) outcome = 'cancelled';
      exec.agent.session.append('approval/decided', { id, outcome });
    }
    if (outcome !== 'allowed-once') throw new FsError('涉及应用内部数据的命令未获批准；没有执行。', 'FS_PERMISSION_DENIED');
    return next();
  });
}

export default { name, inject, apply };
