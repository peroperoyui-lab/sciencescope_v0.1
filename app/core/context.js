// Context assembly: what an AI participant is told when it speaks in a meeting.
// Pure functions over core data; see docs/architecture/CORE_MODEL.md §7.
//
// - Instructions: the participant's own definition, who is present, the project.
// - First turn in a meeting (or after its working memory was lost): the latest
//   minutes plus every message after them, verbatim.
// - Later turns: only the messages since this participant last spoke.
// Others see answers, not tool calls; an unadopted review stays out.

const VISIBLE_STATUSES = new Set(['done', 'max_tokens']);

/**
 * Retries of a question keep the input inserted into its earlier answer.
 * @param {import('./messages.js').Message[]} messages
 * @returns {Map<string,number>}
 */
export function steeringBoundaries(messages) {
  const answers = new Map(
    messages.filter((message) => message.turnId).map((message) => [message.turnId, message]),
  );
  const boundaries = new Map();
  for (const message of messages) {
    if (!message.refs?.steered) continue;
    const question = answers.get(message.refs.turnId)?.replyTo;
    if (question) boundaries.set(question, Math.max(boundaries.get(question) ?? 0, message.seq));
  }
  return boundaries;
}

/**
 * Messages other participants may see.
 * @param {import('./messages.js').Message[]} messages
 */
export function visibleMessages(messages) {
  return messages.filter(
    (message) => VISIBLE_STATUSES.has(message.status) && message.adopted !== false,
  );
}

/**
 * @param {{ participant: { id: string, name: string, definition?: { prompt: string } },
 *   meeting: { id?: string, title: string, policy: any },
 *   members: Array<{ id: string, name: string, kind: string, roleNote?: string }>,
 *   project: { id?: string, name: string, description: string, folder: string | null } | null,
 *   workFolder: string, projectBrief?:string }} input
 * @returns {string}
 */
export function buildInstructions({
  participant,
  meeting,
  members,
  project,
  workFolder,
  projectBrief,
}) {
  const others = members
    .filter((member) => member.id !== participant.id)
    .map((member) => {
      const kind = member.kind === 'human' ? '人' : 'AI';
      const note = member.roleNote ? `，${member.roleNote}` : '';
      return `- ${member.name}（${kind}${note}）`;
    });
  const lines = [
    participant.definition?.prompt ?? '',
    '',
    '## 这场会议',
    `- 你是：${participant.name}。记录里标为“${participant.name}”的发言是你自己说的。`,
    `- 会议：${meeting.title}${meeting.id ? `（id：${meeting.id}）` : ''}`,
  ];
  if (project) {
    const id = project.id ? `（id：${project.id}）` : '';
    const about = project.description ? `——${project.description}` : '';
    lines.push(`- 项目：${project.name}${id}${about}`);
    if (project.folder) lines.push(`- 用户的项目文件夹：${project.folder}`);
  } else {
    lines.push('- 这场会议不属于某个项目。');
  }
  lines.push(`- 工作文件夹：${workFolder}`);
  lines.push(others.length ? `- 在场的其他人：\n${others.join('\n')}` : '- 目前只有你在场。');
  lines.push(
    '',
    '## 工作方式',
    '- 会议记录、纪要、工作台（导图、计划、日志、版本说明）、笔记和专家定义都可以用 workspace_read 查阅，用 workspace_edit 修改；修改在本轮发言结束时保留为历史版本，用 workspace_versions 列出、查看或恢复；用 workspace_undo 改正本轮刚做的修改。',
    '- 需要向用户展示生成的文件时，用 workspace_present 提供文件路径与说明；图片和文档会显示在回答下方，文件原件会保存。',
    '- 需要了解更早的讨论时，用 workspace_read 查阅会议记录，不要凭印象。',
    '- 文稿用 workspace_read target=manuscript 按块读取，用 workspace_edit resource=manuscript 修改，不用 edit_file 改 docx/tex/md。只改划选或用户指定的范围，范围外的问题在回答里说；find 取足够长、在块内唯一的原文，⟦类型:编号 显示文字⟧ 原子记号及顺序原样保留。修改返回 chg_ 标识，可用 workspace_undo 逐处撤回；要存版本用 save to=version，写回项目文件用 save to=project，遇到外部修改或写回确认先告诉用户。回答只说明改了什么、为什么。',
    '- 秘书和全局助手按用户要求读文稿、比较、存版本，不主动改正文。初稿成形时可用 desk_suggest 提议进入编辑台，由用户决定。',
    // Answers are rendered as Markdown; without this hint models mostly write plain paragraphs.
    '- 回答会按 Markdown 显示：并列要点用列表，比较多个对象或数值时用表格，关键结论加粗；简单的回答不必套格式。',
  );
  if (projectBrief?.trim()) lines.push('', projectBrief);
  return lines.join('\n').trim();
}

