// Optional features (user direction 2026-09-25): an unfinished feature shows
// no "not yet available" text anywhere. Its entry points stay hidden until the
// host reports the feature in /api/status `features`; the task that builds it
// turns the flag on (docs/tasks/FEATURE_FLAGS.md lists owners and interfaces).
// Prototype-only pages (the design package's page catalog and demo pages) are
// never reachable from the desktop client.
import {hostRequest} from './host-client.mjs';

export const FEATURES = {
  folderPicker: {hide: ['[data-creation-pick]', '[data-action="pick-project-folder"]']},
  inAppBrowser: {hide: ['[data-v="browser"]', '[data-route="browser-settings"]'], routes: ['browser', 'browser-settings'], menu: item => item.act === 'browser'},
  branch: {hide: ['[data-v="branch-message"]', '.branch-action'], routes: ['branch'], menu: item => item.act === 'branch-message'},
  usage: {hide: ['[data-route="usage"]'], routes: ['usage']},
  materialsPanel: {routes: ['context'], menu: item => item.act === 'annotations'},
  mapHistory: {hide: ['[data-action="map-history"]'], routes: ['map-history', 'version-note', 'diff']},
  changeLog: {routes: ['changes']},
  pythonEnvs: {}, pluginManagement: {}, dataRelocation: {},
};
const PROTOTYPE_ONLY = {routes: ['help', 'resume', 'run', 'compose', 'free', 'welcome'], menu: item => item.act === 'page-doc'};

let enabled = new Set();
const attr = name => 'data-feature-' + name.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
export const hasFeature = name => enabled.has(name);

function hiddenRoute(route) {
  if (PROTOTYPE_ONLY.routes.includes(route)) return true;
  return Object.entries(FEATURES).some(([name, f]) => f.routes?.includes(route) && !enabled.has(name));
}
function hiddenItem(item) {
  if (!item || item.sep) return false;
  if (PROTOTYPE_ONLY.menu(item)) return true;
  // Links to a hidden route (navItem uses data-route-to) are dropped too.
  const target = /data-route(?:-to)?="([^"]+)"/.exec(item.attrs || '')?.[1];
  if (target && hiddenRoute(target)) return true;
  return Object.entries(FEATURES).some(([name, f]) => f.menu?.(item) && !enabled.has(name));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Entry points are hidden by default, so nothing flashes before the status arrives.
  const style = document.createElement('style');
  style.dataset.features = '';
  style.textContent = Object.entries(FEATURES).filter(([, f]) => f.hide?.length)
    .map(([name, f]) => `:root:not([${attr(name)}]) :is(${f.hide.join(',')}){display:none!important}`).join('\n');
  document.head.append(style);

  const apply = features => {
    enabled = new Set(Object.entries(features || {}).filter(([, on]) => on === true).map(([name]) => name));
    for (const name of Object.keys(FEATURES)) document.documentElement.toggleAttribute(attr(name), enabled.has(name));
  };
  const ready = hostRequest('status').then(status => apply(status?.features)).catch(() => apply({}));

  // Menus: drop entries of hidden features, then tidy separators.
  if (typeof menu === 'function') {
    const baseMenu = menu;
    menu = function (items, ...rest) {
      const kept = items.filter(item => !hiddenItem(item))
        .filter((item, i, all) => !item.sep || (i > 0 && i < all.length - 1 && !all[i - 1].sep));
      return baseMenu(kept, ...rest);
    };
  }
  // Routes of hidden features and prototype-only pages are not navigable.
  if (typeof go === 'function') {
    const baseGo = go;
    go = function (target, ...rest) { if (hiddenRoute(target)) return; return baseGo(target, ...rest); };
  }
  // Academic sites open in the system browser until the in-app browser exists.
  const SITE_URLS = {WOS: 'https://www.webofscience.com', CNKI: 'https://www.cnki.net', Elsevier: 'https://www.elsevier.com', '万方数据': 'https://www.wanfangdata.com.cn', Springer: 'https://link.springer.com'};
  window.addEventListener('click', event => {
    const site = event.target.closest('[data-action="open-site"]');
    if (!site || enabled.has('inAppBrowser')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const name = site.dataset.site;
    const url = S?.siteUrls?.[name] || SITE_URLS[name];
    if (!url) return;
    hostRequest('open-url', {url}).catch(error => toast(`无法打开网址：${error.message}`));
  }, true);

  window.ScienceScopeFeatures = Object.freeze({has: hasFeature, ready, hiddenRoute});
}
