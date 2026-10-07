// The interface's only connection to the host: JSON requests and the event
// stream. The per-launch token arrives in the page address (`?token=`) and is
// kept for the session so reloads keep working.

const EVENT_TYPES = [
  'project.created',
  'project.updated',
  'participant.created',
  'participant.updated',
  'meeting.created',
  'meeting.updated',
  'message.created',
  'message.delta',
  'message.replace',
  'message.updated',
  'turn.started',
  'turn.ended',
  'tool.started',
  'tool.ended',
  'resource.changed',
  'resource.snapshot.created',
  'resource.snapshot.deleted',
  'minutes.updated',
  'minutes.status',
  'secretary.proposal.updated',
  'secretary.followup.updated',
  'revision.undone',
  'research.changed',
  'memory.status',
  'memory.changed',
  'research.semantic.changed',
];

export class ApiError extends Error {
  /** @param {string} code @param {string} message @param {number} status */
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function readToken() {
  const url = new URL(location.href);
  const given = url.searchParams.get('token');
  if (given) {
    sessionStorage.setItem('sciencescope.token', given);
    url.searchParams.delete('token');
    history.replaceState(null, '', url);
    return given;
  }
  return sessionStorage.getItem('sciencescope.token') ?? '';
}

export function createApi() {
  const token = readToken();

  /**
   * @param {string} method
   * @param {string} route
   * @param {any} [body]
   */
  async function request(method, route, body) {
    const response = await fetch(route, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        value?.code ?? 'HTTP',
        value?.message ?? response.statusText,
        response.status,
      );
    }
    return value;
  }

  /**
   * Follow the change feed. The browser reconnects by itself and resends the
   * last event id, so nothing is missed after a dropped connection.
   * @param {number} since
   * @param {(event: any) => void} onEvent
   * @param {(connected: boolean) => void} onStatus
   */
  function follow(since, onEvent, onStatus) {
    const source = new EventSource(`/api/events?since=${since}&token=${encodeURIComponent(token)}`);
    const handle = (/** @type {MessageEvent} */ frame) => onEvent(JSON.parse(frame.data));
    for (const type of EVENT_TYPES) source.addEventListener(type, handle);
    source.onopen = () => onStatus(true);
    source.onerror = () => onStatus(false);
    return () => source.close();
  }

  return {
    token,
    request,
    follow,
    get: (route) => request('GET', route),
    post: (route, body = {}) => request('POST', route, body),
    patch: (route, body = {}) => request('PATCH', route, body),
  };
}

/** @typedef {ReturnType<typeof createApi>} Api */
