// Server-sent events. A client passes the last sequence number it has seen;
// it first receives every stored event after that, then live events.
// Subscribing before replaying means nothing is missed in between.

const HEARTBEAT_MS = 25_000;

/** @param {import('../../core/events.js').AppEvent} event */
function frame(event) {
  const id = event.seq == null ? '' : `id: ${event.seq}\n`;
  return `${id}event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** @param {import('../router.js').Router} router @param {import('../../core/index.js').Core} core */
export function registerEventRoutes(router, core) {
  // Where to start following after loading current state.
  router.get('/api/events/head', () => ({ seq: core.events.head() }));

  router.get('/api/events', ({ query, request, response }) => {
    const lastEventId = request.headers['last-event-id'];
    let lastSent = Number(query.get('since') ?? lastEventId ?? 0) || 0;
    let replaying = true;
    const held = [];

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = (event) => {
      if (event.seq != null) {
        if (event.seq <= lastSent) return;
        lastSent = event.seq;
      }
      response.write(frame(event));
    };

    const unsubscribe = core.events.subscribe((event) => {
      if (replaying) held.push(event);
      else send(event);
    });

    let batch = core.events.since(lastSent);
    while (batch.length) {
      batch.forEach(send);
      batch = core.events.since(lastSent);
    }
    replaying = false;
    held.forEach(send);

    const heartbeat = setInterval(() => response.write(': keep-alive\n\n'), HEARTBEAT_MS);
    request.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    return undefined;
  });
}
