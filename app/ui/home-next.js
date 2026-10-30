// What the home page offers next (design system PageHome): the drafts last
// worked on, and the starting questions of 从这里开始. Plain data in, plain
// data out; the page reads the version groups and plans and renders these.
import { t } from './i18n/index.js';

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

/** The expert's current name, or the default one. @param {any[]} participants @param {string} id @param {string} fallback */
const nameOf = (participants, id, fallback) =>
  participants.find((participant) => participant.id === id)?.name || fallback;

/**
 * Starting questions for 从这里开始: each fills the composer with `text` (an
 * expert is addressed with @name at the front) and is never sent by itself.
 * They use what is at hand: the latest draft and the first unfinished plan.
 * Without a project only the two that do not need one are offered.
 * @param {{ project: any | null, draft: { name: string, number: number } | null,
 *   plan: string | null, participants: any[] }} input
 * @returns {Array<{ icon: string, title: string, sub: string, text: string }>}
 */
export function starters({ project, draft, plan, participants }) {
  const red = nameOf(participants, 'agent_red_team', t('魔鬼代言人'));
  const reviewer = nameOf(participants, 'agent_reviewer', t('独立审核人'));
  const method = nameOf(participants, 'agent_methodologist', t('方法学家'));
  const define = {
    icon: 'lightbulb',
    title: t('把一个概念变成可操作的定义'),
    sub: t('@{name} · 边界、维度和判断标准', { name: method }),
    text: t('@{name} 帮我把这个概念变成可操作的定义，说清边界、维度和判断标准：', {
      name: method,
    }),
  };
  const question = {
    icon: 'circle-help',
    title: t('把想法磨成一个研究问题'),
    sub: t('@{name} · 问题、对象和可回答的范围', { name: method }),
    text: t('@{name} 帮我把下面这个想法磨成一个可以回答的研究问题：', { name: method }),
  };
  if (!project) return [question, define];
  const challenge = draft
    ? {
        icon: 'scale',
        title: t('让{name}挑一挑《{draft}》', { name: red, draft: draft.name }),
        sub: t('@{name} · 找出论证里最容易被追问的三处', { name: red }),
        text: t('@{name} 请读《{draft}》，找出论证里最容易被追问的三处，并说明为什么。', {
          name: red,
          draft: draft.name,
        }),
      }
    : {
        icon: 'scale',
        title: t('让{name}先唱唱反调', { name: red }),
        sub: t('@{name} · 给出最有力的另一种解释', { name: red }),
        text: t('@{name} 针对我下面的判断，给出最有力的另一种解释，以及能区分两者的证据：', {
          name: red,
        }),
      };
  const next = plan
    ? {
        icon: 'list-checks',
        title: t('接着做：{plan}', { plan }),
        sub: t('计划里还没做完的一件'),
        text: t('接着做计划里的这一件：{plan}。先说说从哪里入手。', { plan }),
      }
    : {
        icon: 'database',
        title: t('我的资料够回答这个问题吗？'),
        sub: t('按项目资料核对，列出还缺的材料'),
        text: t('按这个项目的资料核对，下面这个问题现有材料够不够回答，还缺哪些：'),
      };
  const review = draft
    ? {
        icon: 'file-pen',
        title: t('按审稿标准读第 {n} 版', { n: draft.number }),
        sub: t('@{name} · 标出必须修改的地方', { name: reviewer }),
        text: t('@{name} 按期刊审稿标准读《{draft}》第 {n} 版，标出必须修改的地方。', {
          name: reviewer,
          draft: draft.name,
          n: draft.number,
        }),
      }
    : question;
  return [challenge, next, review, define];
}
