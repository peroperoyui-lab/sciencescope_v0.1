// Only durable research meetings contribute to this projection. Assistant and
// secretary private chats stay separate; details remain available via shared tools.
import { createHash } from 'node:crypto';

/**
 * @param {string} text
 * @returns {string}
 */
export function overviewHash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function minutesGoals(text) {
  if (!/^#{1,6}\s/mu.test(text)) return text.trim();
  const sections = text.split(/(?=^#{1,6}\s)/mu);
  return (
    sections
      .filter((section) =>
        /^(?:#{1,6})\s.*(?:目标|研究问题|待办|下一步|goal|question|to.?do|next step)/imu.test(
          section,
        ),
      )
      .join('\n')
      .trim() || text.trim()
  );
}

/**
 * @param {import('../../core/index.js').Core} core
 * @returns {Promise<string>}
 */
export async function workspaceOverview(core) {
  const projects = core.projects
    .list()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const meetings = core.meetings
    .list()
    .filter(
      (meeting) =>
        !meeting.temporary &&
        !meeting.attachedToMeetingId &&
        meeting.policy.respondent !== 'agent_assistant',
    );
  const blocks = [
    '## 工作区概览',
    '项目、会议和工作站可用 workspace_read 按 id 查阅；只记录已保存的研究状态。',
  ];
  for (const project of projects) {
    const plans = await core.workspace.read({ resource: 'plans', key: project.id });
    const map = await core.workspace.read({ resource: 'map', key: project.id });
    const recent = meetings
      .filter((meeting) => meeting.projectId === project.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const minutes = [];
    for (const meeting of recent) {
      const memo = await core.workspace.read({ resource: 'minutes', key: meeting.id });
      const goals = minutesGoals(memo.text ?? '');
      minutes.push(
        `- [${meeting.title}](#/meeting/${meeting.id})（id：${meeting.id}）${goals ? '\n' + goals : ''}`,
      );
    }
    blocks.push(
      `### [${project.name}](#/workbench/${project.id})（id：${project.id}）\n${project.description}\n计划：\n${plans.text ?? ''}\n导图要点：\n${(map.value?.nodes ?? []).map((node) => '- ' + node.text).join('\n')}\n最近会议及纪要目标 / 待办：\n${minutes.join('\n\n')}`,
    );
  }
  const independent = meetings.filter((meeting) => !meeting.projectId);
  if (independent.length)
    blocks.push(
      '## 独立研究会议\n' +
        independent
          .map((meeting) => `- [${meeting.title}](#/meeting/${meeting.id})（id：${meeting.id}）`)
          .join('\n'),
    );
  return blocks.join('\n\n');
}
