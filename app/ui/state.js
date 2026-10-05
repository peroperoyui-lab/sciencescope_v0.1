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
  /** Loaded meeting records: meetingId → messages in `seq` order. */
  /** @type {Record<string, any[]>} */ messages: {},
  /** @type {Record<string, boolean>} */ hasBefore: {},
  /** Text streamed so far for messages still being written: messageId → text. */
  /** @type {Record<string, string>} */ drafts: {},
  /** turnId → tool calls in order. */
  /** @type {Record<string, any[]>} */ toolCalls: {},
  /** Running turns: turnId → turn. */
  /** @type {Record<string, any>} */ running: {},
  /** Bumped on every workspace change so open views can reload. */
  workspaceVersion: 0,
  /** Popups over the window: one menu, one dialog, one toast, the search palette. */
  overlay: {
    /** @type {null | { items: any[], label: string, x: number, y: number }} */ menu: null,
    /** @type {null | { title: string, body: any }} */ modal: null,
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
    case 'project.created':
    case 'project.updated':
      return { ...state, projects: upsert(state.projects, payload) };
    case 'participant.created':
    case 'participant.updated':
      return { ...state, participants: upsert(state.participants, payload) };
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
      return { ...state, running: { ...state.running, [payload.id]: payload } };
    case 'turn.ended':
      return { ...state, running: without(state.running, payload.id) };
    case 'tool.started':
    case 'tool.ended': {
      const calls = upsert(state.toolCalls[payload.turnId] ?? [], payload).sort(
        (a, b) => a.seq - b.seq,
      );
      return { ...state, toolCalls: { ...state.toolCalls, [payload.turnId]: calls } };
    }
    case 'resource.changed':
    case 'revision.undone':
      return { ...state, workspaceVersion: state.workspaceVersion + 1 };
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
