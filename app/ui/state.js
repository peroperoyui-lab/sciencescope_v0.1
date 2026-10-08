// Interface state: one plain object, changed only by `applyEvent` (events from
// the host) and `loaded` (results of requests). Components read it through
// `useStore`. Every change is an upsert by id, so replayed events are harmless.
import { useEffect, useRef, useState } from 'preact/hooks';

export const initialState = {
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
  /** The global assistant's meeting stays separate from the current page. */
  /** @type {any} */ assistantMeeting: null,
  assistantOpen: false,
  /** @type {null | { meetingId: string, text: string, at: number }} */ fillDraft: null,
  secretaryVersion: 0,
  memoryVersion: 0,
  /** @type {null|{projectId:string|null,at:number}} */ memoryInboxRequest: null,
  researchVersion: 0,
  /** @type {Record<string, any>} */ researchDrafts: {},
  /** @type {any} */ materialsTarget: null,
  /** @type {any} */ previewTarget: null,
  semanticVersion: 0,
  pythonVersion: 0,
  /** @type {any} */ creationDetails: null,
  /** @type {any} */
  semanticStatus: null,
  /** Bumped after the person changes files in a project folder. */
  filesVersion: 0,
  /** Popups over the window: one menu, one dialog, one toast, the search palette. */
  overlay: {
    /** @type {null | { items: any[], label: string, x: number, y: number }} */ menu: null,
    /** @type {null | { title: string, body: any, className?: string }} */ modal: null,
    /** @type {null | string} */ toast: null,
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
 * @param {{ type: string, payload: any }} event
 * @returns {State}
 */
export function applyEvent(state, { type, payload }) {
  switch (type) {
    case 'python.changed':
      return { ...state, pythonVersion: state.pythonVersion + 1 };
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
    case 'message.created':
      return { ...state, messages: upsertMessage(state, payload) };
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
      };
    case 'tool.started':
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
      return { ...state, researchVersion: state.researchVersion + 1 };
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
  useEffect(() => store.subscribe((state) => setValue(() => latest.current(state))), [store]);
  return select(store.get());
}
