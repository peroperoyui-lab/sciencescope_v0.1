import { randomUUID } from 'node:crypto';
import { estimateTokens } from './context/estimate.mjs';

// Expert turns over the chat's DSH session. The host owns the agent loop
// (in-process subagents); this module owns prompts and records.
//
// Kinds (2026-09-24 revision; historical 'independent'/'critique' rounds stay
// readable but are no longer started):
// - 'ordered': a structured panel. Every selected expert receives the same
//   frozen input (conversation so far + project context + the new message),
//   answers independently and in parallel, and is shown in roster order. An
//   optional reviewer runs after all of them and checks their answers.
// - 'invited': experts @-named in an ordinary work-mode message answer it.
//
// What another participant sees of an answer is its final text and the files
// that answer presented to the user (DSH `present` deliverables: figures,
// documents), never its tool calls, tool results or tool preambles; files it
// only read or edited along the way are not listed. A reviewer's check enters
// later context only when the user adopts it.
// Experts see the secretary's minutes plus the conversation after them verbatim
// (2026-09-26: no token cap). Only if that verbatim part is enormous (minutes
// lagging far behind) are older messages left out, and the input says so.
const VERBATIM_CHARS = 240000;
const OVERLAP = 4; // messages before the minutes' coverage, kept for continuity
const MAX_FILES = 12;
const PRESENT_TOOLS = new Set(['present']);

export class DiscussionError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

const quoteAttr = (value) => String(value).replace(/"/g, "'").replace(/[\r\n]+/g, ' ');
const usable = reason => reason === 'completed' || reason === 'max-tokens';

// Files a completed `present` call declared as deliverables of its answer:
// [{path, description?}] from the call's (redacted) argument preview.
export function presentedFiles(call) {
  if (!call || !PRESENT_TOOLS.has(call.name) || call.isError || call.status !== 'completed') return [];
  let value = call.argumentsPreview;
  if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return []; } }
  const files = Array.isArray(value?.files) ? value.files : [];
  return files.filter((file) => typeof file?.path === 'string' && file.path && file.path.length <= 400)
    .map((file) => ({ path: file.path, ...(typeof file.description === 'string' && file.description.trim() ? { description: file.description.trim().slice(0, 200) } : {}) }));
}

export function identityPrompt(expert, { kind, participants }) {
  const others = participants.filter((item) => item.id !== expert.id).map((item) => `"${item.label}"`);
  const lines = [
    `You are "${expert.label}"${expert.role ? ` (${expert.role})` : ''}, an expert the user consults in this ScienceScope conversation.`,
    `Participants: the user (speaker "User"); the Main expert (speaker "Main expert"), the user's primary agent with its own tools and history${others.length ? `; the other experts ${others.join(', ')}` : ''}.`,
    `In the conversation below every message is labelled with its speaker. Only messages labelled "${expert.label}" are yours; speak only for yourself, never as the Main expert or another expert.`,
  ];
  if (kind === 'review') lines.push('You are the reviewing expert of this panel round. The experts\' answers for this round follow the user\'s message. For each answer check facts, evidence, methods and conclusions against the conversation and the material; name specific errors or unsupported claims per expert, note where they agree and disagree, then give an overall judgement. Do not simply restate the answers.');
  else if (kind === 'ordered') lines.push(`Panel consultation: ${participants.length} experts answer the user's message independently and in parallel. You cannot see the other experts' answers for this round; give your own assessment.`);
  else lines.push(`The user invited you (@${expert.label}) into their conversation with the Main expert to answer their latest message. Answer from your expertise; the Main expert and the user will read your answer.`);
  return lines.join('\n');
}

