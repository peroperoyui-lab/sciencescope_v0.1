// Shared template data for the home UI and the secretary's examples.
// The UI supplies its translator; the backend uses Chinese interpolation.

export const STARTER_ICONS = Object.freeze([
  'lightbulb',
  'circle-help',
  'scale',
  'list-checks',
  'database',
  'file-pen',
  'search',
  'book-open',
]);

/** @param {string} text @param {Record<string, any>} [values] */
function interpolate(text, values) {
  return text.replace(/\{([^}]+)\}/gu, (whole, key) =>
    Object.hasOwn(values ?? {}, key) ? String(values[key]) : whole,
  );
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
 * @param {typeof interpolate} [t]
 * @returns {Array<{ icon: string, title: string, sub: string, text: string }>}
 */
export function templateStarters({ project, draft, plan, participants }, t = interpolate) {
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

/** @param {Parameters<typeof templateStarters>[0]} input */
export function starterExamples(input) {
  const names = [
    ...input.participants.map((person) => person.name),
    '魔鬼代言人',
    '独立审核人',
    '方法学家',
  ]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return templateStarters(input).map((card) => {
    const name = names.find((candidate) => card.text.startsWith('@' + candidate + ' '));
    const text = name ? card.text.slice(name.length + 2) : card.text;
    return { ...card, text: text.replaceAll('@', ''), expertId: null };
  });
}
