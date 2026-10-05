// What the user can do: each action calls the host and records the result in
// the store. Later changes arrive through the event stream anyway; recording
// the direct result keeps the interface responsive.
import { setLanguage } from './i18n/index.js';
import { navigate } from './route.js';
import { applyEvent } from './state.js';

export const LOCAL_USER_ID = 'person_user';
export const MAIN_EXPERT_ID = 'agent_main';

/**
 * @param {import('./api.js').Api} api
 * @param {import('./state.js').Store} store
 */
export function createActions(api, store) {
  const set = (patch) => store.update((state) => ({ ...state, ...patch }));
  const apply = (type, payload) => store.update((state) => applyEvent(state, { type, payload }));
  let stopFollowing = () => {};

  async function start() {
    const { seq } = await api.get('/api/events/head');
    const [settings, projects, meetings, participants] = await Promise.all([
      api.get('/api/settings'),
      api.get('/api/projects'),
      api.get('/api/meetings'),
      api.get('/api/participants'),
    ]);
    setLanguage(settings.appearance?.language);
    set({ settings, projects, meetings, participants });
    stopFollowing = api.follow(
      seq,
      (event) => store.update((state) => applyEvent(state, event)),
      (connected) => set({ connected }),
    );
  }

  /** Load a meeting's latest messages and the tool calls of its answers. */
  async function openMeeting(meetingId) {
    const page = await api.get(`/api/meetings/${meetingId}/messages`);
    store.update((state) => ({
      ...state,
      messages: { ...state.messages, [meetingId]: page.messages },
      hasBefore: { ...state.hasBefore, [meetingId]: page.hasBefore },
    }));
    await Promise.all(page.messages.filter((m) => m.turnId).map((m) => loadTurn(m.turnId)));
  }

  async function loadEarlier(meetingId) {
    const loaded = store.get().messages[meetingId] ?? [];
    if (!loaded.length) return;
    const page = await api.get(`/api/meetings/${meetingId}/messages?before=${loaded[0].seq}`);
    store.update((state) => ({
      ...state,
      messages: { ...state.messages, [meetingId]: [...page.messages, ...loaded] },
      hasBefore: { ...state.hasBefore, [meetingId]: page.hasBefore },
    }));
    await Promise.all(page.messages.filter((m) => m.turnId).map((m) => loadTurn(m.turnId)));
  }

  async function loadTurn(turnId) {
    const { turn, toolCalls } = await api.get(`/api/turns/${turnId}`);
    store.update((state) => ({
      ...state,
      toolCalls: { ...state.toolCalls, [turnId]: toolCalls },
      running: turn.status === 'running' ? { ...state.running, [turn.id]: turn } : state.running,
    }));
  }

  /**
   * A new meeting with the local user and the main expert.
   * @param {{ projectId?: string | null, title?: string }} [options]
   */
  async function createMeeting({ projectId = null, title } = {}) {
    const meeting = await api.post('/api/meetings', {
      projectId,
      title,
      members: [{ participantId: LOCAL_USER_ID }, { participantId: MAIN_EXPERT_ID }],
    });
    apply('meeting.created', meeting);
    navigate({ view: 'meeting', id: meeting.id });
    return meeting;
  }

  /** @param {string} meetingId @param {string} text */
  async function postMessage(meetingId, text) {
    const message = await api.post(`/api/meetings/${meetingId}/messages`, { text });
    apply('message.created', message);
    return message;
  }

  /** Start a meeting from the home page with its first message. */
  async function startMeeting(text) {
    const meeting = await createMeeting({ title: text.slice(0, 40) });
    await openMeeting(meeting.id);
    await postMessage(meeting.id, text);
  }

  /** @param {string} meetingId */
  async function interrupt(meetingId) {
    await api.post(`/api/meetings/${meetingId}/interrupt`);
  }

  /** @param {string} meetingId @param {Record<string, any>} changes */
  async function updateMeeting(meetingId, changes) {
    apply('meeting.updated', await api.patch(`/api/meetings/${meetingId}`, changes));
  }

  /** @param {string} meetingId @param {string} atMessageId */
  async function forkMeeting(meetingId, atMessageId) {
    const meeting = await api.post(`/api/meetings/${meetingId}/fork`, { atMessageId });
    apply('meeting.created', meeting);
    navigate({ view: 'meeting', id: meeting.id });
  }

  /** @param {string} name */
  async function createProject(name) {
    const project = await api.post('/api/projects', { name });
    apply('project.created', project);
    return project;
  }

  /** @param {string} projectId @param {Record<string, any>} changes */
  async function updateProject(projectId, changes) {
    apply('project.updated', await api.patch(`/api/projects/${projectId}`, changes));
  }

  /** @param {Record<string, any>} changes */
  async function updateSettings(changes) {
    const settings = await api.patch('/api/settings', changes);
    setLanguage(settings.appearance?.language);
    set({ settings });
  }

  /** @param {string} resource @param {string} key */
  const readResource = (resource, key) =>
    api.get(`/api/resources/${resource}?key=${encodeURIComponent(key)}`);

  /** @param {string} resource @param {string} key @param {string} op @param {any} args */
  const editResource = (resource, key, op, args) =>
    api.post(`/api/resources/${resource}`, { key, op, args });

  /** @param {{ resource?: string, key?: string, limit?: number }} query */
  function history(query) {
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value != null)
        .map(([k, v]) => [k, String(v)]),
    );
    return api.get(`/api/revisions?${params}`);
  }

  /** @param {string} revisionId */
  const undo = (revisionId) => api.post(`/api/revisions/${revisionId}/undo`);

  return {
    start,
    stop: () => stopFollowing(),
    openMeeting,
    loadEarlier,
    createMeeting,
    startMeeting,
    postMessage,
    interrupt,
    updateMeeting,
    forkMeeting,
    createProject,
    updateProject,
    updateSettings,
    readResource,
    editResource,
    history,
    undo,
  };
}

/** @typedef {ReturnType<typeof createActions>} Actions */