export function createDiscussionService({ host, chatStore, db, toolActivity, minutes = null, memoryGuide = '' }) {
  db.exec(`CREATE TABLE IF NOT EXISTS discussion_rounds(run_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL, question TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS discussion_rounds_chat ON discussion_rounds(chat_id, created_at);
    CREATE TABLE IF NOT EXISTS discussion_entries(chat_id TEXT NOT NULL, message_id TEXT NOT NULL, run_id TEXT NOT NULL, expert_id TEXT NOT NULL, label TEXT NOT NULL, role TEXT NOT NULL, model_json TEXT, stop_reason TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(chat_id, message_id));`);
  // review: reviewer entry; adopted: may enter later context; main_seen: already
  // handed to the Main expert's session.
  const columns = new Set(db.prepare('PRAGMA table_info(discussion_entries)').all().map((column) => column.name));
  // context_json: the expert's measured context at the end of its answer.
  for (const [name, definition] of [['review', 'INTEGER NOT NULL DEFAULT 0'], ['adopted', 'INTEGER NOT NULL DEFAULT 1'], ['main_seen', 'INTEGER NOT NULL DEFAULT 0'], ['context_json', 'TEXT']])
    if (!columns.has(name)) db.exec(`ALTER TABLE discussion_entries ADD COLUMN ${name} ${definition}`);
  db.exec(`CREATE TABLE IF NOT EXISTS discussion_continuations(chat_id TEXT NOT NULL,message_id TEXT NOT NULL,parent_session_id TEXT NOT NULL,child_session_id TEXT NOT NULL,expert_json TEXT NOT NULL,continued_from TEXT,continued_to TEXT,PRIMARY KEY(chat_id,message_id));`);
  if(!db.prepare('PRAGMA table_info(discussion_continuations)').all().some(column=>column.name==='environment_key'))db.exec('ALTER TABLE discussion_continuations ADD COLUMN environment_key TEXT');
  const active = new Map();

  function entriesFor(chatId, messageIds) {
    if (!messageIds.length) return new Map();
    const marks = messageIds.map(() => '?').join(',');
    const rows = db.prepare(`SELECT * FROM discussion_entries WHERE chat_id=? AND message_id IN (${marks})`).all(chatId, ...messageIds);
    const bindings = db.prepare('SELECT message_id,continued_from,continued_to FROM discussion_continuations WHERE chat_id=?').all(chatId);
    const links = new Map(bindings.map(row=>[row.message_id,row]));
    return new Map(rows.map((row) => [row.message_id, { runId: row.run_id, expertId: row.expert_id, label: row.label, role: row.role, model: row.model_json ? JSON.parse(row.model_json) : null, stopReason: row.stop_reason, position: row.position, review: row.review === 1, adopted: row.adopted === 1, mainSeen: row.main_seen === 1, canContinue:row.stop_reason==='max-tokens'&&links.has(row.message_id)&&!links.get(row.message_id).continued_to, continuedFrom:links.get(row.message_id)?.continued_from??null }]));
  }

  const filesOf = (chatId, messageIds) => {
    const files = new Map(messageIds.map((id) => [id, []]));
    if (!toolActivity || !messageIds.length) return files;
    for (let i = 0; i < messageIds.length; i += 500) {
      for (const call of toolActivity.list({ chatId, assistantMessageIds: messageIds.slice(i, i + 500), limit: 200 })) {
        const list = files.get(call.assistantMessageId);
        for (const file of presentedFiles(call)) if (!list.some((item) => item.path === file.path) && list.length < MAX_FILES) list.push(file);
      }
    }
    return files;
  };
  const speakerTag = (entry) => `speaker="${quoteAttr(entry.label)}"${entry.role ? ` role="${quoteAttr(entry.role)}"` : ''}`;
  // The answer as its peers see it: final text, then the files it presented.
  const answerBlock = (tag, text, files) => `<message ${tag}>\n${text}${files.length ? `\n[Files presented with this answer]\n${files.map((file) => `- ${file.path}${file.description ? ` — ${file.description}` : ''}`).join('\n')}` : ''}\n</message>`;
  const reviewText = (chatId,messageId,text) => {
    const pieces=[text],seen=new Set([messageId]);let current=messageId;
    for (;;) {
      const link=db.prepare('SELECT continued_from FROM discussion_continuations WHERE chat_id=? AND message_id=?').get(chatId,current);
      if(!link?.continued_from||seen.has(link.continued_from))break;
      const prior=db.prepare('SELECT m.text FROM messages m JOIN discussion_entries e ON e.chat_id=m.chat_id AND e.message_id=m.id WHERE m.chat_id=? AND m.id=? AND e.review=1').get(chatId,link.continued_from);
      if(!prior)break;pieces.unshift(prior.text);seen.add(link.continued_from);current=link.continued_from;
    }
    return pieces.length>1?`[Completed reviewer answer, including its earlier partial segments]\n${pieces.join('\n\n[Reviewer continuation]\n\n')}`:text;
  };

  // The conversation so far as every participant may see it: the secretary's
  // minutes of the whole conversation, then every later message verbatim (user,
  // Main expert, experts; unadopted reviews left out; presented files listed).
  // Messages are numbered so any earlier one can be read with chat_recall.
  function transcript(chatId) {
    if (!minutes) return '';
    const all = minutes.messagesAfter(chatId, 0);
    if (!all.length) return '';
    const record = minutes.get(chatId);
    const covered = record?.throughOrdinal ?? 0;
    let start = all.findIndex((message) => message.ordinal > covered);
    if (start < 0) start = all.length;
    start = Math.max(0, start - OVERLAP);
    const blocks = []; let used = 0, first = all.length;
    for (let index = all.length - 1; index >= start; index -= 1) {
      const state=db.prepare('SELECT stop_reason,review,adopted FROM discussion_entries WHERE chat_id=? AND message_id=?').get(chatId,all[index].id);
      const message=state?.review===1&&state.adopted===1?{...all[index],text:reviewText(chatId,all[index].id,all[index].text)}:all[index];
      const block = minutes.format(state?.stop_reason==='max-tokens'?{...message,text:`[Partial answer: output reached the model limit; unfinished.]\n${message.text}`}:message);
      if (blocks.length && used + block.length > VERBATIM_CHARS) break;
      blocks.push(block); used += block.length; first = index;
    }
    blocks.reverse();
    const parts = [];
    if (record) parts.push(`[Conversation minutes — kept by the secretary, revision ${record.revision}${record.author === 'user' ? ', edited by the user' : ''}, covering messages #1–#${record.throughOrdinal}]\n${record.text}\n[End of minutes]`);
    const omitted = first > 0 ? all[first - 1].ordinal : 0;
    const shown = blocks.length ? `#${all[first].ordinal}–#${all.at(-1).ordinal}` : '';
    const note = omitted ? ` Messages #1–#${omitted} are ${record && omitted <= record.throughOrdinal ? 'summarized in the minutes above' : 'not shown here'}; read any of them verbatim with chat_recall.` : '';
    if (blocks.length) parts.push(`[Conversation, verbatim: messages ${shown} of ${all.at(-1).ordinal}.${note}]\n${blocks.join('\n')}\n[End of conversation so far]`);
    const text = parts.join('\n\n');
    return `[Estimated context tokens: ${estimateTokens(text)}; estimate only, no token-based truncation]\n${text}`;
  }

  /**
   * @param {{chatId:string, sessionId:string, experts:object[], reviewer?:object|null, kind:'ordered'|'invited',
   *   context:string, requestText:string, userMessage:{id:string,text:string}, chatModel:object,
   *   onEvent:(event:object)=>void}} input
   */
  async function run({ chatId, sessionId, experts, reviewer = null, kind, context, requestText, userMessage, chatModel, environmentKey, onEvent }) {
    if (active.has(chatId)) throw new DiscussionError('DISCUSSION_BUSY', '这个对话的专家讨论仍在进行。', 409);
    if (kind !== 'ordered') reviewer = null;
    if (!Array.isArray(experts)) throw new DiscussionError('INVALID_EXPERTS', '参加者列表格式无效。');
    if (experts.some((expert) => expert.kind === 'reviewer')) throw new DiscussionError('REVIEWER_CANNOT_PARTICIPATE', '独立审核专家不能作为作答参加者。');
    if (experts.length > 8) throw new DiscussionError('TOO_MANY_EXPERTS', '每轮最多选择 8 位参加专家。');
    for (const expert of [...experts, ...(reviewer ? [reviewer] : [])]) {
      if (expert.boundSkills !== undefined && (!Array.isArray(expert.boundSkills) || expert.boundSkills.some((skill) => !skill || typeof skill.name !== 'string' || typeof skill.markdown !== 'string'))) {
        throw new DiscussionError('INVALID_EXPERT_SKILLS', '专家绑定技能格式无效。');
      }
    }
    experts = experts.filter((expert) => expert.id !== reviewer?.id);
    if (!experts.length) throw new DiscussionError('NO_EXPERTS', '请至少选择一位作答专家（审核专家不单独作答）。');
    const history = transcript(chatId);
    const shared = `${context}${history ? `${history}\n\n` : ''}[The user's new message]\n${requestText}`;

    const runId = `discussion-${randomUUID().replaceAll('-', '')}`;
    active.set(chatId, { runId, sessionId });
    try {
      await chatStore.appendMessage({ chatId, id: userMessage.id, role: 'user', text: userMessage.text });
      db.prepare('INSERT INTO discussion_rounds VALUES(?,?,?,?,?)').run(runId, chatId, kind, requestText, new Date().toISOString());
      const everyone = reviewer ? [...experts, reviewer] : experts;
      const ids = new Map(everyone.map((expert) => [expert.id, `msg-${randomUUID()}`]));
      const modelOf = (expert) => expert.model || chatModel;
      onEvent({ type: 'accepted', runId, kind, userMessageId: userMessage.id, experts: everyone.map((expert) => ({ id: expert.id, label: expert.label, role: expert.role, model: modelOf(expert), messageId: ids.get(expert.id), review: expert === reviewer })) });
      const writes = []; const texts = new Map(); const snapshots = new Map();
      const record = (entry) => {
        const expert = everyone.find((item) => item.id === entry.expertId);
        if (!expert) return;
        const text = entry.text || (entry.stopReason === 'aborted' ? '已停止，未生成回答。' : entry.stopReason==='max-tokens' ? '' : '本轮未生成回答。');
        const messageId = ids.get(expert.id); const review = expert === reviewer;
        if (usable(entry.stopReason) && entry.text) texts.set(expert.id, entry.stopReason === 'max-tokens' ? `[Partial answer: output reached the model limit; unfinished.]\n${entry.text}` : entry.text);
        writes.push(chatStore.appendMessage({ chatId, id: messageId, role: 'assistant', text }).then(() => {
          db.prepare('INSERT OR REPLACE INTO discussion_entries(chat_id,message_id,run_id,expert_id,label,role,model_json,stop_reason,position,review,adopted,main_seen,context_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?)')
            .run(chatId, messageId, runId, expert.id, expert.label, expert.role, JSON.stringify(modelOf(expert)), entry.stopReason, everyone.indexOf(expert), review ? 1 : 0, review ? 0 : 1, entry.context ? JSON.stringify(entry.context) : null);
          if(entry.childSessionId) {
            const snapshot=snapshots.get(expert.id);
            db.prepare('INSERT OR IGNORE INTO discussion_continuations(chat_id,message_id,parent_session_id,child_session_id,expert_json,environment_key) VALUES(?,?,?,?,?,?)').run(chatId,messageId,sessionId,entry.childSessionId,JSON.stringify(snapshot),environmentKey??null);
          }
        }));
        onEvent({ type: 'expert-end', runId, expertId: expert.id, messageId, text, stopReason: entry.stopReason, ms: entry.ms, review, canContinue:entry.stopReason==='max-tokens'&&!!entry.childSessionId });
      };
      const receipts = [];
      const forward = (seen) => (event) => {
        const messageId = ids.get(event.expertId);
        if (!messageId || seen.has(event.expertId)) return;
        if (event.type === 'expert-start') onEvent({ type: 'expert-start', runId, expertId: event.expertId, messageId });
        if (event.type === 'expert-delta' && typeof event.delta === 'string') onEvent({ type: 'expert-delta', runId, expertId: event.expertId, messageId, delta: event.delta });
        if (event.type === 'expert-reset') onEvent({ type: 'expert-reset', runId, expertId: event.expertId, messageId });
        if ((event.type === 'expert-tool' || event.type === 'expert-tool-result') && event.callId) {
          const call = { type: event.type === 'expert-tool' ? 'tool-call' : 'tool-result', callId: event.callId, ...(event.name ? { name: event.name } : {}), ...(event.argumentsPreview !== undefined ? { argumentsPreview: event.argumentsPreview } : {}), ...(event.resultPreview !== undefined ? { resultPreview: event.resultPreview } : {}), ...(event.preamble ? { preamble: event.preamble } : {}), ...(event.isError !== undefined ? { isError: event.isError } : {}) };
          if (toolActivity) receipts.push(toolActivity.record({ chatId, assistantMessageId: messageId, ...call }).catch(() => {}));
          onEvent({ runId, expertId: event.expertId, messageId, ...call });
        } else if (event.type === 'expert-tool') onEvent({ type: 'tool-call', runId, expertId: event.expertId, messageId, callId: `${event.expertId}-${Date.now()}`, name: event.name });
        if (event.type === 'expert-end') { seen.add(event.expertId); record(event); }
      };
      const expertSpec = (expert, prompt) => ({
        // The lookup rules are part of every expert's system prompt; its identity stays its own.
        id: expert.id, label: expert.label, persona: memoryGuide ? `${expert.persona}\n\n${memoryGuide}` : expert.persona, prompt,
        boundSkills: expert.boundSkills || [],
        ...(expert.model ? { model: expert.model } : {}),
        ...(expert.reasoningEffort ? { reasoningEffort: expert.reasoningEffort } : {}),
      });
      const runPanel = async (panelRunId, prompt, panel, promptFor) => {
        const seen = new Set();
        active.set(chatId, { runId: panelRunId, sessionId });
        const specs=panel.map(expert=>({...expertSpec(expert,promptFor(expert)),model:modelOf(expert)}));
        for(const spec of specs)snapshots.set(spec.id,JSON.parse(JSON.stringify(spec)));
        const result = await host.runExperts({ sessionId, runId: panelRunId, prompt, experts: specs, onEvent: forward(seen) });
        // Events are best-effort; the returned result is authoritative.
        for (const entry of result ?? []) if (!seen.has(entry.expertId)) { seen.add(entry.expertId); record(entry); }
        return result ?? [];
      };
      const results = await runPanel(runId, shared, experts, (expert) => identityPrompt(expert, { kind, participants: experts }));
      let failed = results.filter((entry) => !usable(entry.stopReason)).length;
      if (reviewer) {
        const answered = experts.filter((expert) => texts.has(expert.id));
        if (!answered.length || results.some((entry) => entry.stopReason === 'aborted')) {
          record({ expertId: reviewer.id, stopReason: results.some((entry) => entry.stopReason === 'aborted') ? 'aborted' : 'error', text: '没有可审核的专家回答，本轮未审核。' });
          failed += 1;
        } else {
          await Promise.all(writes);
          const answers = answered.map((expert) => `<answer ${speakerTag(expert, [])}>\n${texts.get(expert.id)}\n</answer>`).join('\n');
          onEvent({ type: 'review-start', runId, expertId: reviewer.id, messageId: ids.get(reviewer.id) });
          const reviewRun = await runPanel(`${runId}-review`, `${shared}\n\n[This round's expert answers]\n${answers}\n[End of this round's answers]`, [reviewer], (expert) => identityPrompt(expert, { kind: 'review', participants: [...experts, reviewer] }));
          failed += reviewRun.filter((entry) => !usable(entry.stopReason)).length;
        }
      }
      await Promise.all(writes); await Promise.all(receipts);
      if (toolActivity) for (const messageId of ids.values()) await toolActivity.settle({ chatId, assistantMessageId: messageId }).catch(() => {});
      onEvent({ type: 'completed', runId, failed });
      return { runId, failed };
    } finally { active.delete(chatId); }
  }

  async function cancel(chatId) {
    const current = active.get(chatId);
    if (!current) return { stopped: false };
    await host.cancelExperts({ sessionId: current.sessionId, runId: current.runId });
    return { stopped: true };
  }
  async function continueAnswer({chatId,messageId,sessionId,environmentKey,prompt='Continue your previous answer from where it stopped. Preserve its reasoning and complete the remaining work.',onEvent}) {
    if(active.has(chatId))throw new DiscussionError('DISCUSSION_BUSY','这个对话的专家讨论仍在进行。',409);
    const original=db.prepare('SELECT * FROM discussion_entries WHERE chat_id=? AND message_id=?').get(chatId,messageId);
    const binding=db.prepare('SELECT * FROM discussion_continuations WHERE chat_id=? AND message_id=?').get(chatId,messageId);
    if(!original||original.stop_reason!=='max-tokens'||!binding)throw new DiscussionError('EXPERT_NOT_CONTINUABLE','这份专家回答没有可继续的运行上下文。',409);
    if(binding.parent_session_id!==sessionId)throw new DiscussionError('EXPERT_PARENT_MISMATCH','专家上下文不属于当前主对话。',409);
    if(binding.environment_key!==null&&binding.environment_key!==(environmentKey??null))throw new DiscussionError('EXPERT_ENV_CHANGED','专家运行环境已更改。恢复原环境后可继续，或发起新的专家回答；原回答与运行历史保留。',409);
    if(binding.continued_to)throw new DiscussionError('EXPERT_ALREADY_CONTINUED','这份回答已继续；请使用后续回答。',409);
    if(typeof host.continueExpert!=='function')throw new DiscussionError('CONTINUATION_UNAVAILABLE','运行时暂不支持恢复这份专家回答。',503);
    const expert=JSON.parse(binding.expert_json),runId=`discussion-${randomUUID().replaceAll('-','')}`,answerId=`msg-${randomUUID()}`;
    active.set(chatId,{runId,sessionId});
    const receipts=[];let terminal;
    try {
      db.prepare('INSERT INTO discussion_rounds VALUES(?,?,?,?,?)').run(runId,chatId,'continued',prompt,new Date().toISOString());
      onEvent({type:'accepted',runId,kind:'continued',continuedFrom:messageId,experts:[{id:expert.id,label:original.label,role:original.role,model:JSON.parse(original.model_json),messageId:answerId,review:original.review===1}]});
      const result=await host.continueExpert({sessionId,runId,childSessionId:binding.child_session_id,expert,prompt,onEvent:event=>{
        if(event.type==='expert-end'){terminal=event;return;}
        const forwarded={...event,messageId:answerId};
        if(event.type==='expert-tool'||event.type==='expert-tool-result') {
          forwarded.type=event.type==='expert-tool'?'tool-call':'tool-result';
          if(toolActivity)receipts.push(toolActivity.record({chatId,assistantMessageId:answerId,...forwarded}).catch(()=>{}));
        }
        onEvent(forwarded);
      }});
      const entry=result??terminal;if(!entry)throw new Error('expert continuation returned no terminal result');
      const text=entry.text || (entry.stopReason==='aborted'?'已停止，未生成回答。':entry.stopReason==='max-tokens'?'':'本轮未生成回答。');
      await chatStore.appendMessage({chatId,id:answerId,role:'assistant',text});
      db.prepare('INSERT INTO discussion_entries(chat_id,message_id,run_id,expert_id,label,role,model_json,stop_reason,position,review,adopted,main_seen,context_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?)').run(chatId,answerId,runId,original.expert_id,original.label,original.role,original.model_json,entry.stopReason,original.position,original.review,original.review?0:1,entry.context?JSON.stringify(entry.context):null);
      db.prepare('INSERT INTO discussion_continuations(chat_id,message_id,parent_session_id,child_session_id,expert_json,continued_from,environment_key) VALUES(?,?,?,?,?,?,?)').run(chatId,answerId,sessionId,binding.child_session_id,binding.expert_json,messageId,binding.environment_key);
      if(usable(entry.stopReason))db.prepare('UPDATE discussion_continuations SET continued_to=? WHERE chat_id=? AND message_id=?').run(answerId,chatId,messageId);
      await Promise.all(receipts);await toolActivity?.settle({chatId,assistantMessageId:answerId});
      onEvent({type:'expert-end',runId,expertId:expert.id,messageId:answerId,text,stopReason:entry.stopReason,ms:entry.ms,review:original.review===1,continuedFrom:messageId,canContinue:entry.stopReason==='max-tokens'});
      const failed=usable(entry.stopReason)?0:1;onEvent({type:'completed',runId,failed});return {runId,failed,messageId:answerId};
    }finally{active.delete(chatId);}
  }

  // A reviewer's check joins later context only when the user adopts it. Once
  // the Main expert has received it, it cannot be withdrawn from that session.
  function adopt(chatId, messageId, adopted) {
    const row = db.prepare('SELECT * FROM discussion_entries WHERE chat_id=? AND message_id=?').get(chatId, messageId);
    if (!row || row.review !== 1) throw new DiscussionError('NOT_A_REVIEW', '只有审核专家的结论需要选择是否加入上下文。', 404);
    if (adopted && row.stop_reason !== 'completed') throw new DiscussionError('REVIEW_NOT_COMPLETED', '审核尚未完成，不能加入后续上下文。', 409);
    if (!adopted && row.main_seen === 1) throw new DiscussionError('ALREADY_SHARED', '主专家已读取这份审核结论，无法撤回；可在下一条消息中说明不采纳。', 409);
    db.prepare('UPDATE discussion_entries SET adopted=? WHERE chat_id=? AND message_id=?').run(adopted ? 1 : 0, chatId, messageId);
    return entriesFor(chatId, [messageId]).get(messageId);
  }

  // Expert answers the Main expert has not seen yet, as a block to put in front
  // of its next turn; `commit` marks them delivered once that turn is accepted.
  function pendingForMain(chatId) {
    const rows = db.prepare(`SELECT e.*, m.text, m.ordinal FROM discussion_entries e JOIN messages m ON m.chat_id=e.chat_id AND m.id=e.message_id
      WHERE e.chat_id=? AND e.adopted=1 AND e.main_seen=0 AND e.stop_reason IN ('completed','max-tokens') ORDER BY m.ordinal`).all(chatId);
    if (!rows.length) return { text: '', commit: () => {} };
    const files = filesOf(chatId, rows.map((row) => row.message_id));
    const blocks = rows.map((row) => answerBlock(speakerTag({ label: row.label, role: row.review ? `${row.role || ''} reviewer`.trim() : row.role }), `${row.stop_reason==='max-tokens'?'[Partial answer: output reached the model limit; unfinished.]\n':''}${row.review?reviewText(chatId,row.message_id,row.text):row.text}`, files.get(row.message_id) || []));
    const text = `[Expert messages in this conversation since your last turn. They were written by other participants, not by you; tool calls are not included.]\n${blocks.join('\n')}\n[End of expert messages]\n\n`;
    return { text, commit: () => { const mark = db.prepare('UPDATE discussion_entries SET main_seen=1 WHERE chat_id=? AND message_id=?'); for (const row of rows) mark.run(chatId, row.message_id); } };
  }

  // Latest measured context of each expert that has answered in this chat.
  function contexts(chatId) {
    const rows = db.prepare(`SELECT e.expert_id, e.label, e.role, e.model_json, e.context_json, e.review, r.created_at FROM discussion_entries e JOIN discussion_rounds r ON r.run_id=e.run_id
      WHERE e.chat_id=? AND e.context_json IS NOT NULL ORDER BY r.created_at DESC`).all(chatId);
    const seen = new Set(), out = [];
    for (const row of rows) {
      if (seen.has(row.expert_id)) continue; seen.add(row.expert_id);
      out.push({ expertId: row.expert_id, label: row.label, role: row.role, model: row.model_json ? JSON.parse(row.model_json) : null, context: JSON.parse(row.context_json), review: row.review === 1, at: row.created_at });
    }
    return out;
  }

  return { run, continueAnswer, cancel, adopt, entriesFor, pendingForMain, transcript, contexts, busy: (chatId) => active.has(chatId) };
}
