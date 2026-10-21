// Background work uses disposable runtime sessions. Each invocation records a
// turn and usage, but creates neither a main-thread message nor a session cursor.
import { closeKnowledgeTurn } from '../knowledge/versions.js';
import { AppError } from '../../core/errors.js';
import { createTurnActivity } from '../turn-activity.js';
import { recordedToolResult } from '../../runtime/port.js';
import { createSkills } from '../skills/index.js';

/**
 * @param {{core:import('../../core/index.js').Core,runtime:import('../../runtime/port.js').Runtime,
 * defaultModel:(meeting?:any)=>Promise<import('../../runtime/port.js').ModelChoice|null>,tools?:any,modelCatalog?:any,participantId?:string}} dependencies
 * @returns {{run:(meetingId:string,instructions:string,input:string,prepared?:any)=>Promise<{text:string,turnId:string,usage:any}>,close:()=>Promise<void>,prepare:(meetingId:string,options?:{model?:any})=>Promise<any>}}
 */
export function createBackgroundRunner({
  core,
  runtime,
  defaultModel,
  tools,
  modelCatalog,
  participantId = 'agent_secretary',
}) {
  const skills = createSkills(core);
  const sessions = new Set();
  let closed = false;

  /**
   * @param {string} meetingId
   * @param {{model?:any}} [options]
   * @returns {Promise<any>}
   */
  async function prepare(meetingId, { model: override } = {}) {
    const meeting = core.meetings.get(meetingId);
    const secretary = await core.participants.get(participantId);
    const main = await core.participants.get(meeting.policy.respondent ?? 'agent_main');
    const choices = [
      override,
      secretary.definition?.model,
      meeting.policy.model,
      main.definition?.model,
    ];
    const model = choices.find((choice) => choice?.model) ?? (await defaultModel(meeting));
    if (!model?.provider || !model?.model)
      throw new AppError('MODEL_REQUIRED', '请先选择秘书或会议使用的模型。');
    const settings = (await core.workspace.read({ resource: 'settings', key: 'app' })).value;
    const provider = settings.providers.find((candidate) => candidate.id === model.provider);
    const descriptor = modelCatalog
      ? await modelCatalog.descriptor(model)
      : provider?.models?.find((candidate) => candidate.id === model.model);
    return {
      meeting,
      model,
      // Summary/memory turns keep their existing no-tool contract; only bound
      // skills are preloaded. Tool-enabled version notes also get the catalog.
      prompt:
        (secretary.definition?.prompt ?? '') +
        (await skills.prompt(secretary.definition?.skills, { catalog: Boolean(tools) })),
      contextWindow:
        descriptor?.contextWindow ??
        (modelCatalog ? null : /** @type {any} */ (model).contextWindow) ??
        null,
      outputTokens:
        descriptor?.maxTokens ?? (modelCatalog ? 0 : /** @type {any} */ (model).maxTokens) ?? 0,
    };
  }
  /**
   * @param {string} meetingId
   * @param {string} instructions
   * @param {string} input
   * @param {any} [selection]
   * @returns {Promise<{text:string,turnId:string,usage:any}>}
   */
  async function run(meetingId, instructions, input, selection) {
    const prepared = selection ?? (await prepare(meetingId));
    const { meeting, model } = prepared;
    const project = meeting.projectId ? core.projects.get(meeting.projectId) : null;
    const turn = core.turns.start({ meetingId, participantId });
    const activity = createTurnActivity(core, turn.id);
    let sessionId;
    let result;
    let text = '';
    try {
      if (closed) throw new AppError('MINUTES_CLOSED', '纪要服务已关闭。', 409);
      await tools?.ready?.();
      sessionId = await runtime.startSession({
        model: /** @type {import('../../runtime/port.js').ModelChoice} */ (model),
        workFolder:
          meeting.workFolder ?? project?.folder ?? core.workspace.locate.meetingBase(meetingId),
        instructions: `${prepared.prompt}\n\n${instructions}`,
        tools: tools?.specs ?? [],
        noTools: !tools,
        onToolCall: async (call) => {
          if (!tools) throw new AppError('NO_SUMMARY_TOOLS', '此轮只整理已提供的会议原文。');
          core.turns.startToolCall({ turnId: turn.id, ...call });
          try {
            const value = await tools.run(call.name, call.args, {
              participantId,
              meetingId,
              turnId: turn.id,
              callId: call.callId,
              signal: call.signal,
            });
            // Images go to the model only; the record keeps the preview path.
            core.turns.endToolCall(turn.id, call.callId, {
              result: recordedToolResult(value),
              isError: false,
            });
            return value;
          } catch (error) {
            core.turns.endToolCall(turn.id, call.callId, {
              result: { error: error.message },
              isError: true,
            });
            throw error;
          }
        },
      });
      sessions.add(sessionId);
      if (closed) {
        await runtime.interrupt(sessionId);
        throw new AppError('MINUTES_CLOSED', '纪要服务已关闭。', 409);
      }
      result = await runtime.send(sessionId, input, (event) => {
        if (activity.onEvent(event)) return;
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
      return { text: text.trim(), turnId: turn.id, usage: result.usage ?? null };
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
      error.usage = result?.usage ?? null;
      error.turnId = turn.id;
      throw error;
    } finally {
      activity.finish();
      if (tools) {
        core.workspace.captureTurnSnapshots(turn.id);
        closeKnowledgeTurn(core, turn.id);
      }
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
