// Where the user is, kept in the address hash so reloads return to it:
//   #/                       welcome page (a new meeting not yet started)
//   #/new/<projectId>        the same, for a meeting inside a project
//   #/meeting/<meetingId>    a meeting
//   #/workbench/<projectId>  a project's workbench
//   #/all                    browse all meetings
//   #/settings/<page>        a settings page (general, models, experts…)
import { useEffect, useState } from 'preact/hooks';

/** @typedef {{ view: 'home' | 'all', id?: string } | { view: 'new' | 'meeting' | 'workbench' | 'settings', id: string }} Route */

const WITH_ID = ['meeting', 'workbench', 'new', 'settings'];

/** @returns {Route} */
export function parseRoute(hash = location.hash) {
  const [, view, ...rest] = hash.replace(/^#/, '').split('/');
  const id = rest.map(decodeURIComponent).join('/');
  if (WITH_ID.includes(view) && id) return { view: /** @type {any} */ (view), id };
  if (view === 'all') return { view: 'all' };
  return { view: 'home' };
}

/** @param {Route} route */
export function routeHref(route) {
  if (route.view === 'home') return '#/';
  if (route.view === 'all') return '#/all';
  return `#/${route.view}/${route.id.split('/').map(encodeURIComponent).join('/')}`;
}

/** @param {Route} route */
export function navigate(route) {
  location.hash = routeHref(route);
}

export function useRoute() {
  const [route, setRoute] = useState(parseRoute);
  useEffect(() => {
    const update = () => setRoute(parseRoute());
    addEventListener('hashchange', update);
    return () => removeEventListener('hashchange', update);
  }, []);
  return route;
}
