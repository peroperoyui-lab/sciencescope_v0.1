// Where the user is, kept in the address hash so reloads return to it:
//   #/                       welcome page (a new meeting not yet started)
//   #/new/<projectId>        the same, for a meeting inside a project
//   #/meeting/<meetingId>    a meeting
//   #/workbench/<projectId>  a project's workbench
//   #/all                    browse all meetings
import { useEffect, useState } from 'preact/hooks';

/** @typedef {{ view: 'home' | 'all', id?: string } | { view: 'new' | 'meeting' | 'workbench', id: string }} Route */

/** @returns {Route} */
export function parseRoute(hash = location.hash) {
  const [, view, id] = hash.replace(/^#/, '').split('/');
  if ((view === 'meeting' || view === 'workbench' || view === 'new') && id) return { view, id };
  if (view === 'all') return { view: 'all' };
  return { view: 'home' };
}

/** @param {Route} route */
export function routeHref(route) {
  if (route.view === 'home') return '#/';
  if (route.view === 'all') return '#/all';
  return `#/${route.view}/${route.id}`;
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
