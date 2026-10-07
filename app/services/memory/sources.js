// Source truth remains in revisioned minutes and raw meeting messages. This
// planner reads only each minutes delta and its corresponding original text.
import { AppError } from '../../core/errors.js';
import { estimateTokens, isEligibleMessage } from '../secretary/policy.js';
import { extractCitationLabels } from '../research/citations.js';
import { hash } from './store.js';

/**
 * @param {{core:import('../../core/index.js').Core,minutes:any,research:any}} dependencies
 * @returns {any}
 */
export function createMemorySources({ core, minutes, research }) {
  function plan(meetingId, cursor, prepared, instructions, maximumRowid = Number.MAX_SAFE_INTEGER) {
    const previous = cursor.minutesRevision
      ? core.workspace.getRevision(cursor.minutesRevision)
      : null;
    const previousRow = cursor.minutesRevision
      ? core.db.prepare('SELECT rowid FROM revisions WHERE id = ?').get(cursor.minutesRevision)
      : null;
    const revision = core.db
      .prepare(
        'SELECT * FROM revisions WHERE resource_key = ? AND rowid > ? AND rowid <= ? ORDER BY rowid LIMIT 1',
      )
      .get(`minutes:${meetingId}`, previousRow?.rowid ?? 0, maximumRowid);
    if (!revision) return null;
    const text = String(revision.after_text ?? '');
    const before = String(previous?.after ?? '');
    const oldLines = new Set(before.split('\n'));
    const newLines = new Set(text.split('\n'));
    const delta = {
      added: text.split('\n').filter((line) => line.trim() && !oldLines.has(line)),
      removed: before.split('\n').filter((line) => line.trim() && !newLines.has(line)),
      authorId: revision.actor_id,
      previousRevision: cursor.minutesRevision,
      minutesRevision: String(revision.id),
    };
    const throughSeq = minutes.coverage(meetingId, String(revision.id));
    const oldIds = new Set(previous ? minutes.coveredMessageIds(meetingId, previous.id) : []);
    const newIds = new Set(
      minutes.coveredMessageIds(meetingId, String(revision.id)).filter((id) => !oldIds.has(id)),
    );
    const referenced = new Set();
    for (const line of [...delta.added, ...delta.removed]) {
      for (const match of line.matchAll(/#(\d+)(?:\s*[–—-]\s*#?(\d+))?/gu)) {
        const from = Number(match[1]);
        const to = Number(match[2] ?? match[1]);
        for (const message of core.messages.since(meetingId, 0))
          if (message.seq >= from && message.seq <= to) referenced.add(message.id);
      }
    }
    const all = core.messages.since(meetingId, 0).filter(isEligibleMessage);
    let messages = all.filter((message) => newIds.has(message.id) || referenced.has(message.id));
    if (!messages.length && (delta.added.length || delta.removed.length)) {
      // User corrections without # citations use the latest covered source range.
      // This is provenance-only text, not an invitation to extract unchanged facts.
      const priorCoverage = previous ? minutes.coverage(meetingId, previous.id) : 0;
      messages = all.filter(
        (message) =>
          message.seq <= throughSeq && message.seq > Math.min(cursor.throughSeq, priorCoverage),
      );
      if (!messages.length && previous) {
        const row = core.db
          .prepare('SELECT before_text FROM revisions WHERE id = ?')
          .get(previous.id);
        const priorText = String(row?.before_text ?? '');
        const prior = core.db
          .prepare(
            'SELECT id FROM revisions WHERE resource_key = ? AND after_text = ? AND rowid < (SELECT rowid FROM revisions WHERE id = ?) ORDER BY rowid DESC LIMIT 1',
          )
          .get(`minutes:${meetingId}`, priorText, previous.id);
        const rangeStart = prior ? minutes.coverage(meetingId, String(prior.id)) : 0;
        messages = all.filter((message) => message.seq <= throughSeq && message.seq > rangeStart);
      }
    }
    const input = {
      meetingId,
      minutesRevision: String(revision.id),
      throughSeq,
      delta,
      minutesHash: hash(text),
      messages: messages.map((message) => ({
        id: message.id,
        seq: message.seq,
        authorId: message.authorId,
        text: message.text,
        evidenceOnly: !newIds.has(message.id),
        sha256: hash(message.text),
      })),
    };
    const formatPage = (parts) =>
      JSON.stringify({
        meetingId,
        minutesRevision: input.minutesRevision,
        delta: {
          authorId: delta.authorId,
          previousRevision: delta.previousRevision,
          minutesRevision: delta.minutesRevision,
        },
        sources: parts,
      });
    const sources = [
      ...delta.added.map((line) => ({
        kind: 'minutes',
        change: 'added',
        id: String(revision.id),
        text: line,
      })),
      ...delta.removed.map((line) => ({
        kind: 'minutes',
        change: 'removed',
        id: String(revision.id),
        text: line,
      })),
      ...input.messages.map((message) => ({ kind: 'message', ...message })),
    ];
    const capacity = prepared.contextWindow
      ? prepared.contextWindow -
        (prepared.outputTokens || 32768) -
        estimateTokens(`${prepared.prompt}\n${instructions}\n`)
      : null;
    const pages = [];
    for (const source of sources) {
      const fragments = splitSource(
        source,
        (part) => !capacity || estimateTokens(formatPage([part])) <= capacity,
      );
      for (const fragment of fragments) {
        const last = pages.at(-1);
        if (last && (!capacity || estimateTokens(formatPage([...last, fragment])) <= capacity))
          last.push(fragment);
        else pages.push([fragment]);
      }
    }
    return {
      input,
      pages,
      pageIndex: 0,
      candidates: [],
      verificationIndex: 0,
      stage: 'extract',
      outputs: [],
      model: prepared.model,
    };
  }

  function validate(checkpoint) {
    const current = core.workspace.getRevision(checkpoint.input.minutesRevision);
    if (hash(current.after ?? '') !== checkpoint.input.minutesHash)
      throw new AppError('MEMORY_SOURCE_CHANGED', '纪要来源已变化，请重新整理。', 409);
    for (const message of checkpoint.input.messages) {
      if (hash(core.messages.get(message.id).text) !== message.sha256)
        throw new AppError('MEMORY_SOURCE_CHANGED', '对应原文已变化，请重新整理。', 409);
    }
  }

  function trust(meetingId, evidence) {
    const meeting = core.meetings.get(meetingId);
    const refs = [];
    let external = false;
    let allHuman = true;
    for (const proof of evidence) {
      if (!proof.messageId) {
        allHuman = false;
        for (const parsed of extractCitationLabels(proof.quote)) {
          for (const citation of parsed.citations) {
            if (citation.kind !== 'source') continue;
            external = true;
            const source = research.store.findSource(citation.label, meeting.projectId);
            refs.push({
              type: 'source',
              id: source?.id ?? null,
              label: citation.label,
              title: source?.title ?? null,
            });
          }
        }
        const referenced = [...String(proof.quote).matchAll(/#(\d+)/gu)].map((match) =>
          Number(match[1]),
        );
        for (const message of core.messages.since(meetingId, 0)) {
          if (!referenced.includes(message.seq)) continue;
          const related = trust(meetingId, [{ messageId: message.id }]);
          if (related.originTrust === 'external') external = true;
          refs.push(...related.sourceRefs);
        }
        continue;
      }
      const message = core.messages.get(proof.messageId);
      const participant = core.participants.list().find((entry) => entry.id === message.authorId);
      if (participant?.kind !== 'human') allHuman = false;
      const origin = message.refs;
      if (origin.originTrust === 'external' || origin.external === true) external = true;
      for (const ref of [...(origin.sourceRefs ?? []), ...(origin.contextRefs ?? [])]) {
        refs.push(ref);
        if (['source', 'chunk'].includes(ref.type) || ref.sourceId || ref.resourceId)
          external = true;
        if (ref.type === 'item' || ref.itemId) {
          try {
            if (research.store.getItem(ref.id ?? ref.itemId).payload.originTrust === 'external')
              external = true;
          } catch {
            /* retained locator still remains */
          }
        }
      }
      for (const parsed of extractCitationLabels(message.text))
        for (const citation of parsed.citations) {
          if (citation.kind !== 'source') continue;
          external = true;
          const source = research.store.findSource(citation.label, meeting.projectId);
          refs.push({
            type: 'source',
            id: source?.id ?? null,
            label: citation.label,
            title: source?.title ?? null,
          });
        }
      if (message.turnId)
        for (const call of core.turns.toolCalls(message.turnId)) {
          if (
            call.status === 'done' &&
            ['web_search', 'web_fetch', 'research_read'].includes(call.name)
          ) {
            external = true;
            refs.push({ type: 'tool-call', id: call.id, tool: call.name, messageId: message.id });
          }
        }
    }
    return { originTrust: external ? 'external' : allHuman ? 'user' : 'model', sourceRefs: refs };
  }

  return { plan, validate, trust };
}

function splitSource(source, fits) {
  if (fits(source)) return [source];
  const parts = [];
  let offset = 0;
  while (offset < source.text.length) {
    let low = offset + 1;
    let high = source.text.length;
    let best = offset;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      let end = middle;
      if (end < source.text.length && /[\uD800-\uDBFF]/u.test(source.text[end - 1])) end -= 1;
      const part = {
        ...source,
        text: source.text.slice(offset, end),
        offset,
        end,
        length: source.text.length,
      };
      if (end > offset && fits(part)) {
        best = end;
        low = middle + 1;
      } else high = middle - 1;
    }
    if (best === offset)
      throw new AppError(
        'MODEL_CONTEXT_EXCEEDED',
        '当前模型无法容纳纪要变化与来源片段，请选择更大上下文的模型。',
        409,
      );
    parts.push({
      ...source,
      text: source.text.slice(offset, best),
      offset,
      end: best,
      length: source.text.length,
    });
    offset = best;
  }
  return parts;
}
