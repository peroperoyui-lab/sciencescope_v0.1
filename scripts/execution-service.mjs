// Policy is enforced by DSH; this is only the desktop's control and projection.
export function createExecutionService({host,database,chatStore,bindings,onTurnPersisted=()=>{},onPythonEnvironmentRefreshReady=()=>{}}){
  const sql=database.db;
  sql.exec(`CREATE TABLE IF NOT EXISTS execution_sessions(chat_id TEXT PRIMARY KEY,mode TEXT NOT NULL,goal_json TEXT);`);
  const rows=new Map(),writes=new Map();
  function stored(id){const row=sql.prepare('SELECT * FROM execution_sessions WHERE chat_id=?').get(id);return row?{mode:row.mode,goal:row.goal_json?{...JSON.parse(row.goal_json),activation:'disarmed'}:null}:{mode:'ask',goal:null};}
  function persist(id,state){sql.prepare('INSERT OR REPLACE INTO execution_sessions VALUES(?,?,?)').run(id,state.mode,state.goal?JSON.stringify(state.goal):null);}
  function attach(id,binding){
    if(rows.has(id)&&rows.get(id).binding===binding)return rows.get(id);
    rows.get(id)?.unsubscribe?.();
    const state={...stored(id),binding,sessionId:binding.sessionId,approvals:new Map(),preview:'',automatic:false,turnEnds:new Map(),autoAssistantMessages:new Map(),lastRunIdleSequence:0};rows.set(id,state);
    state.unsubscribe=host.observeSession(binding.sessionId,frame=>{
      const event=frame.type==='control-event'?frame.event:frame;
      if(event.type==='session-event'&&event.eventType==='goal/change'){
        const change=event.data;
        state.goal=change.operation==='clear'?null:{...change.goal,roundsStarted:change.roundsStarted,createdAt:change.createdAt,updatedAt:change.updatedAt,activation:state.goal?.activation||'armed'};
        if(!state.goal||state.goal.phase!=='active')binding.goalActive=false;
        try{persist(id,state);}catch{state.error='目标状态同步失败；请检查本地存储。';}
      }
      if(event.type==='goal-activation'&&event.goal){if(state.goal)state.goal.activation=event.goal.activation;if(event.goal.activation==='disarmed')binding.goalActive=false;}
      if(event.type==='approval-request')state.approvals.set(event.requestId,event);
      if(event.type==='approval-cancelled')state.approvals.delete(event.requestId);
      if(event.type==='python-env-refresh-ready'&&event.goal&&event.sessionId===state.sessionId){
        state.goal={...event.goal,activation:'disarmed'};binding.goalActive=false;
        const refresh={goal:state.goal,turn:event.turn,source:event.source,turnEndSequence:state.turnEnds.get(event.turn)??null,idleSequence:state.lastRunIdleSequence,timer:null,finalizing:false};
        state.pythonEnvironmentRefresh=refresh;
        refresh.timer=setTimeout(()=>{
          if(state.pythonEnvironmentRefresh!==refresh)return;
          state.pythonEnvironmentRefresh=null;failPythonEnvironmentRefresh(id);
        },30000);
        refresh.timer.unref?.();
        maybeCompletePythonEnvironmentRefresh(id,state);
      }
      if(event.type==='python-env-refresh-failed'&&event.sessionId===state.sessionId)failPythonEnvironmentRefresh(id);
      if(event.type==='committed-event'&&event.eventType==='turn/end'&&Number.isSafeInteger(event.data?.turn)){
        state.turnEnds.set(event.data.turn,frame.sequence);
        while(state.turnEnds.size>8)state.turnEnds.delete(state.turnEnds.keys().next().value);
        if(state.automatic){
          const reason=event.data?.stopReason;
          const status=reason==='completed'?'completed':reason==='max-tokens'?'max-tokens':reason==='aborted'?'cancelled':'failed';
          const messageIds=state.autoAssistantMessages.get(event.data.turn)||[];
          const userMessageId=state.automaticUserMessageId;
          state.automaticUserMessageId=null;
          const task=(writes.get(id)||Promise.resolve()).then(async()=>{
            for(const messageId of messageIds)await chatStore.setMessageReceipt(id,messageId,{runtimeSeq:event.seq,completionStatus:status});
            if(userMessageId)await chatStore.setMessageReceipt(id,userMessageId,{runtimeSeq:event.seq,completionStatus:status});
            onTurnPersisted({chatId:id});
          });
          writes.set(id,task.catch(()=>{state.error='自动化轮次状态保存失败，请检查本地存储。';}));
          state.autoAssistantMessages.delete(event.data.turn);
        }
        const refresh=state.pythonEnvironmentRefresh;
        if(refresh&&refresh.turn===event.data.turn)refresh.turnEndSequence=frame.sequence;
        maybeCompletePythonEnvironmentRefresh(id,state);
      }
      if(frame.type==='run-idle'){
        if(Number.isSafeInteger(frame.sequence))state.lastRunIdleSequence=frame.sequence;
        const refresh=state.pythonEnvironmentRefresh;
        if(refresh&&Number.isSafeInteger(frame.sequence))refresh.idleSequence=frame.sequence;
        maybeCompletePythonEnvironmentRefresh(id,state);
      }
      if(state.automatic&&event.type==='stream-start')state.preview='';
      if(state.automatic&&event.type==='text-delta')state.preview+=event.delta;
      if(state.automatic&&event.type==='committed-event'&&event.eventType==='assistant/message'&&typeof event.data?.text==='string'){
        const messageId=`runtime-${binding.sessionId}-${event.seq}`;
        const turnMessages=state.autoAssistantMessages.get(event.data.turn)||[];turnMessages.push(messageId);state.autoAssistantMessages.set(event.data.turn,turnMessages);
        const task=(writes.get(id)||Promise.resolve()).then(async()=>{await chatStore.appendMessage({chatId:id,id:messageId,role:'assistant',text:event.data.text,created:new Date(event.time||Date.now()).toISOString(),completionStatus:'pending'});onTurnPersisted({chatId:id});});
        writes.set(id,task.catch(()=>{state.error='自动化结果保存失败，请暂停并检查本地存储。';}));state.preview='';
      }
    });
    return state;
  }
  function maybeCompletePythonEnvironmentRefresh(id,state){
    const refresh=state.pythonEnvironmentRefresh;
    if(!refresh||refresh.finalizing||refresh.turnEndSequence===null||refresh.idleSequence===null||refresh.idleSequence<=refresh.turnEndSequence)return;
    refresh.finalizing=true;
    clearTimeout(refresh.timer);
    void (async()=>{
      await writes.get(id);
      if(state.error==='自动化结果保存失败，请暂停并检查本地存储。')throw new Error('automatic turn output did not persist');
      await onPythonEnvironmentRefreshReady({chatId:id,sessionId:state.sessionId,goal:refresh.goal,source:refresh.source});
      if(state.pythonEnvironmentRefresh===refresh)state.pythonEnvironmentRefresh=null;
    })().catch(()=>{
      if(state.pythonEnvironmentRefresh===refresh)state.pythonEnvironmentRefresh=null;
      failPythonEnvironmentRefresh(id);
    });
  }
  async function configure(id,binding,mode){
    if(!['ask','full','auto'].includes(mode))throw new TypeError('INVALID_EXECUTION_MODE');
    const state=attach(id,binding);
    await host.configurePolicy({sessionId:binding.sessionId,approvalPolicy:mode==='full'?'never':'ask',sandboxMode:mode==='full'?'danger-full-access':'workspace-write'});
    state.mode=mode;if(mode!=='auto')state.automatic=false;persist(id,state);return state;
  }
  async function status(id){
    const state=rows.get(id);if(!state)return {...stored(id),approvals:[],preview:'',contextUsage:null};
    let contextUsage=null;
    if(bindings.has(id)){
      try{state.goal=await host.getGoal(state.sessionId)||null;if(!state.goal||state.goal.phase!=='active'||state.goal.activation!=='armed')bindings.get(id).goalActive=false;persist(id,state);}
      catch{state.error='运行时状态暂时不可用。';}
      try{contextUsage=typeof host.getContextUsage==='function'?await host.getContextUsage({sessionId:state.sessionId}):null;}catch{contextUsage=null;}
    }
    await writes.get(id);
    return {mode:state.mode,goal:state.goal,approvals:[...state.approvals.values()],preview:state.preview,error:state.error,contextUsage};
  }
  // Polling-safe, synchronous projection.  Unlike status(), this never asks
  // DSH for goal/context usage and never waits for persisted writes.
  function snapshot(id){
    const state=rows.get(id);
    if(!state) return {approvalCount:0, goalActive:false, goalPhase:null};
    const goal=state.goal;
    return {approvalCount:state.approvals.size, goalActive:bindings.get(id)?.goalActive===true || (goal?.phase==='active' && goal?.activation!=='disarmed'), goalPhase:goal?.phase==='active'&&goal?.activation==='disarmed'?'paused':goal?.phase||null};
  }
  async function start(id,binding,objective,maxGoalRounds,userMessageId){
    if(maxGoalRounds!==undefined&&(!Number.isInteger(maxGoalRounds)||maxGoalRounds<1||maxGoalRounds>256))throw new TypeError('INVALID_GOAL_ROUND_LIMIT');
    const state=attach(id,binding);state.automatic=true;state.automaticUserMessageId=userMessageId;binding.goalActive=true;
    try{state.goal=await host.sessionGoal({sessionId:binding.sessionId,objective,maxGoalRounds});persist(id,state);return state.goal;}
    catch(error){state.automatic=false;binding.goalActive=false;throw error;}
  }
  async function action(id,binding,action){
    const state=attach(id,binding),goal=await host.getGoal(binding.sessionId);
    if(!goal)throw new Error('NO_GOAL');
    const ref={id:goal.id,revision:goal.revision};
    if(action==='pause'){state.goal=await host.pauseGoal({sessionId:binding.sessionId,ref});binding.goalActive=false;}
    else if(action==='resume'){state.automatic=true;binding.goalActive=true;state.goal=await host.resumeGoal({sessionId:binding.sessionId,ref});}
    else if(action==='stop'){
      const paused=goal.phase==='active'?await host.pauseGoal({sessionId:binding.sessionId,ref}):goal;
      await host.clearGoal({sessionId:binding.sessionId,ref:{id:paused.id,revision:paused.revision}});
      state.goal=null;binding.goalActive=false;state.preview='';
    }else throw new Error('INVALID_GOAL_ACTION');
    persist(id,state);return status(id);
  }
  async function resumeAfterPythonEnvironmentRefresh(id,binding,ref){
    const state=attach(id,binding),goal=await host.getGoal(binding.sessionId);
    if(!goal||goal.id!==ref?.id||goal.revision!==ref?.revision||goal.phase!=='paused')return false;
    try{
      state.goal=await host.resumeGoal({sessionId:binding.sessionId,ref:{id:ref.id,revision:ref.revision}});
      state.automatic=true;binding.goalActive=true;state.error=undefined;persist(id,state);return true;
    }catch(error){
      state.automatic=false;binding.goalActive=false;
      if(error?.code==='GOAL_STALE_REVISION')return false;
      throw error;
    }
  }
  async function approve(id,requestId,allowed){
    const state=rows.get(id);if(!state?.approvals.has(requestId))throw new Error('APPROVAL_EXPIRED');
    try{await host.replyApproval({sessionId:state.sessionId,requestId,outcome:allowed?'allowed-once':'rejected'});}
    finally{state.approvals.delete(requestId);}
  }
  function failPythonEnvironmentRefresh(id){const state=rows.get(id);if(!state)return;state.error='Python 环境切换未完成；自动化目标已暂停，请检查环境后手动继续。';try{persist(id,state);}catch{}}
  async function waitForTurnWrites(id){await writes.get(id);}
  function busy(id){return bindings.get(id)?.goalActive===true;}
  async function close(){for(const state of rows.values())state.unsubscribe?.();await Promise.allSettled(writes.values());}
  return {configure,status,start,action,resumeAfterPythonEnvironmentRefresh,approve,busy,snapshot,failPythonEnvironmentRefresh,waitForTurnWrites,close};
}
