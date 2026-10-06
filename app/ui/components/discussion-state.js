// Shared roster projections use full participant definitions, with the saved
// meeting policy as the sole source of truth for mode and panel selection.
import { useActions, useAppState } from '../context.js';

/** @param {string | undefined} meetingId */
export function useDiscussion(meetingId) {
  const actions = useActions();
  const meeting = useAppState((state) =>
    state.meetings.find((candidate) => candidate.id === meetingId),
  );
  const definitions = useAppState((state) => state.participantDefinitions);
  const participants = Object.values(definitions).sort(
    (a, b) => (a.definition.position ?? 0) - (b.definition.position ?? 0),
  );
  const enabled = participants.filter((participant) => participant.definition.enabled !== false);
  const experts = enabled.filter((participant) => participant.definition.panel === 'expert');
  const reviewers = enabled.filter((participant) =>
    ['expert', 'reviewer'].includes(participant.definition.panel),
  );
  const members = new Set(meeting?.members.map((member) => member.participantId) ?? []);
  const candidates = participants.filter(
    (participant) =>
      participant.definition.panel !== 'reviewer' &&
      (members.has(participant.id) || experts.some((expert) => expert.id === participant.id)),
  );
  const policy = meeting?.policy ?? { mode: 'direct' };
  const ordered = policy.mode === 'round';
  const save = (patch) =>
    actions.attempt(() => actions.updateMeeting(meetingId, { policy: { ...policy, ...patch } }));
  const inOrder = (selection) =>
    experts.filter((expert) => selection.includes(expert.id)).map((expert) => expert.id);
  return { meeting, experts, reviewers, candidates, policy, ordered, save, inOrder };
}
