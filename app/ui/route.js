// Where the user is, kept in the address hash so reloads return to it:
//   #/                       home
//   #/meeting/<meetingId>    a meeting
//   #/workbench/<projectId>  a project's workbench
import { useEffect, useState } from 'preact/hooks';

/** @typedef {{ view: 'home' } | { view: 'meeting' | 'workbench', id: string }} Route */

/** @returns {Route} */
export function parseRoute(hash = location.hash) {
  const [, view, id] = hash.replace(/^#/, '').split('/');
  if ((view === 'meeting' || view === 'workbench') && id) return { view, id };
  return { view: 'home' };
}

/** @param {Route} route */
export function routeHref(route) {
  return route.view === 'home' ? '#/' : `#/${route.view}/${route.id}`;
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
