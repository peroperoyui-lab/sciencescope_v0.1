// A small router: method + path pattern (`/api/meetings/:id`) → handler.
// Handlers receive parsed input and return a JSON-serializable value.

/**
 * @typedef {{ params: Record<string, string>, query: URLSearchParams, body: any,
 *   request: import('node:http').IncomingMessage,
 *   response: import('node:http').ServerResponse }} RouteInput
 * @typedef {(input: RouteInput) => any} Handler
 */

export function createRouter() {
  /** @type {Array<{ method: string, parts: string[], handler: Handler }>} */
  const routes = [];

  /**
   * @param {string} method
   * @param {string} pattern
   * @param {Handler} handler
   */
  function add(method, pattern, handler) {
    routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }

  /**
   * @param {string} method
   * @param {string} pathname
   * @returns {{ handler: Handler, params: Record<string, string> } | null}
   */
  function match(method, pathname) {
    const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
    for (const route of routes) {
      if (route.method !== method || route.parts.length !== parts.length) continue;
      /** @type {Record<string, string>} */
      const params = {};
      const matched = route.parts.every((part, index) => {
        if (part.startsWith(':')) {
          params[part.slice(1)] = parts[index];
          return true;
        }
        return part === parts[index];
      });
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    put: (pattern, handler) => add('PUT', pattern, handler),
    delete: (pattern, handler) => add('DELETE', pattern, handler),
    match,
  };
}

/** @typedef {ReturnType<typeof createRouter>} Router */
