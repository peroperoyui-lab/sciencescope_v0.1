import { randomUUID } from 'node:crypto';

export class ChatBranchError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const unknown = () => new ChatBranchError('BRANCH_POINT_UNKNOWN', '这条较早的消息无法作为分支点。');
const completedMain = message => message.role === 'assistant' && message.completionStatus === 'completed' && Number.isSafeInteger(message.runtimeSeq);

// DSH owns model history. This service copies only the app's prefix projection,
// settings and draft; the child's durable runtime is created by host.forkSession.
export function createChatBranching({chatStore, database, host, execution, bindings, roleSettings, startContextSession, conversations, researchDrafts, restoreExecution}) {
  const db = database.db;
  const hasDiscussion = () => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discussion_entries'").get();
  function entries(chatId) {
    return hasDiscussion() ? new Map(db.prepare('SELECT * FROM discussion_entries WHERE chat_id=?').all(chatId).map(row => [row.message_id, row])) : new Map();
  }
  function completion(message, expertRows) {
    const expert = expertRows.get(message.id);
    return expert ? expert.stop_reason === 'completed' : message.completionStatus === 'completed';
  }
  function priorMain(chatId, ordinal, expertRows) {
    return db.prepare("SELECT id,ordinal,runtime_seq AS runtimeSeq,completion_status AS completionStatus,role FROM messages WHERE chat_id=? AND ordinal<? AND role='assistant' AND runtime_seq IS NOT NULL AND completion_status='completed' ORDER BY ordinal DESC")
      .all(chatId, ordinal).find(row => !expertRows.has(row.id));
  }
  function modeFor(chatId, message) {
    const expertRows = entries(chatId);
    if (!completion(message, expertRows)) return null;
    if (message.role === 'assistant') {
      if(expertRows.has(message.id))return priorMain(chatId,message.ordinal,expertRows)?'reply':null;
      // Automatic tool loops may persist several text steps in the same turn.
      // Only the final reply represents the complete runtime boundary.
      const laterStep=completedMain(message)&&db.prepare("SELECT 1 FROM messages WHERE chat_id=? AND role='assistant' AND runtime_seq=? AND ordinal>? LIMIT 1").get(chatId,message.runtimeSeq,message.ordinal);
      return completedMain(message)&&!laterStep?'reply':null;
    }
    if (message.role === 'user' && (message.ordinal === 0 || priorMain(chatId, message.ordinal, expertRows))) return 'reask';
    return null;
  }
  function copyPresentation({sourceId, childId, prefix, expertRows, draftMessageId, mode, persona, pythonChoice}, messageIds) {
    db.prepare('INSERT INTO execution_sessions(chat_id,mode,goal_json) VALUES(?,?,NULL)').run(childId, mode);
    db.prepare('INSERT INTO role_bindings(chat_id,role,prompt,revision) VALUES(?,?,?,?)').run(childId, 'main', persona.prompt, persona.revision);
    if (pythonChoice) db.prepare('INSERT INTO python_env_bindings(scope,target_id,env_id,updated_at) VALUES(?,?,?,?)').run('chat', childId, pythonChoice.env_id, new Date().toISOString());
    const runs = new Map();
    for (const message of prefix) {
      const target = messageIds.get(message.id);
      db.prepare('INSERT INTO research_input_receipts(chat_id,message_id,payload) SELECT ?,?,payload FROM research_input_receipts WHERE chat_id=? AND message_id=?').run(childId, target, sourceId, message.id);
      db.prepare(`INSERT INTO tool_activity(chat_id,assistant_message_id,call_id,turn,step,name,status,is_error,arguments_preview,result_preview,preamble,updated_at)
        SELECT ?,?,call_id,turn,step,name,status,is_error,arguments_preview,result_preview,preamble,updated_at FROM tool_activity WHERE chat_id=? AND assistant_message_id=?`).run(childId, target, sourceId, message.id);
      const expert = expertRows.get(message.id);
      if (!expert) continue;
      let runId = runs.get(expert.run_id);
      if (!runId) {
        runId = `branch-${randomUUID()}`; runs.set(expert.run_id, runId);
        db.prepare('INSERT INTO discussion_rounds(run_id,chat_id,kind,question,created_at) SELECT ?,?,kind,question,created_at FROM discussion_rounds WHERE run_id=?').run(runId, childId, expert.run_id);
      }
      const seen = expert.main_seen && prefix.some(row => row.ordinal > message.ordinal && completedMain(row) && !expertRows.has(row.id));
      db.prepare(`INSERT INTO discussion_entries(chat_id,message_id,run_id,expert_id,label,role,model_json,stop_reason,position,review,adopted,main_seen,context_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(childId, target, runId, expert.expert_id, expert.label, expert.role, expert.model_json, expert.stop_reason, expert.position, expert.review, expert.adopted, seen ? 1 : 0, expert.context_json);
    }
    const snapshot = draftMessageId && researchDrafts.receipt(sourceId, draftMessageId);
    if (snapshot) researchDrafts.save('main', childId, snapshot);
  }
  function visiblePrefix(messages, expertRows, selected, mode) {
    // The same contiguous-discussion ordering used by the messages API.
    const visible = [...messages];
    for (let start = 0; start < visible.length;) {
      const run = expertRows.get(visible[start].id)?.run_id; let end = start + 1;
      if (run) while (end < visible.length && expertRows.get(visible[end].id)?.run_id === run) end++;
      if (end > start + 1) visible.splice(start, end - start, ...visible.slice(start, end).sort((a,b) => expertRows.get(a.id).position - expertRows.get(b.id).position));
      start = end;
    }
    const index = visible.findIndex(row => row.id === selected.id);
    return visible.slice(0, index + (mode === 'reply' ? 1 : 0));
  }
  async function branch({sourceId, messageId, mode}) {
    const source = chatStore.getChat(sourceId), selected = chatStore.getMessage(sourceId, messageId);
    if (!source || source.deletedAt || conversations.isAssistant(sourceId)) throw new ChatBranchError('CHAT_NOT_FOUND', '主对话不存在。', 404);
    if (!selected || modeFor(sourceId, selected) !== mode) throw unknown();
    const expertRows = entries(sourceId);
    const messages = db.prepare('SELECT id,role,text,created,ordinal,runtime_seq AS runtimeSeq,completion_status AS completionStatus FROM messages WHERE chat_id=? ORDER BY ordinal').all(sourceId);
    const user = selected.role === 'user' ? selected : messages.findLast(row => row.role === 'user' && row.ordinal < selected.ordinal);
    const first = mode === 'reask' && selected.ordinal === 0;
    const boundary = mode === 'reply' && !expertRows.has(selected.id) ? selected : priorMain(sourceId, selected.ordinal, expertRows);
    if (!first && !boundary) throw unknown();
    const prefix = first ? [] : visiblePrefix(messages, expertRows, selected, mode);
    const childId = `chat-${randomUUID()}`;
    const branchedFrom = {chatId: sourceId, messageId, title: source.title};
    const draftText = user?.text || '';
    const state = await execution.status(sourceId);
    const persona = roleSettings.getBinding(sourceId) || roleSettings.bind(sourceId, 'main', {existing: true});
    const pythonChoice = db.prepare("SELECT env_id FROM python_env_bindings WHERE scope='chat' AND target_id=?").get(sourceId);
    let sessionId;
    try {
      if (!first) {
        const binding = await restoreExecution(sourceId);
        const turns = await host.sessionTurns({sessionId: binding.sessionId});
        if (!turns.turns?.some(turn => turn.endSeq === boundary.runtimeSeq)) throw unknown();
        const fork = await host.forkSession({sessionId: binding.sessionId, atSeq: boundary.runtimeSeq});
        sessionId = typeof fork === 'string' ? fork : fork?.sessionId;
        if (!sessionId || (fork?.boundarySeq !== undefined && fork.boundarySeq !== boundary.runtimeSeq)) throw unknown();
      }
      await chatStore.branchPrefix({sourceChatId: sourceId, newChatId: childId, title: `分支：${source.title}`, projectId: source.projectId, model: source.model,
        runtimeWorkspace: chatStore.getRuntimeWorkspace(sourceId), branchedFrom, messages: prefix, draft: draftText, reasoningEffort: source.reasoningEffort,
        copyPresentation: messageIds => copyPresentation({sourceId,childId,prefix,expertRows,draftMessageId:user?.id,mode:state.mode,persona,pythonChoice},messageIds)});
      if (sessionId) {
        await startContextSession({model: {...source.model, ...(source.reasoningEffort ? {reasoningEffort: source.reasoningEffort} : {})},
          workspace: chatStore.getRuntimeWorkspace(sourceId), runtimeConfig: await host.getRuntimeConfig?.(), sessionId, persona: persona.prompt},
        {role:'main',chatId:childId,mainChatId:childId,projectId:source.projectId ?? null});
        const binding = {sessionId,modelKey:JSON.stringify(source.model),lastUsed:Date.now()}; bindings.set(childId,binding);
        await chatStore.markRuntimeBinding(childId,sessionId,chatStore.getRuntimeWorkspace(sourceId));
        // Seeded logs can contain a prior automatic objective. Preserve its
        // historical events, but require a fresh explicit goal on the child.
        const inheritedGoal=await host.getGoal(sessionId);
        if(inheritedGoal){
          const paused=inheritedGoal.phase==='active'?await host.pauseGoal({sessionId,ref:{id:inheritedGoal.id,revision:inheritedGoal.revision}}):inheritedGoal;
          await host.clearGoal({sessionId,ref:{id:paused.id,revision:paused.revision}});
        }
        await execution.configure(childId,binding,state.mode);
        await host.configureReasoning({sessionId,reasoningEffort:source.reasoningEffort});
      }
      return {chat:chatStore.getChat(childId),draftText};
    } catch (error) {
      bindings.delete(childId);
      if (sessionId) await host.releaseSession(sessionId).catch(()=>{});
      if (chatStore.getChat(childId)) await chatStore.remove(childId);
      throw error;
    }
  }
  return {branch,modeFor};
}
