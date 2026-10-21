import { AppError } from '../../core/errors.js';
import { LITERATURE_KINDS } from '../research/records.js';
import { createBackgroundRunner } from '../secretary/background.js';
import { cardInput, paragraphHash, verifyCard } from './card-input.js';
import { CARD_INSTRUCTIONS } from './card-prompt.js';
import { CARD_ACTOR_ID, createCardWriter } from './card-writer.js';

export const CARD_KINDS = LITERATURE_KINDS;
// Provisional uncached USD rates from the design's §4.6, to be calibrated in KB-6b.
export const CARD_COST = {
  currency: 'USD',
  inputPerMillion: 0.3,
  outputPerMillion: 1.2,
  inputTokens: 7500,
  outputTokens: 1000,
  uncertainty: 2,
};

function usageOf(usage) {
  const input = [usage?.inputTokens, usage?.cacheReadTokens, usage?.cacheWriteTokens];
  return {
    requests: usage?.requests ?? 1,
    inputTokens: input.some((value) => value != null)
      ? input.reduce((sum, value) => sum + (value ?? 0), 0)
      : null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    unknownRequests: usage?.unknownRequests ?? (usage?.totalTokens == null ? 1 : 0),
    source:
      usage?.totalTokens == null ? 'unreported' : usage?.unknownRequests ? 'partial' : 'reported',
  };
}

/**
 * Disposable, no-tool background turns reuse the existing runtime runner.
 * All model selection is explicit settings fallback, independent of provider names.
 * @param {{core:import('../../core/index.js').Core,research:any,semantic:any,runtime:import('../../runtime/port.js').Runtime,modelCatalog?:any}} deps
 * @returns {any}
 */
export function createPaperCards({ core, research, semantic, runtime, modelCatalog }) {
  const writer = createCardWriter({ core, research, semantic });
  const runner = createBackgroundRunner({
    core,
    runtime,
    modelCatalog,
    participantId: CARD_ACTOR_ID,
    defaultModel: async () => null,
  });
  let closed = false;
  async function start() {
    if (!core.db.prepare('SELECT 1 FROM participants WHERE id=?').get(CARD_ACTOR_ID))
      await core.participants.create({
        id: CARD_ACTOR_ID,
        kind: 'ai',
        name: '论文卡片整理',
        definition: { prompt: '' },
      });
  }
  async function model(settings) {
    const secretary = await core.participants.get('agent_secretary');
    return (
      [
        settings.knowledge.cards.model,
        settings.memory.model,
        secretary.definition?.model,
        settings.models.default,
      ].find((choice) => choice?.provider && choice?.model) ?? null
    );
  }
  function current(job) {
    return (
      !closed &&
      core.db.prepare('SELECT 1 FROM rb_sources WHERE id=?').get(job.source_id) &&
      paragraphHash(research.store.chunks(job.source_id)) === job.content_version
    );
  }
  async function run(job, settings, canRun) {
    const choice = await model(settings);
    if (!choice) return { state: 'skipped', error: 'no-model' };
    const source = research.store.getSource(job.source_id);
    const input = cardInput(source, research.store.chunks(source.id));
    if (!input.paragraphs.length) return { state: 'skipped', error: 'no-text' };
    let meetingId = job.meeting_id;
    if (!meetingId || !core.db.prepare('SELECT 1 FROM meetings WHERE id=?').get(meetingId)) {
      const meeting = core.meetings.create({
        title: source.title,
        temporary: true,
        members: [{ participantId: CARD_ACTOR_ID }],
      });
      meetingId = meeting.id;
      core.db
        .prepare("UPDATE kb_jobs SET meeting_id=? WHERE source_id=? AND layer='card' AND topic=''")
        .run(meetingId, source.id);
    }
    const prepared = await runner.prepare(meetingId, { model: choice });
    if (!canRun() || !current(job)) return { state: 'queued' };
    let response;
    try {
      response = await runner.run(meetingId, CARD_INSTRUCTIONS, JSON.stringify(input), prepared);
      const output = JSON.parse(
        response.text.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, ''),
      );
      if (!output || typeof output !== 'object' || Array.isArray(output))
        throw new AppError('CARD_INVALID_JSON', 'Paper card must be a JSON object.');
      const { card, dropped } = verifyCard(output, input);
      const result = {
        dropped,
        droppedCount: dropped.length,
        usage: usageOf(response.usage),
        selection: input.selection,
        meetingId,
        turnId: response.turnId,
      };
      const entries = await writer.plan(card);
      if (!current(job)) return { state: 'queued', result };
      const saved = writer.save(source, card, entries, { ...response, meetingId });
      return { state: 'done', result: { ...result, ...saved } };
    } catch (error) {
      error.cardResult = {
        usage: usageOf(response?.usage ?? error.usage),
        meetingId,
        turnId: response?.turnId ?? error.turnId ?? null,
        selection: input.selection,
      };
      throw error;
    }
  }
  async function close() {
    closed = true;
    await runner.close();
  }
  return { start, run, model, close };
}