/**
 * @param {import('./messages.js').Message[]} messages
 * @param {(id: string) => string} nameOf
 */
export function formatTranscript(messages, nameOf) {
  return messages
    .map((message) => {
      const cut = message.status === 'max_tokens' ? '\n（这条发言因达到模型输出上限而中断）' : '';
      const files = message.deliverables?.length
        ? '\n交付物：\n' +
          message.deliverables
            .map((file) => `- ${file.path}${file.description ? `：${file.description}` : ''}`)
            .join('\n')
        : '';
      return `【${nameOf(message.authorId)}】\n${message.text}${cut}${files}`;
    })
    .join('\n\n');
}

/**
 * Input for a participant's first turn: minutes and every later message.
 * @param {{ minutes: string | null, messages: import('./messages.js').Message[],
 *   nameOf: (id: string) => string }} input
 */
export function buildSeedInput({ minutes, messages, nameOf }) {
  const parts = [];
  if (minutes?.trim()) {
    parts.push(`以下是这场会议目前的纪要：\n\n${minutes.trim()}`);
    parts.push(`以下是纪要之后的全部发言：\n\n${formatTranscript(messages, nameOf)}`);
  } else {
    parts.push(`以下是这场会议到目前为止的全部发言：\n\n${formatTranscript(messages, nameOf)}`);
  }
  parts.push('请接着最后一条发言回应。');
  return parts.join('\n\n');
}

/**
 * Input for a later turn: the messages since this participant last spoke.
 * A single message from one person is passed as it is, with its author.
 * @param {{ messages: import('./messages.js').Message[], nameOf: (id: string) => string }} input
 */
export function buildFollowupInput({ messages, nameOf }) {
  if (messages.length === 1) return formatTranscript(messages, nameOf);
  return `自你上次发言以来的记录：\n\n${formatTranscript(messages, nameOf)}`;
}

/**
 * Participants addressed with @name in a message, in order of appearance.
 * @param {string} text
 * @param {Array<{ id: string, name: string }>} candidates
 * @returns {Array<{id:string,index:number,end:number}>}
 */
function participantMentions(text, candidates) {
  const found = [];
  const claimed = [];
  const overlaps = (start, end) => claimed.some(([from, to]) => start < to && end > from);
  // Longer names claim their span first, so "@统计审稿人" is not also "@统计".
  for (const candidate of [...candidates].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${candidate.name}`;
    for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
      if (overlaps(index, index + needle.length)) continue;
      claimed.push([index, index + needle.length]);
      found.push({ id: candidate.id, index, end: index + needle.length });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * Participants addressed with @name, preserving first appearance order.
 * @param {string} text
 * @param {Array<{id:string,name:string}>} candidates
 * @returns {string[]}
 */
export function mentionedParticipants(text, candidates) {
  return [...new Set(participantMentions(text, candidates).map((entry) => entry.id))];
}

/**
 * Multiple addressees get a shared preface and their own verbatim segments.
 * Consecutive mentions with only whitespace between them share the next segment.
 * @param {string} text
 * @param {Array<{id:string,name:string}>} candidates
 * @returns {Map<string,string>}
 */
export function mentionedInputs(text, candidates) {
  const mentions = participantMentions(text, candidates);
  const ids = [...new Set(mentions.map((entry) => entry.id))];
  if (ids.length < 2) return new Map(ids.map((id) => [id, text]));
  const prefix = text.slice(0, mentions[0].index).trim();
  const parts = new Map(ids.map((id) => [id, []]));
  let group = [];
  for (let index = 0; index < mentions.length; index++) {
    const mention = mentions[index];
    group.push(mention.id);
    const body = text.slice(mention.end, mentions[index + 1]?.index ?? text.length).trim();
    if (!body && index + 1 < mentions.length) continue;
    for (const id of new Set(group)) if (body) parts.get(id).push(body);
    group = [];
  }
  return new Map(ids.map((id) => [id, [prefix, ...parts.get(id)].filter(Boolean).join('\n\n')]));
}
