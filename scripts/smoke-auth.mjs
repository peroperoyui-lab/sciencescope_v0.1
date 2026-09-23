// Shared auth helpers for browser/HTTP smoke fixtures.
export function apiHeaders(apiToken, contentType = false) {
  return {
    ...(contentType ? {'Content-Type': 'application/json'} : {}),
    ...(apiToken ? {Authorization: `Bearer ${apiToken}`} : {}),
  };
}

export function apiFetch(server, route, options = {}) {
  const url = new URL(route.replace(/^\//, ''), server.url.endsWith('/') ? server.url : `${server.url}/`);
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${server.apiToken}`);
  return fetch(url, {...options, headers});
}

export async function installApiToken(page, server) {
  const origin = new URL(server.url).origin;
  await page.addInitScript(({token, origin: expectedOrigin}) => {
    if (window.location.origin !== expectedOrigin) return;
    Object.defineProperty(window, '__SCIENCESCOPE_API_TOKEN__', {
      value: token, writable: false, enumerable: false, configurable: false,
    });
  }, {token: server.apiToken, origin});
}
