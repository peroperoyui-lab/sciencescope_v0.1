// Interface state: one plain object, changed only by `applyEvent` (events from
// the host) and `loaded` (results of requests). Components read it through
// `useStore`. Every change is an upsert by id, so replayed events are harmless.
import { useEffect, useRef, useState } from 'preact/hooks';

export const initialState = {
  versionsVersion: 0,
  /** null until the event stream first opens or fails. */
  /** @type {boolean | null} */ connected: null,
  settings: null,
  /** @type {any[]} */ projects: [],
  /** @type {any[]} */ meetings: [],
  /** @type {any[]} */ participants: [],
  /** @type {Record<string, any>} */
  participantDefinitions: {},
  /** @type {Record<string, any[]>} */
  meetingContexts: {},
  /** Durable queued input by meeting. */
  /** @type {Record<string, any>} */ outboxes: {},
  /** Current foreground meeting; completion badges are acknowledged here. */
  /** @type {string|null} */ activeMeetingId: null,
  /** @type {Record<string, string>} */ acknowledgedActivity: {},
  /** Loaded meeting records: meetingId → messages in `seq` order. */
  /** @type {Record<string, any[]>} */ messages: {},
  /** @type {Record<string, boolean>} */ hasBefore: {},
  /** Text streamed so far for messages still being written: messageId → text. */
  /** @type {Record<string, string>} */ drafts: {},
  /** turnId → tool calls in order. */
  /** @type {Record<string, any[]>} */ toolCalls: {},
  /** Turns seen so far (for usage and the context ring): turnId → turn. */
  /** @type {Record<string, any>} */ turns: {},
  /** Text to insert into a meeting's input box ("引用到输入框"). */
  /** @type {null | { meetingId: string, text: string, at: number }} */ quote: null,
  /** Running turns: turnId → turn. */
  /** @type {Record<string, any>} */ running: {},
  /** Bumped on every workspace change so open views can reload. */
  workspaceVersion: 0,
  snapshotsVersion: 0,
  /** Bumped when the open minutes dialog needs a new status snapshot. */
  minutesVersion: 0,
  /** Attached secretary snapshots indexed by their Main meeting. */
  /** @type {Record<string, any>} */ secretary: {},
  /** Local unsent secretary input, preserved when the right panel closes. */
  /** @type {Record<string, string>} */ secretaryDrafts: {},
  /** Unsent main input by chat ('new:<project|global>' before it exists). */
  /** @type {Record<string, string>} */ composerDrafts: {},
  /** The global assistant's meeting stays separate from the current page. */
  /** @type {any} */ assistantMeeting: null,
  assistantOpen: false,
  /** @type {null | { meetingId: string, text: string, at: number }} */ fillDraft: null,
  secretaryVersion: 0,
  memoryVersion: 0,
  /** @type {null|{projectId:string|null,at:number}} */ memoryInboxRequest: null,
  researchVersion: 0,
  // Bumped when the host moves graph nodes (knowledge.layout.changed).
  layoutVersion: 0,
  /** @type {{message:string,seq:number}|null} */
  layoutError: null,
  /** @type {Record<string, any>} */ researchDrafts: {},
  /** @type {any} */ materialsTarget: null,
  /** @type {any} */ previewTarget: null,
  semanticVersion: 0,
  pythonVersion: 0,
  /** @type {any} */ creationDetails: null,
  /** @type {any} */
  semanticStatus: null,
  /** `GET /api/models`: providers with catalog capacities and thinking levels. */
  /** @type {any} */ modelCatalog: null,
  /** Bumped after the person changes files in a project folder. */
  filesVersion: 0,
  /** Latest journal sequence per editing-desk session (`desk.changed`). */
  /** @type {Record<string, number>} */ deskSeqs: {},
  /** Edits an expert (not the person) made to each desk session: the last few `desk.changed` events. */
  /** @type {Record<string, { seq: number, actorId: string, meetingId: string | null, changeIds: string[], blockIds: string[] }[]>} */ deskEdits:
    {},
  /** Bumped per desk session when its comments or indexes change (`desk.annotations.changed`). */
  /** @type {Record<string, number>} */ deskNotes: {},
  /** Last `desk.session` notice per session, such as a failed working-copy write. */
  /** @type {Record<string, any>} */ deskSessions: {},
  /** Popups over the window: one menu, one dialog, one toast, the search palette. */
  overlay: {
    /** @type {null | { items: any[], label: string, x: number, y: number }} */ menu: null,
    /** @type {null | { title: string, body: any, className?: string }} */ modal: null,
    /** @type {null | string | { text: string, action: { label: string, run: () => any } }} */ toast:
      null,
    palette: false,
  },
};

