import { AppError } from '../../core/errors.js';
import { newId } from '../../core/ids.js';
import { hash } from './store.js';

const SUBTYPES = [
  'goal',
  'decision',
  'convention',
  'preference',
  'open-question',
  'lesson',
  'episode',
  'profile',
];

/**
 * @param {any} raw
 * @param {any} checkpoint
 * @param {any[]} page
 * @param {any} sources
 * @returns {any[]}
 */
export function extractCandidates(raw, checkpoint, page, sources) {
  if (!Array.isArray(raw.candidates))
    throw new AppError('MEMORY_INVALID_JSON', '记忆候选格式无效。', 502);
  return raw.candidates.map((candidate) => {
    if (
      !SUBTYPES.includes(candidate.subtype) ||
      typeof candidate.title !== 'string' ||
      !candidate.title.trim() ||
      typeof candidate.body !== 'string' ||
      !candidate.body.trim() ||
      !Array.isArray(candidate.evidence) ||
      !candidate.evidence.length
    )
      throw new AppError('MEMORY_INVALID_CANDIDATE', '记忆候选缺少内容或来源。', 502);
    const evidence = candidate.evidence.map((proof) => {
      if (typeof proof.quote !== 'string' || !proof.quote.trim())
        throw new AppError('MEMORY_INVALID_EVIDENCE', '记忆候选缺少原文引用。', 502);
      const source = page.find(
        (part) =>
          part.id === (proof.messageId ?? proof.minutesRevision) && part.text.includes(proof.quote),
      );
      if (!source || (proof.minutesRevision && checkpoint.input.delta.authorId !== 'person_user'))
        throw new AppError('MEMORY_INVALID_EVIDENCE', '记忆引用与对应原文不匹配。', 502);
      return {
        meetingId: checkpoint.input.meetingId,
        ...(source.kind === 'message' ? { messageId: source.id, seq: source.seq } : {}),
        minutesRevision: checkpoint.input.minutesRevision,
        quote: proof.quote,
        ...(source.offset !== undefined ? { offset: source.offset, end: source.end } : {}),
      };
    });
    const trust = sources.trust(checkpoint.input.meetingId, evidence);
    if (evidence.some((proof) => !proof.messageId)) {
      // A minutes correction inherits source classification from its corresponding
      // raw range. Those messages are locators, never invented quoted evidence.
      const corresponding = sources.trust(
        checkpoint.input.meetingId,
        checkpoint.input.messages.map((message) => ({ messageId: message.id })),
      );
      if (corresponding.originTrust === 'external') trust.originTrust = 'external';
      trust.sourceRefs = [
        ...new Map(
          [...trust.sourceRefs, ...corresponding.sourceRefs].map((reference) => [
            JSON.stringify(reference),
            reference,
          ]),
        ).values(),
      ];
    }
    return {
      subtype: candidate.subtype,
      title: candidate.title,
      body: candidate.body,
      evidence,
      ...trust,
      candidateHash: hash([
        candidate.subtype,
        candidate.title,
        candidate.body,
        evidence.map((proof) => [proof.messageId ?? proof.minutesRevision, proof.quote]),
      ]),
    };
  });
}

/**
 * @param {any} raw
 * @param {any[]} active
 * @returns {any}
 */
export function verification(raw, active) {
  const value = raw.decisions?.[0];
  if (
    !Array.isArray(raw.decisions) ||
    raw.decisions.length !== 1 ||
    value.candidateIndex !== 0 ||
    typeof value.supported !== 'boolean' ||
    typeof value.rationale !== 'string' ||
    (value.duplicateOf != null && !active.some((item) => item.id === value.duplicateOf))
  )
    throw new AppError('MEMORY_INVALID_VERIFICATION', '记忆核对结果无效。', 502);
  return value;
}

/**
 * @param {any} context
 * @param {any} candidate
 * @param {string} turnId
 * @returns {any}
 */
export function saveCandidate({ core, items, checkpoint }, candidate, turnId) {
  const meetingId = checkpoint.input.meetingId;
  const duplicate = core.db
    .prepare('SELECT item_id FROM memory_dedup WHERE meeting_id = ? AND candidate_hash = ?')
    .get(meetingId, candidate.candidateHash);
  if (duplicate) return null;
  const projectId = core.meetings.get(meetingId).projectId;
  const item = items.create(
    {
      id: newId('itm'),
      projectId,
      type: 'memory',
      subtype: candidate.subtype,
      scope: 'project',
      title: candidate.title,
      body: candidate.body,
      status: 'proposed',
      visibility: 'shared',
      payload: {
        evidence: candidate.evidence,
        originTrust: candidate.originTrust,
        sourceRefs: candidate.sourceRefs,
      },
      origin: {
        role: 'consolidator',
        meetingId,
        minutesRevision: checkpoint.input.minutesRevision,
        throughSeq: checkpoint.input.throughSeq,
      },
    },
    { actorId: 'agent_secretary', meetingId, turnId },
  );
  core.db
    .prepare('INSERT INTO memory_dedup (meeting_id, candidate_hash, item_id) VALUES (?, ?, ?)')
    .run(meetingId, candidate.candidateHash, item.id);
  return item;
}
