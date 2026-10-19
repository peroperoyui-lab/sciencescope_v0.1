// Approval belongs to the host tool boundary, shared by every runtime and role.
// Pending work is never replayed after restart; only a live request can execute.
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { AppError } from '../core/errors.js';
import { filePath } from './builtin-tools/files.js';
import { toolWorkFolder } from './builtin-tools/index.js';

const cancelled = { cancelled: true, message: '操作已取消' };
const rejected = { rejected: true, message: '用户拒绝了这次操作' };

/**
 * @param {import('../core/index.js').Core} core
 */
export function createApprovals(core) {
  /** @type {Map<string, {row:any, finish:(status:string)=>any}>} */
  const pending = new Map();
  let closed = false;

  // A crash can leave persisted cards without a live promise. Close those cards
  // before exposing the server; conductor recovery closes their turns as well.
  for (const row of core.db
    .prepare("SELECT turn_id,call_id FROM tool_calls WHERE kind='approval' AND status='pending'")
    .all())
    core.turns.endToolCall(String(row.turn_id), String(row.call_id), {
      result: cancelled,
      isError: false,
      status: 'cancelled',
    });

  const unsubscribe = core.events.subscribe((event) => {
    if (event.type === 'turn.ended') {
      for (const entry of pending.values())
        if (entry.row.turnId === event.payload.id) entry.finish('cancelled');
    }
  });

  async function summaryFor(tool, args, context) {
    const meeting = core.meetings.get(context.meetingId);
    if (meeting.policy.approval === 'auto') return null;
    if (tool === 'shell') return String(args.command ?? '');
    if (tool === 'python_env_install') return JSON.stringify(args.packages ?? []);
    if (!['write_file', 'edit_file'].includes(tool)) return null;
    const target = await filePath(toolWorkFolder(core, context), args.path, core.paths.secret);
    const relative = path.relative(await realpath(core.paths.root), target);
    if (
      !relative ||
      (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
    )
      return null;
    const lines = (text) => String(text ?? '').split(/\r?\n/).length;
    return tool === 'edit_file'
      ? `${target}\n-${lines(args.oldText)} / +${lines(args.newText)} lines`
      : target;
  }

  /**
   * Null authorizes execution; rejection/cancellation is a normal tool result.
   * @param {string} tool
   * @param {any} args
   * @param {import('./tools.js').ToolContext} context
   */
  async function request(tool, args, context) {
    if (closed || context.signal?.aborted) return cancelled;
    const summary = await summaryFor(tool, args ?? {}, context);
    if (closed || context.signal?.aborted) return cancelled;
    if (summary === null) return null;
    const turn = core.turns.get(context.turnId);
    if (turn.status !== 'running') return cancelled;
    return new Promise((resolve) => {
      core.db.transaction(() => {
        const row = core.turns.startToolCall({
          turnId: turn.id,
          callId: `approval:${randomUUID()}`,
          name: tool,
          kind: 'approval',
          status: 'pending',
          args: { tool, summary },
        });
        const abort = () => finish('cancelled');
        function finish(status) {
          if (!pending.delete(row.id)) return;
          context.signal?.removeEventListener('abort', abort);
          const result =
            status === 'approved' ? null : status === 'rejected' ? rejected : cancelled;
          const ended = core.turns.endToolCall(turn.id, row.callId, {
            result,
            isError: false,
            status,
          });
          if (
            core.turns.get(turn.id).status === 'running' &&
            ![...pending.values()].some((item) => item.row.turnId === turn.id)
          )
            core.turns.setPhase(turn.id, 'tool');
          resolve(result);
          return ended;
        }
        pending.set(row.id, { row, finish });
        context.signal?.addEventListener('abort', abort, { once: true });
        core.turns.setPhase(turn.id, 'waiting-approval');
      });
    });
  }

  function decide(turnId, activityId, decision) {
    if (!['approve', 'reject'].includes(decision))
      throw new AppError('INVALID_DECISION', 'decision must be approve or reject.');
    const row = core.turns
      .toolCalls(turnId)
      .find((item) => item.id === activityId && item.kind === 'approval');
    if (!row) throw new AppError('APPROVAL_NOT_FOUND', '找不到这次批准请求。', 404);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    if (row.status === status) return row;
    const entry = pending.get(activityId);
    if (!entry) throw new AppError('APPROVAL_ENDED', '这次批准请求已结束。', 409);
    return entry.finish(status);
  }

  function close() {
    closed = true;
    unsubscribe();
    for (const entry of pending.values()) entry.finish('cancelled');
  }
  return { request, decide, close };
}
