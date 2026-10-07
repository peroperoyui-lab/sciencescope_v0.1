// Background work uses disposable runtime sessions. Each invocation records a
// turn and usage, but creates neither a main-thread message nor a session cursor.
import { AppError } from '../../core/errors.js';

/**
 * @param {{core:import('../../core/index.js').Core,runtime:import('../../runtime/port.js').Runtime,
 * defaultModel:(meeting?:any)=>Promise<import('../../runtime/port.js').ModelChoice|null>}} dependencies
 * @returns {{run:(meetingId:string,instructions:string,input:string,prepared?:any)=>Promise<{text:string,turnId:string}>,close:()=>Promise<void>,prepare:(meetingId:string)=>Promise<any>}}
 */
export function createBackgroundRunner({ core, runtime, defaultModel }) {
  const sessions = new Set();
  let closed = false;

  /**
   * @param {string} meetingId
   * @returns {Promise<any>}
   */
  async function prepare(meetingId) {
    const meeting = core.meetings.get(meetingId);
    const secretary = await core.participants.get('agent_secretary');
    const main = await core.participants.get(meeting.policy.respondent ?? 'agent_main');
    const model = secretary.definition?.model?.model
      ? secretary.definition.model
      : main.definition?.model?.model
        ? main.definition.model
        : await defaultModel(meeting);
    if (!model?.provider || !model?.model)
      throw new AppError('MODEL_REQUIRED', '请先选择秘书或会议使用的模型。');
    const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
    const provider = settings.providers.find((candidate) => candidate.id === model.provider);
    const descriptor = provider?.models?.find((candidate) => candidate.id === model.model);
    return {
      meeting,
      model,
      prompt: secretary.definition?.prompt ?? '',
      contextWindow: descriptor?.contextWindow ?? /** @type {any} */ (model).contextWindow ?? null,
      outputTokens: /** @type {any} */ (model).maxTokens ?? descriptor?.maxTokens ?? 0,
    };
  }
  /**
   * @param {string} meetingId
   * @param {string} instructions
   * @param {string} input
   * @param {any} [selection]
   * @returns {Promise<{text:string,turnId:string}>}
   */
  async function run(meetingId, instructions, input, selection) {
    const prepared = selection ?? (await prepare(meetingId));
    const { meeting, model } = prepared;
    const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
    const turn = core.turns.start({ meetingId, participantId: 'agent_secretary' });
    let sessionId;
    let result;
    let text = '';
    try {
      if (closed) throw new AppError('MINUTES_CLOSED', '纪要服务已关闭。', 409);
      sessionId = await runtime.startSession({
        model: /** @type {import('../../runtime/port.js').ModelChoice} */ (model),
        workFolder:
          meeting.workFolder ?? project?.folder ?? core.workspace.locate.meetingBase(meetingId),
        instructions: `${prepared.prompt}\n\n${instructions}`,
        tools: [],
        noTools: true,
        onToolCall: async () => {
          throw new AppError('NO_SUMMARY_TOOLS', '此轮只整理已提供的会议原文。');
        },
      });
      sessions.add(sessionId);
      if (closed) {
        await runtime.interrupt(sessionId);
        throw new AppError('MINUTES_CLOSED', '纪要服务已关闭。', 409);
      }
      result = await runtime.send(sessionId, input, (event) => {
        if (event.type === 'attempt-start' || event.type === 'attempt-discarded') text = '';
        if (event.type === 'text-delta') text += event.delta;
        if (event.type === 'step-end') text = event.text;
      });
      if (closed || result.stopReason === 'cancelled')
        throw new AppError('MINUTES_CANCELLED', '纪要更新已停止。', 409);
      if (result.stopReason !== 'completed')
        throw new AppError(
          result.stopReason === 'max_tokens' ? 'MINUTES_INCOMPLETE' : 'MINUTES_FAILED',
          result.error ??
            (result.stopReason === 'max_tokens'
              ? '秘书输出未完成，请调整模型输出设置后再次更新。'
              : '纪要更新失败。'),
          502,
        );
      if (!text.trim()) throw new AppError('EMPTY_MINUTES', '秘书没有返回纪要内容。', 502);
      core.turns.end(turn.id, {
        status: 'done',
        stopReason: result.stopReason,
        usage: result.usage,
      });
      return { text: text.trim(), turnId: turn.id };
    } catch (error) {
      const status =
        closed || result?.stopReason === 'cancelled'
          ? 'cancelled'
          : result?.stopReason === 'max_tokens'
            ? 'max_tokens'
            : 'failed';
      core.turns.end(turn.id, {
        status,
        stopReason: result?.stopReason ?? 'error',
        usage: result?.usage ?? null,
      });
      error.incompleteOutput = text;
      throw error;
    } finally {
      if (sessionId) {
        sessions.delete(sessionId);
        await runtime.release(sessionId).catch(() => {});
      }
    }
  }

  async function close() {
    closed = true;
    await Promise.allSettled([...sessions].map((sessionId) => runtime.interrupt(sessionId)));
  }

  return { run, close, prepare };
}
