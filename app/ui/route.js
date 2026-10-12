// Where the user is, kept in the address hash so reloads return to it:
//   #/                       welcome page (a new meeting not yet started)
//   #/new/<projectId>        the same, for a meeting inside a project
//   #/meeting/<meetingId>    a meeting
//   #/workbench/<projectId>  a project's workbench
//   #/all                    browse all meetings
//   #/project-new            create a project
//   #/settings/<page>        a settings page (general, models, experts…)
//   #/plans/<projectId>, #/journal/<projectId>, #/files/<projectId>, #/map/<projectId>
//                            a workbench area on its own page
import { useEffect, useState } from 'preact/hooks';

/** @typedef {{ view: 'home' | 'all' | 'project-new' | 'library' | 'sources', id?: string } | { view: 'new' | 'meeting' | 'workbench' | 'settings' | 'plans' | 'journal' | 'files' | 'map' | 'database' | 'versions', id: string }} Route */

const WITH_ID = [
  'versions',
  'meeting',
  'workbench',
  'new',
  'settings',
  'plans',
  'journal',
  'files',
  'map',
  'database',
];

/** @returns {Route} */
export function parseRoute(hash = location.hash) {
  const [, view, ...rest] = hash.replace(/^#/, '').split('/');
  const id = rest.map(decodeURIComponent).join('/');
  if (WITH_ID.includes(view) && id) return { view: /** @type {any} */ (view), id };
  if (view === 'library' || view === 'sources') return { view };
  if (view === 'all') return { view: 'all' };
  if (view === 'project-new') return { view: 'project-new' };
  return { view: 'home' };
}

/** @param {Route} route */
export function routeHref(route) {
  if (route.view === 'home') return '#/';
  if (route.view === 'library' || route.view === 'sources') return '#/' + route.view;
  if (route.view === 'all') return '#/all';
  if (route.view === 'project-new') return '#/project-new';
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
