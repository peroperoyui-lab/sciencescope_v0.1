// Policy is enforced by DSH; this is only the desktop's control and projection.
export function createExecutionService({host,database,chatStore,bindings,onTurnPersisted=()=>{}}){
  const sql=database.db;
  sql.exec(`CREATE TABLE IF NOT EXISTS execution_sessions(chat_id TEXT PRIMARY KEY,mode TEXT NOT NULL,goal_json TEXT);`);
  const rows=new Map(),writes=new Map();
  function stored(id){const row=sql.prepare('SELECT * FROM execution_sessions WHERE chat_id=?').get(id);return row?{mode:row.mode,goal:row.goal_json?{...JSON.parse(row.goal_json),activation:'disarmed'}:null}:{mode:'ask',goal:null};}
  function persist(id,state){sql.prepare('INSERT OR REPLACE INTO execution_sessions VALUES(?,?,?)').run(id,state.mode,state.goal?JSON.stringify(state.goal):null);}
  function attach(id,binding){
    if(rows.has(id)&&rows.get(id).binding===binding)return rows.get(id);
    rows.get(id)?.unsubscribe?.();
    const state={...stored(id),binding,sessionId:binding.sessionId,approvals:new Map(),preview:'',automatic:false};rows.set(id,state);
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
      if(state.automatic&&event.type==='stream-start')state.preview='';
      if(state.automatic&&event.type==='text-delta')state.preview+=event.delta;
      if(state.automatic&&event.type==='committed-event'&&event.eventType==='assistant/message'&&event.data?.text){
        const task=(writes.get(id)||Promise.resolve()).then(async()=>{await chatStore.appendMessage({chatId:id,id:`runtime-${binding.sessionId}-${event.seq}`,role:'assistant',text:event.data.text,created:new Date(event.time||Date.now()).toISOString()});onTurnPersisted({chatId:id});});
        writes.set(id,task.catch(()=>{state.error='自动化结果保存失败，请暂停并检查本地存储。';}));state.preview='';
      }
    });
    return state;
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
  async function start(id,binding,objective,maxGoalRounds){
    if(maxGoalRounds!==undefined&&(!Number.isInteger(maxGoalRounds)||maxGoalRounds<1||maxGoalRounds>256))throw new TypeError('INVALID_GOAL_ROUND_LIMIT');
    const state=attach(id,binding);state.automatic=true;binding.goalActive=true;
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
  async function approve(id,requestId,allowed){const state=rows.get(id);if(!state?.approvals.has(requestId))throw new Error('APPROVAL_EXPIRED');await host.replyApproval({sessionId:state.sessionId,requestId,outcome:allowed?'allowed-once':'rejected'});state.approvals.delete(requestId);}
  function busy(id){return bindings.get(id)?.goalActive===true;}
  async function close(){for(const state of rows.values())state.unsubscribe?.();await Promise.allSettled(writes.values());}
  return {configure,status,start,action,approve,busy,snapshot,close};
}