/** @typedef {typeof initialState} State */

function upsert(list, item, key = 'id') {
  const index = list.findIndex((candidate) => candidate[key] === item[key]);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = { ...list[index], ...item };
  return next;
}

function upsertMessage(state, message) {
  const current = state.messages[message.meetingId];
  if (!current) return state.messages;
  const next = upsert(current, message).sort((a, b) => a.seq - b.seq);
  return { ...state.messages, [message.meetingId]: next };
}

function without(record, key) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

/**
 * @param {State} state
 * @param {{ type: string, payload: any, actorId?: string | null, meetingId?: string | null }} event
 * @returns {State}
 */
export function applyEvent(state, event) {
  const { type, payload } = event;
  switch (type) {
    case 'versions.changed':
      return { ...state, versionsVersion: state.versionsVersion + 1 };
    case 'python.changed':
      return { ...state, pythonVersion: state.pythonVersion + 1 };
    case 'desk.changed': {
      if ((state.deskSeqs[payload.sessionId] ?? -1) >= payload.seq) return state;
      const deskSeqs = { ...state.deskSeqs, [payload.sessionId]: payload.seq };
      const actorId = event.actorId;
      if (!actorId || actorId === 'person_user' || !payload.changeIds?.length)
        return { ...state, deskSeqs };
      const edit = {
        seq: payload.seq,
        actorId,
        meetingId: event.meetingId ?? null,
        changeIds: payload.changeIds,
        blockIds: payload.blockIds ?? [],
      };
      const edits = [...(state.deskEdits[payload.sessionId] ?? []), edit].slice(-20);
      return { ...state, deskSeqs, deskEdits: { ...state.deskEdits, [payload.sessionId]: edits } };
    }
    case 'desk.annotations.changed':
      return {
        ...state,
        deskNotes: {
          ...state.deskNotes,
          [payload.sessionId]: (state.deskNotes[payload.sessionId] ?? 0) + 1,
        },
      };
    case 'desk.session':
      return {
        ...state,
        deskSessions: {
          ...state.deskSessions,
          [payload.sessionId]: { ...payload, at: Date.now() },
        },
      };
    case 'research.input.changed':
      if ((state.researchDrafts[payload.ownerId]?.version ?? -1) > payload.value.version)
        return state;
      return {
        ...state,
        researchDrafts: { ...state.researchDrafts, [payload.ownerId]: payload.value },
      };
    case 'project.created':
    case 'project.updated':
      return { ...state, projects: upsert(state.projects, payload) };
    case 'participant.created':
    case 'participant.updated':
      return { ...state, participants: upsert(state.participants, payload) };
    case 'meeting.outbox.changed':
      if ((state.outboxes[payload.meetingId]?.version ?? -1) > (payload.version ?? 0)) return state;
      return { ...state, outboxes: { ...state.outboxes, [payload.meetingId]: payload } };
    case 'meeting.created':
    case 'meeting.updated':
      return { ...state, meetings: upsert(state.meetings, payload) };
    case 'message.created': {
      // A new message is activity: the sidebar sorts and dates chats by it.
      const meetings = state.meetings.map((meeting) =>
        meeting.id === payload.meetingId && payload.createdAt > meeting.updatedAt
          ? { ...meeting, updatedAt: payload.createdAt }
          : meeting,
      );
      return { ...state, meetings, messages: upsertMessage(state, payload) };
    }
    case 'message.updated': {
      const drafts =
        payload.status === 'streaming' ? state.drafts : without(state.drafts, payload.id);
      return { ...state, messages: upsertMessage(state, payload), drafts };
    }
    case 'message.delta':
      return {
        ...state,
        drafts: { ...state.drafts, [payload.id]: (state.drafts[payload.id] ?? '') + payload.delta },
      };
    case 'message.replace':
      return { ...state, drafts: { ...state.drafts, [payload.id]: payload.text } };
    case 'turn.started':
      return {
        ...state,
        turns: { ...state.turns, [payload.id]: payload },
        running: { ...state.running, [payload.id]: payload },
      };
    case 'turn.ended':
      return {
        ...state,
        turns: { ...state.turns, [payload.id]: payload },
        running: without(state.running, payload.id),
        acknowledgedActivity:
          state.activeMeetingId === payload.meetingId && payload.status === 'failed'
            ? { ...state.acknowledgedActivity, [payload.meetingId]: payload.endedAt }
            : state.acknowledgedActivity,
      };
    case 'turn.phase':
      // A late phase must not revive a turn that has already ended.
      if (state.turns[payload.id]?.endedAt) return state;
      return {
        ...state,
        turns: { ...state.turns, [payload.id]: payload },
        running: state.running[payload.id]
          ? { ...state.running, [payload.id]: payload }
          : state.running,
      };
    case 'tool.started':
    case 'tool.updated':
    case 'tool.ended': {
      const calls = upsert(state.toolCalls[payload.turnId] ?? [], payload).sort(
        (a, b) => a.seq - b.seq,
      );
      return { ...state, toolCalls: { ...state.toolCalls, [payload.turnId]: calls } };
    }
    case 'memory.status':
      return { ...state, memoryVersion: state.memoryVersion + 1 };
    case 'memory.changed':
    case 'research.changed':
    case 'knowledge.changed':
      return { ...state, researchVersion: state.researchVersion + 1 };
    case 'knowledge.layout.changed':
      return payload.error
        ? { ...state, layoutError: { message: payload.error, seq: Date.now() } }
        : { ...state, layoutVersion: state.layoutVersion + 1 };
    case 'research.semantic.changed':
      return { ...state, semanticVersion: state.semanticVersion + 1, semanticStatus: payload };
    case 'secretary.proposal.updated':
    case 'secretary.followup.updated':
      return { ...state, secretaryVersion: state.secretaryVersion + 1 };
    case 'minutes.updated':
    case 'minutes.status':
      return { ...state, minutesVersion: state.minutesVersion + 1 };
    case 'resource.snapshot.created':
    case 'resource.snapshot.deleted':
      return { ...state, snapshotsVersion: state.snapshotsVersion + 1 };
    case 'resource.changed':
    case 'revision.undone':
      return {
        ...state,
        workspaceVersion: state.workspaceVersion + 1,
        minutesVersion:
          payload.resource === 'minutes' ? state.minutesVersion + 1 : state.minutesVersion,
      };
    default:
      return state;
  }
}

/** A minimal store: `get`, `update` and change listeners. */
export function createStore(state = initialState) {
  const listeners = new Set();
  return {
    get: () => state,
    /** @param {(state: State) => State} change */
    update(change) {
      const next = change(state);
      if (next === state) return;
      state = next;
      for (const listener of listeners) listener(state);
    },
    /** @param {(state: State) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */

/**
 * Re-render when the selected part of the state changes.
 * @template T
 * @param {Store} store
 * @param {(state: State) => T} select
 * @returns {T}
 */
export function useStore(store, select) {
  // The selector may close over props; always use the latest one.
  const latest = useRef(select);
  latest.current = select;
  const [, setValue] = useState(() => select(store.get()));
  const value = select(store.get());
  const rendered = useRef(value);
  rendered.current = value;
  useEffect(() => {
    const update = (state) => setValue(() => latest.current(state));
    const unsubscribe = store.subscribe(update);
    // Events that arrived between the render and this subscription (a burst
    // right after a new message mounts) would otherwise never re-render it.
    const now = latest.current(store.get());
    if (!Object.is(now, rendered.current)) setValue(() => now);
    return unsubscribe;
  }, [store]);
  return value;
}
