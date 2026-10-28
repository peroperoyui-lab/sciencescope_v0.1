// What the user can do: each action calls the host and records the result in
// the store. Later changes arrive through the event stream anyway; recording
// the direct result keeps the interface responsive.
import { createOutboxActions } from './outbox-actions.js';
import { createActivityActions } from './activity-actions.js';
import { createVersionActions } from './version-actions.js';
import { createDeskActions } from './desk-actions.js';
import { createDeliverableActions } from './deliverable-actions.js';
import { createSnapshotActions } from './snapshot-actions.js';
import { createResearchActions } from './research-actions.js';
import { createResearchInputActions } from './research-input-actions.js';
import { createPreviewActions } from './preview-actions.js';
import { createExtensionActions } from './extension-actions.js';
import { createPythonActions } from './python-actions.js';
import { createMemoryActions } from './memory-actions.js';
import { createSecretaryActions } from './secretary-actions.js';
import { applyAppearance } from './appearance.js';
import { hideAssistantWindow, isNative, openAssistantWindow } from './assistant-window.js';
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
    applyAppearance(settings);
    set({ settings, projects, meetings, participants });
    await activity.loadActivity();
    await loadParticipantDefinitions();
    stopFollowing = api.follow(
      seq,
      (event) => {
        store.update((state) => applyEvent(state, event));
        if (
          event.type === 'participant.created' ||
          event.type === 'participant.updated' ||
          (event.type === 'resource.changed' && event.payload.resource === 'agent')
        ) {
          void loadParticipantDefinitions().catch(() => {});
        }
        if (event.type === 'turn.ended')
          void loadMeetingContexts(event.payload.meetingId).catch(() => {});
        // Settings can be changed by an AI or another window; reload them.
        if (event.type === 'resource.changed' && event.payload.resource === 'settings') {
          api
            .get('/api/settings')
            .then((next) => {
              applyAppearance(next);
              set({ settings: next });
            })
            .catch(() => {});
        }
      },
      (connected) => set({ connected }),
    );
  }

  /** Load a meeting's latest messages and the tool calls of its answers. */
  async function openMeeting(meetingId) {
    activity.viewMeeting(meetingId);
    // An empty list first, so message events that arrive while the page
    // loads are kept; the page must not roll them back.
    store.update((state) =>
      state.messages[meetingId]
        ? state
        : { ...state, messages: { ...state.messages, [meetingId]: [] } },
    );
    const page = await api.get(`/api/meetings/${meetingId}/messages`);
    store.update((state) => {
      const merged = new Map(page.messages.map((message) => [message.id, message]));
      for (const current of state.messages[meetingId] ?? []) {
        const loaded = merged.get(current.id);
        if (
          loaded
            ? current.updatedAt > loaded.updatedAt
            : current.seq > (page.messages.at(-1)?.seq ?? 0)
        )
          merged.set(current.id, current);
      }
      return {
        ...state,
        messages: {
          ...state.messages,
          [meetingId]: [...merged.values()].sort((a, b) => a.seq - b.seq),
        },
        hasBefore: { ...state.hasBefore, [meetingId]: page.hasBefore },
      };
    });
    await Promise.all(page.messages.filter((m) => m.turnId).map((m) => loadTurn(m.turnId)));
    await loadMeetingContexts(meetingId);
    await outbox.loadOutbox(meetingId);
  }

  /**
   * Ensure the single assistant meeting without changing the Main route.
   * @param {boolean} [ensure]
   * @returns {Promise<any>}
   */
  async function assistantSnapshot(ensure = false) {
    const meeting = ensure ? await api.post('/api/assistant') : await api.get('/api/assistant');
    set({ assistantMeeting: meeting });
    if (meeting) apply('meeting.updated', meeting);
    return meeting;
  }

  /**
   * @param {boolean} open
   * @returns {Promise<void>}
   */
  async function showAssistant(open) {
    if (isNative()) {
      await attempt(() => (open ? openAssistantWindow() : hideAssistantWindow()));
      return;
    }
    set({ assistantOpen: open });
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
    await loadMeetingContexts(meetingId);
  }

  async function loadTurn(turnId) {
    const { turn, toolCalls } = await api.get(`/api/turns/${turnId}`);
    store.update((state) => {
      // The event stream may already have reported a newer state of this turn
      // and its activity (a request sent just after the page opened): keep what
      // it reported and add only the entries the snapshot alone knows.
      const reported = state.toolCalls[turnId] ?? [];
      const calls = [
        ...toolCalls.filter((call) => !reported.some((known) => known.id === call.id)),
        ...reported,
      ].sort((a, b) => a.seq - b.seq);
      if (state.turns[turn.id])
        return { ...state, toolCalls: { ...state.toolCalls, [turnId]: calls } };
      return {
        ...state,
        toolCalls: { ...state.toolCalls, [turnId]: calls },
        turns: { ...state.turns, [turn.id]: turn },
        running: turn.status === 'running' ? { ...state.running, [turn.id]: turn } : state.running,
      };
    });
  }

  /**
   * A new meeting with the local user and the main expert.
   * @param {{ projectId?: string | null, title?: string, navigateAfter?:boolean, creation?:any, policy?:any }} [options]
   */
  async function createMeeting({
    projectId = null,
    title,
    navigateAfter = true,
    creation,
    policy,
  } = {}) {
    const meeting = await api.post('/api/meetings', {
      projectId,
      title,
      creation,
      policy,
      members: [{ participantId: LOCAL_USER_ID }, { participantId: MAIN_EXPERT_ID }],
    });
    apply('meeting.created', meeting);
    if (navigateAfter) navigate({ view: 'meeting', id: meeting.id });
    return meeting;
  }

  /** @param {string} meetingId @param {string} text @param {any} [researchInput] */
  async function postMessage(meetingId, text, researchInput) {
    const message = await api.post(`/api/meetings/${meetingId}/messages`, { text, researchInput });
    if (message.queued) apply('meeting.outbox.changed', message.state);
    else apply('message.created', message);
    return message;
  }

  /**
   * Start a meeting from the welcome page with its first message; until then
   * the draft is not a meeting.
   * @param {string} text @param {string | null} [projectId] @param {any} [researchInput]
   * @param {'ask' | 'auto'} [approval] @param {any} [model] the meeting's own model, if chosen
   */
  async function startMeeting(text, projectId = null, researchInput, approval, model) {
    const meeting = await createMeeting({
      projectId,
      title: text.slice(0, 40),
      navigateAfter: false,
      creation: projectId ? undefined : store.get().creationDetails,
      policy:
        approval || model ? { ...(approval && { approval }), ...(model && { model }) } : undefined,
    });
    await openMeeting(meeting.id);
    const result = await postMessage(meeting.id, text, researchInput);
    if (!projectId) set({ creationDetails: null });
    navigate({ view: 'meeting', id: meeting.id });
    return result;
  }

  /** @param {string} meetingId */
  async function interrupt(meetingId) {
    await api.post(`/api/meetings/${meetingId}/interrupt`);
  }

  /** Answer again after a failed or stopped answer. @param {string} messageId */
  const retry = (messageId) => api.post(`/api/messages/${messageId}/retry`);

  /**
   * Allow or reject one pending tool action.
   * @param {any} call @param {'approve' | 'reject'} decision
   */
  /** `always` also saves a rule for the chosen scope (one of `call.args.scopes`). */
  const decideApproval = (call, decision, scope = undefined) =>
    api.post(`/api/turns/${call.turnId}/approvals/${call.id}`, { decision, scope });

  /** Continue only the author of this answer. @param {string} messageId */
  const continueAnswer = (messageId) => api.post(`/api/messages/${messageId}/continue`);

  /** @param {string} messageId @param {boolean} adopted */
  async function adoptReview(messageId, adopted) {
    const message = await api.patch(`/api/messages/${messageId}`, { adopted });
    apply('message.updated', message);
    return message;
  }

  /** Latest actual context measurement for each participant. @param {string} meetingId */
  async function loadMeetingContexts(meetingId) {
    const contexts = await api.get(`/api/meetings/${meetingId}/contexts`);
    store.update((state) => ({
      ...state,
      meetingContexts: { ...state.meetingContexts, [meetingId]: contexts },
    }));
    return contexts;
  }

  /** Reload full definitions after roster/file edits; list rows contain only identity. */
  let definitionTicket = 0;
  async function loadParticipantDefinitions() {
    const ticket = ++definitionTicket;
    const participants = await api.get('/api/participants');
    const full = await Promise.all(
      participants
        .filter((participant) => participant.kind === 'ai')
        .map((participant) => api.get(`/api/participants/${participant.id}`)),
    );
    if (ticket !== definitionTicket) return full;
    set({
      participants,
      participantDefinitions: Object.fromEntries(
        full.map((participant) => [participant.id, participant]),
      ),
    });
    return full;
  }
  /** Put a message into the meeting's input box as a quote. @param {any} message */
  function quote(message) {
    const text = `${message.text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')}\n\n`;
    set({ quote: { meetingId: message.meetingId, text, at: Date.now() } });
  }

  /** Add archived meetings to the store (they are not loaded at start). */
  async function loadArchived() {
    const all = await api.get('/api/meetings?archived=1');
    for (const meeting of all) apply('meeting.updated', meeting);
  }

  /** @param {string} meetingId @param {Record<string, any>} changes */
  async function updateMeeting(meetingId, changes) {
    apply('meeting.updated', await api.patch(`/api/meetings/${meetingId}`, changes));
  }

  /** Into a project, or out of one with `null`. @param {string} meetingId @param {string | null} projectId */
  async function moveMeeting(meetingId, projectId) {
    apply('meeting.updated', await api.post(`/api/meetings/${meetingId}/move`, { projectId }));
  }

  /** @param {string} meetingId @param {string} atMessageId */
  async function forkMeeting(meetingId, atMessageId) {
    const meeting = await api.post(`/api/meetings/${meetingId}/fork`, { atMessageId });
    apply('meeting.created', meeting);
    navigate({ view: 'meeting', id: meeting.id });
  }

  /** @param {string} name @param {{ description?: string, folder?: string | null, environment?:string }} [details] */
  async function createProject(name, details = {}) {
    const project = await api.post('/api/projects', { name, ...details });
    apply('project.created', project);
    return project;
  }

  /** @param {string} projectId @param {Record<string, any>} changes */
  async function updateProject(projectId, changes) {
    apply('project.updated', await api.patch(`/api/projects/${projectId}`, changes));
  }

  /**
   * The latest minutes and automatic-summary status.
   * @param {string} meetingId
   * @returns {Promise<any>}
   */
  const readMinutes = (meetingId) => api.get(`/api/meetings/${meetingId}/minutes`);

  /**
   * A user edit becomes the next revision used by the secretary.
   * @param {string} meetingId
   * @param {string} text
   * @param {string | null} expectedRevision
   * @returns {Promise<any>}
   */
  const editMinutes = (meetingId, text, expectedRevision) => {
    const pending = api.post(`/api/meetings/${meetingId}/minutes`, { text, expectedRevision });
    trackResourceEdit(pending);
    return pending;
  };

  /**
   * @param {string} meetingId
   * @returns {Promise<any>}
   */
  const refreshMinutes = (meetingId) => api.post(`/api/meetings/${meetingId}/minutes/refresh`);

  let focusedProject = null;
  let focusChanges = Promise.resolve();

  /**
   * Serialize leave before enter even when the user switches projects quickly.
   * @param {string | null} projectId
   * @returns {Promise<void>}
   */
  function focusProject(projectId) {
    if (projectId === focusedProject) return focusChanges;
    const previous = focusedProject;
    focusedProject = projectId;
    focusChanges = focusChanges
      .catch(() => {})
      .then(async () => {
        if (previous) await api.post(`/api/projects/${previous}/focus`, { focused: false });
        if (projectId) await api.post(`/api/projects/${projectId}/focus`, { focused: true });
      });
    return focusChanges;
  }

  // Settings show the change at once and save in order: a page that navigates
  // by a just-saved setting (the knowledge scope) must not read the old value,
  // and an earlier response must not overwrite a later one.
  let settingsWrites = Promise.resolve();
  const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const mergeSettings = (base, patch) => {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch))
      result[key] = isPlain(value) && isPlain(base[key]) ? mergeSettings(base[key], value) : value;
    return result;
  };
  /** @param {Record<string, any>} changes */
  async function updateSettings(changes) {
    const current = store.get().settings;
    if (current) {
      const next = mergeSettings(current, changes);
      applyAppearance(next);
      set({ settings: next });
    }
    const write = settingsWrites.catch(() => {}).then(() => api.patch('/api/settings', changes));
    settingsWrites = write;
    try {
      const settings = await write;
      if (settingsWrites === write) {
        applyAppearance(settings);
        set({ settings });
      }
      return settings;
    } catch (error) {
      if (settingsWrites === write) {
        const settings = await api.get('/api/settings').catch(() => current);
        applyAppearance(settings);
        set({ settings });
      }
      throw error;
    }
  }

  /** @param {string} resource @param {string} key */
  const readResource = (resource, key) =>
    api.get(`/api/resources/${resource}?key=${encodeURIComponent(key)}`);

  /** @param {string} resource @param {string} key @param {string} op @param {any} args */
  let resourceEdits = Promise.resolve();
  function trackResourceEdit(pending) {
    resourceEdits = Promise.all([resourceEdits.catch(() => {}), pending.catch(() => {})]).then(
      () => {},
    );
  }
  const editResource = (resource, key, op, args, expectedRevisionId = undefined) => {
    const pending = api.post(`/api/resources/${resource}`, { key, op, args, expectedRevisionId });
    trackResourceEdit(pending);
    return pending;
  };

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
  const undo = (revisionId) =>
    api.post(
      revisionId.startsWith('memrev_')
        ? `/api/memory/revisions/${revisionId}/undo`
        : `/api/revisions/${revisionId}/undo`,
    );

  /** Meetings and messages whose text contains `query`. @param {string} query */
  const search = (query) => api.get(`/api/search?q=${encodeURIComponent(query)}`);

  /** Entries of a folder inside the project's own folder. @param {string} projectId @param {string} [folder] */
  const projectFiles = (projectId, folder = '') =>
    api.get(`/api/projects/${projectId}/files?path=${encodeURIComponent(folder)}`);

  /** How the project's files are indexed: phase, queue and counts. @param {string} projectId */
  const projectIndex = (projectId) => api.get(`/api/projects/${projectId}/index`);
  /** Scan the project folder again. @param {string} projectId */
  const scanProject = (projectId) => api.post(`/api/projects/${projectId}/index`, {});

  /** @param {string} projectId @param {{ op: string, path?: string, to?: string, base64?: string }} body */
  async function fileOp(projectId, body) {
    const result = await api.post(`/api/projects/${projectId}/files`, body);
    store.update((state) => ({ ...state, filesVersion: state.filesVersion + 1 }));
    return result;
  }

  /**
   * Save a file the host produces (exports): the browser downloads it and
   * takes the name from the response.
   * @param {string} route
   */
  async function download(route) {
    const link = document.createElement('a');
    link.href = `${route}${route.includes('?') ? '&' : '?'}token=${encodeURIComponent(api.token)}`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  const systemInfo = () => api.get('/api/system');
  /** @param {string} folder A name from systemInfo().folders, or `project:<id>`. @param {string} [path] */
  const openFolder = (folder, path) => api.post('/api/system/open', { folder, path });
  /** @param {string} file A name from systemInfo().files. */
  const openSystemFile = (file) => api.post('/api/system/open-file', { file });
  const keyRefs = async () => (await api.get('/api/providers/keys')).refs;
  /** @param {string} keyRef @param {string} key */
  const saveKey = (keyRef, key) =>
    api.post(`/api/providers/keys/${encodeURIComponent(keyRef)}`, { key });
  const discoverModels = async (provider) =>
    (await api.post('/api/providers/discover', provider)).models;
  /** Reload the model catalog; repeated calls for the same providers share one request. */
  let catalogFor;
  function loadModels(force = false) {
    const providers = store.get().settings?.providers;
    if (!force && catalogFor === providers) return Promise.resolve();
    catalogFor = providers;
    return api.get('/api/models').then((modelCatalog) => set({ modelCatalog }));
  }
  const providerPresets = () => api.get('/api/providers/presets');
  /** Save a preset provider with only its key. @param {string} id @param {string} key */
  async function savePreset(id, key) {
    const provider = await api.post(`/api/providers/presets/${id}`, { key });
    set({ settings: await api.get('/api/settings') });
    await loadModels(true);
    return provider;
  }
  /** Replace a hand-configured provider with the matching preset, keeping its key. */
  async function adoptPreset(id, preset) {
    await api.post(`/api/providers/${id}/adopt-preset`, { preset });
    set({ settings: await api.get('/api/settings') });
    await loadModels(true);
  }
  /** One very short request. @param {string} id @param {string} [model] */
  const testProvider = (id, model) => api.post(`/api/providers/${id}/test`, { model });
  /** A participant with its definition (AIs). @param {string} id */
  const getParticipant = (id) => api.get(`/api/participants/${id}`);
  /** @param {string} id @param {Record<string, any>} definition */
  const updateParticipant = (id, definition) =>
    api.patch(`/api/participants/${id}`, { definition });
  /** @param {{ kind: 'ai' | 'human', name: string, definition?: any }} input */
  const createParticipant = (input) => api.post('/api/participants', input);

  const setOverlay = (patch) =>
    store.update((state) => ({ ...state, overlay: { ...state.overlay, ...patch } }));
  let toastTimer;

  /**
   * Open a menu under its trigger (or at the pointer for context menus).
   * Items: `{ text, icon?, key?, check?, danger?, disabled?, run }` or `{ sep: true }`.
   * @param {Event} event @param {any[]} items @param {string} [label]
   */
  function openMenu(event, items, label = '') {
    event.preventDefault();
    event.stopPropagation();
    const trigger = /** @type {HTMLElement} */ (event.currentTarget);
    const rect = trigger.getBoundingClientRect();
    const pointer = event.type === 'contextmenu' ? /** @type {MouseEvent} */ (event) : null;
    setOverlay({
      menu: {
        items,
        label,
        x: pointer ? pointer.clientX : rect.left,
        y: pointer ? pointer.clientY : rect.bottom + 5,
      },
    });
  }

  /**
   * @param {string} title
   * @param {any} body A component rendered inside the dialog.
   * @param {string} [className] A legacy dialog variant.
   */
  const openModal = (title, body, className = '') =>
    setOverlay({ modal: { title, body, className }, menu: null });

  /** @param {string} text @param {{ label: string, run: () => any }} [action] A button such as 撤销. */
  function toast(text, action) {
    setOverlay({ toast: action ? { text, action } : text });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => setOverlay({ toast: null }), 4600);
  }

  function dismissToast() {
    clearTimeout(toastTimer);
    setOverlay({ toast: null });
  }

  /** Run an action and show its error, if any, as a toast. @param {() => Promise<any>} work */
  async function attempt(work) {
    try {
      return await work();
    } catch (error) {
      toast(error.message);
      return undefined;
    }
  }

  const outbox = createOutboxActions(api, store);
  const activity = createActivityActions(api, store);
  return {
    ...outbox,
    ...activity,
    ...createVersionActions(api),
    ...createDeskActions(api),
    ...createDeliverableActions(api),
    ...createSnapshotActions(api, store, () => resourceEdits.catch(() => {})),
    ...createResearchActions(api),
    ...createResearchInputActions(api, store),
    ...createPreviewActions(api, store),
    ...createPythonActions(api, store),
    ...createMemoryActions(api),
    ...createSecretaryActions(api, store),
    ...createExtensionActions(api),
    start,
    stop: () => stopFollowing(),
    openMeeting,
    assistantSnapshot,
    showAssistant,
    loadEarlier,
    createMeeting,
    startMeeting,
    postMessage,
    interrupt,
    updateMeeting,
    moveMeeting,
    loadArchived,
    retry,
    decideApproval,
    continueAnswer,
    adoptReview,
    loadMeetingContexts,
    loadParticipantDefinitions,
    quote,
    forkMeeting,
    createProject,
    updateProject,
    updateSettings,
    readMinutes,
    editMinutes,
    refreshMinutes,
    focusProject,
    openMemoryInbox: (projectId) => set({ memoryInboxRequest: { projectId, at: Date.now() } }),
    consumeMemoryInbox: () => set({ memoryInboxRequest: null }),
    /**
     * Open the knowledge page with a source selected: the global knowledge base
     * (as a graph when `graph`) or, for a project's own files, its database.
     * @param {{ id: string, title: string, projectId?: string | null, graph?: boolean }} source
     */
    openKnowledgeSource(source) {
      set({ knowledgeRequest: { ...source, at: Date.now() } });
      navigate(source.projectId ? { view: 'database', id: source.projectId } : { view: 'library' });
    },
    consumeKnowledgeRequest: () => set({ knowledgeRequest: null }),
    readResource,
    editResource,
    history,
    undo,
    search,
    projectFiles,
    projectIndex,
    scanProject,
    requestCards: (sourceIds) => api.post('/api/knowledge/cards', { sourceIds }),
    systemInfo,
    openFolder,
    openSystemFile,
    fileOp,
    download,
    keyRefs,
    saveKey,
    discoverModels,
    loadModels,
    providerPresets,
    savePreset,
    adoptPreset,
    testProvider,
    getParticipant,
    updateParticipant,
    createParticipant,
    openMenu,
    closeMenu: () => setOverlay({ menu: null }),
    openModal,
    closeModal: () => setOverlay({ modal: null }),
    dismissToast,
    openPalette: () => setOverlay({ palette: true, menu: null }),
    closePalette: () => setOverlay({ palette: false }),
    toast,
    attempt,
  };
}

/** @typedef {ReturnType<typeof createActions>} Actions */
