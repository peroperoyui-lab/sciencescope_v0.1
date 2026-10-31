import { createHash } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { STARTER_ICONS, starterExamples } from '../../shared/home-starters.js';

export const STARTER_INSTRUCTIONS = `你是项目的任务秘书，按提供的项目状态写首页进度和四张“从这里开始”卡片。
只根据输入中的项目、最新纪要、未完成计划、文稿和专家名单，不编造没有的进展、事实、数据或结论。模板只是写法示例，不是项目事实。
只返回一个 JSON 对象，不加 Markdown 围栏或其他文字：
{"progress":"项目进度","cards":[{"icon":"lightbulb","title":"标题","sub":"副标题","text":"放进输入框的指令","expertId":null}]}
progress 为一到两句，最多 80 个 Unicode 字符；cards 恰好四张，每张 title 最多 24 字、sub 最多 30 字、text 最多 200 字，均须有内容。
icon 只能是 lightbulb、circle-help、scale、list-checks、database、file-pen、search、book-open。
text 不带 @；需要找专家时，expertId 只能选实际专家名单中的 id，不找专家时为 null。界面会按当前名字补上 @。
不要直接发送指令、编辑项目或调用工具。`;

/** @param {string} text */
function unfinishedPlans(text) {
  return text.split(/\r?\n/u).flatMap((line) => {
    const match = /^\s*- \[ \] (.*)$/u.exec(line);
    return match ? [match[1]] : [];
  });
}

/** @param {import('../../core/participants.js').Participant} participant */
function expertOf(participant) {
  const definition = participant.definition;
  const role =
    definition?.role || definition?.prompt.split(/\r?\n/u).find((line) => line.trim()) || '';
  return {
    id: participant.id,
    name: participant.name,
    role: role
      .trim()
      .replace(/\s+/gu, ' ')
      .split(/(?<=[。！？.!?])\s*/u)[0],
  };
}

/**
 * Read one immutable packet after the caller has waited for this project's
 * leave-triggered minutes. Revisions and exact input both identify the cache.
 * @param {import('../../core/index.js').Core} core
 * @param {string} projectId
 */
export async function readStarterInput(core, projectId) {
  const project = core.projects.get(projectId);
  const meetings = core.meetings
    .list({ projectId })
    .filter(
      (meeting) =>
        !meeting.temporary &&
        !meeting.attachedToMeetingId &&
        meeting.policy.respondent !== 'agent_assistant',
    )
    .sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
    )
    .slice(0, 3);
  const minutes = await Promise.all(
    meetings.map(async (meeting) => {
      const file = await core.workspace.read({ resource: 'minutes', key: meeting.id });
      return {
        id: meeting.id,
        title: meeting.title,
        text: file.text ?? '',
        revision: file.revisionId,
      };
    }),
  );
  const plans = await core.workspace.read({ resource: 'plans', key: projectId });
  const unfinished = unfinishedPlans(plans.text ?? '');
  const draft = core.versionCatalog
    .list(projectId)
    .flatMap((group) => (group.versions[0] ? [group.versions[0]] : []))
    .sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id),
    )[0];
  const experts = (
    await Promise.all(
      core.participants
        .list()
        .filter((person) => person.kind === 'ai')
        .map((person) => core.participants.get(person.id)),
    )
  )
    .map(expertOf)
    .sort((left, right) => left.id.localeCompare(right.id));
  const input = JSON.stringify({
    projectName: project.name,
    minutes: minutes.map(({ title, text }) => ({ title, text })),
    unfinishedPlans: unfinished,
    draft: draft ? { name: draft.name, number: draft.number } : null,
    experts,
    examples: starterExamples({
      project,
      draft: draft ? { name: draft.name, number: draft.number } : null,
      plan: unfinished[0] ?? null,
      participants: experts,
    }),
  });
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        instructions: STARTER_INSTRUCTIONS,
        projectId,
        minutes: minutes.map(({ id, revision }) => ({ id, revision })),
        plansRevision: plans.revisionId,
        draftId: draft?.id ?? null,
        input,
      }),
    )
    .digest('hex');
  return {
    meetingId: meetings[0]?.id ?? null,
    fingerprint,
    input,
    expertIds: experts.map((person) => person.id),
  };
}

/** @param {unknown} value @param {number} maximum */
function validText(value, maximum) {
  return (
    typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= maximum
  );
}

/**
 * Invalid model output leaves the caller's successful cache intact. No repair
 * request, truncation or missing-card fill is performed here.
 * @param {string} text
 * @param {string[]} expertIds
 * @returns {{progress:string,cards:Array<{icon:string,title:string,sub:string,text:string,expertId:string|null}>}}
 */
export function parseStarterResult(text, expertIds) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AppError('HOME_STARTERS_INVALID', '首页建议不是有效的 JSON。');
  }
  const invalid = () => {
    throw new AppError('HOME_STARTERS_INVALID', '首页建议的字段、长度或专家不符合要求。');
  };
  if (
    !value ||
    !validText(value.progress, 80) ||
    !Array.isArray(value.cards) ||
    value.cards.length !== 4
  )
    invalid();
  const experts = new Set(expertIds);
  const cards = value.cards.map((card) => {
    if (
      !card ||
      !STARTER_ICONS.includes(card.icon) ||
      !validText(card.title, 24) ||
      !validText(card.sub, 30) ||
      !validText(card.text, 200) ||
      card.text.includes('@') ||
      (card.expertId !== null && !experts.has(card.expertId))
    )
      invalid();
    return {
      icon: card.icon,
      title: card.title,
      sub: card.sub,
      text: card.text,
      expertId: card.expertId,
    };
  });
  return { progress: value.progress, cards };
}
