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

/**
 * The secretary's slot when this home shows it: always on the home without a
 * project, and on a project's home only when the slot is about that project.
 * @template {{ projectId: string }} T
 * @param {T | null} slot @param {string | null} projectId
 * @returns {T | null}
 */
export function slotFor(slot, projectId) {
  return slot && (!projectId || slot.projectId === projectId) ? slot : null;
}

/**
 * The secretary's cards as the page shows them: the expert is addressed by
 * the name it has now, so a renamed expert does not leave the card stale.
 * @param {Array<{ icon: string, title: string, sub: string, text: string, expertId: string | null }>} cards
 * @param {any[]} participants
 * @returns {Array<{ icon: string, title: string, sub: string, text: string }>}
 */
export function slotCards(cards, participants) {
  return cards.map(({ icon, title, sub, text, expertId }) => {
    const name = expertId && participants.find((person) => person.id === expertId)?.name;
    if (!name) return { icon, title, sub, text };
    // The secretary sometimes addresses the expert itself, under this or an
    // older name: drop its own @ so the card is addressed once.
    const own = `@${name}`;
    const bare = (value) => {
      const rest = value.slice(own.length);
      const kept =
        value.startsWith(own) && (!rest || SEPARATOR.test(rest))
          ? rest
          : value.replace(ADDRESS, '');
      return kept.replace(SEPARATOR, '').trim() || value;
    };
    return { icon, title, sub: `@${name} · ${bare(sub)}`, text: `@${name} ${bare(text)}` };
  });
}

const ADDRESS = /^@[^\s·:：,，、]+/u;
const SEPARATOR = /^[\s·:：,，、]+/u;
