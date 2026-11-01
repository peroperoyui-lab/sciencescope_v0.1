// What the home page offers next (design system PageHome): the drafts last
// worked on, and the starting questions of 从这里开始. Plain data in, plain
// data out; the page reads the version groups and plans and renders these.
import { t } from './i18n/index.js';
import { templateStarters } from '../shared/home-starters.js';

/**
 * The drafts most recently saved as a version, newest first.
 * @param {Array<{ project: any, groups: any[] }>} lists each project's version groups
 * @param {number} [limit]
 * @returns {Array<{ project: any, group: any, version: any }>}
 */
export function latestDrafts(lists, limit = 3) {
  return lists
    .flatMap(({ project, groups }) =>
      (groups ?? []).flatMap((group) => {
        const version = group.versions?.[0];
        return version ? [{ project, group, version }] : [];
      }),
    )
    .sort((a, b) => b.version.createdAt.localeCompare(a.version.createdAt))
    .slice(0, limit);
}

/**
 * @param {Parameters<typeof templateStarters>[0]} input
 * @returns {Array<{ icon: string, title: string, sub: string, text: string }>}
 */
export function starters(input) {
  return templateStarters(input, t);
}
