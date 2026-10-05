// The bridge: a localhost HTTP endpoint in our process that DSH session
// processes post to. It carries their readiness, runtime events and tool
// calls (which wait for our answer). One bridge serves every session; each
// session has its own token.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * @typedef {{ token: string,
 *   onReady: (controlUrl: string) => void,
 *   onFailed: (error: string) => void,
 *   onEvent: (event: any) => void,
 *   onToolCall: (call: { name: string, args: any, callId: string, signal: AbortSignal }) => Promise<any> }} SessionLink
 */

export async function createBridge() {
  /** @type {Map<string, SessionLink>} */
  const links = new Map();

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', async () => {
      const reply = (status, value) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value ?? null));
      };
      let message;
      try {
        message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        reply(400, { error: 'invalid JSON' });
        return;
      }
      const link = links.get(message.sessionId);
      if (!link || link.token !== message.token) {
        reply(401, { error: 'unknown session' });
        return;
      }
      if (message.type === 'ready') link.onReady(message.controlUrl);
      else if (message.type === 'failed') link.onFailed(message.error);
      else if (message.type === 'event') link.onEvent(message.event);
      else if (message.type === 'tool') {
        const controller = new AbortController();
        request.once('close', () => {
          if (!response.writableEnded) controller.abort();
        });
        try {
          const result = await link.onToolCall({
            name: message.name,
            args: message.args,
            callId: message.callId,
            signal: controller.signal,
          });
          reply(200, { result });
        } catch (error) {
          reply(200, { error: String(error?.message ?? error) });
        }
        return;
      }
      reply(200, {});
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());

  return {
    url: `http://127.0.0.1:${address.port}/`,
    /**
     * @param {string} sessionId
     * @param {Omit<SessionLink, 'token'>} handlers
     * @returns {string} The session's token.
     */
    link(sessionId, handlers) {
      const token = randomBytes(24).toString('hex');
      links.set(sessionId, { token, ...handlers });
      return token;
    },
    /** @param {string} sessionId @param {Partial<SessionLink>} changes */
    update(sessionId, changes) {
      const link = links.get(sessionId);
      if (link) Object.assign(link, changes);
    },
    /** @param {string} sessionId */
    unlink(sessionId) {
      links.delete(sessionId);
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}
