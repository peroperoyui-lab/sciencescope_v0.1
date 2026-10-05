// The local HTTP server. It only parses requests, checks the per-launch token
// and calls the core; all behaviour lives in core and services.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AppError } from '../core/errors.js';
import { createRouter } from './router.js';
import { registerEventRoutes } from './routes/events.js';
import { registerMeetingRoutes } from './routes/meetings.js';
import { registerParticipantRoutes } from './routes/participants.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerProviderRoutes } from './routes/providers.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';

// Generous resource bound for request bodies (attachments travel separately).
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/** @param {import('node:http').IncomingMessage} request */
async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new AppError('BODY_TOO_LARGE', '请求内容超过 64 MB，请分批发送。', 413);
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError('INVALID_JSON', '请求内容不是有效的 JSON。');
  }
}

/** @param {string | undefined} given @param {string} expected */
function tokenMatches(given, expected) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ core: import('../core/index.js').Core, token: string,
 *   conductor?: { interrupt: (meetingId: string) => Promise<void> } }} options
 *   Without a conductor (core-only tests) posting a message triggers no answers.
 */
export function createAppServer({ core, token, conductor }) {
  const router = createRouter();
  registerProjectRoutes(router, core);
  registerParticipantRoutes(router, core);
  registerMeetingRoutes(router, core, conductor);
  registerProviderRoutes(router, core);
  registerWorkspaceRoutes(router, core);
  registerEventRoutes(router, core);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const reply = (status, value) => {
      if (response.headersSent) return;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value ?? null));
    };
    try {
      if (!url.pathname.startsWith('/api/')) {
        throw new AppError('NOT_FOUND', '没有这个地址。', 404);
      }
      const bearer = request.headers.authorization?.replace(/^Bearer /, '');
      if (!tokenMatches(bearer ?? url.searchParams.get('token') ?? undefined, token)) {
        throw new AppError('UNAUTHORIZED', '本地口令不正确。', 401);
      }
      const route = router.match(request.method ?? 'GET', url.pathname);
      if (!route) throw new AppError('NOT_FOUND', '没有这个接口。', 404);
      const body = request.method === 'GET' ? {} : await readJson(request);
      const result = await route.handler({
        params: route.params,
        query: url.searchParams,
        body,
        request,
        response,
      });
      if (!response.headersSent) reply(200, result);
    } catch (error) {
      if (error instanceof AppError) {
        reply(error.status, { code: error.code, message: error.message });
      } else {
        console.error(error);
        reply(500, { code: 'INTERNAL', message: '内部错误，详情见日志。' });
      }
    }
  });

  return {
    /**
     * @param {{ host?: string, port?: number }} [options]
     * @returns {Promise<string>} Base URL.
     */
    listen({ host = '127.0.0.1', port = 0 } = {}) {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const address = /** @type {import('node:net').AddressInfo} */ (server.address());
          resolve(`http://${host}:${address.port}`);
        });
      });
    },
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}
