// T17 paid acceptance, explicit --live only. Synthetic research facts only.
import {createContextLiveHarness} from './context-live-harness.mjs';
const run=await createContextLiveHarness('context-access-live');
const {call,model,evidence}=run;
try {
  const workspace=await call('workspace');
  await call('workspace',{...workspace,projects:[{id:'context-project-a',name:'语境评测甲',desc:'仅用于隔离评测'},{id:'context-project-b',name:'语境评测乙',desc:'仅用于隔离评测'}]});
  const facts=['本任务研究跑步干预。','研究周期是六周。','第3轮确定：主要终点为 Matsuda 胰岛素敏感性指数。','对照组使用等待名单。','先按每组40人规划。','纳入18至30岁志愿者。','排除BMI超过30者。','采血统一在早晨。','数据库中的时间统一UTC。','缺失值方案仍待审议。','数据字典由方法专家复核。','不会把相关性当作因果证据。','研究材料仅为虚构测试数据。','先检查基线平衡。','软件脚本版本写入说明。','不发布参与者标识。','敏感性分析尚未开始。','待办：核对功效分析。','进展：方案讨论完成，分析未开始。','下一步仍是核对功效分析，不是撰写结论。'];
  for(const [i,fact] of facts.entries()){
    const events=await call('chat',{chatId:'context-main-a',projectId:'context-project-a',model,text:fact+' 不调用工具，只简短回答“已记录”。',userMessageId:'u'+i,assistantMessageId:'a'+i});
    evidence.turns.push({i:i+1,answer:events.find(event=>event.type==='completed')?.text});
    console.log('Main turn '+(i+1)+'/20 completed');
  }
  const wb=await call('workbench?projectId=context-project-a');
  await call('workbench/save',{projectId:'context-project-a',revision:wb.revision,map:{...wb.map,nodes:[{id:'protocol',text:'研究方案',status:'done',parent:null},{id:'analysis',text:'功效分析',status:'pending',parent:'protocol'}]}});
  await call('workbench/plans',{plans:[{id:'power',title:'核对功效分析',project:'语境评测甲',done:false}]});
  const sec=await call('assistant/chat',{scope:'secretary',ownerId:'context-main-a',model,text:'对话现在进行到哪一步了？第3轮定的主要终点是什么？现在导图哪些节点还没完成？请简短、按记录回答。'});
  const answer=sec.find(event=>event.type==='completed')?.text??'';
  evidence.secretary={answer,followUp:(await call('assistant?scope=secretary&ownerId=context-main-a')).followUp};
  evidence.checks.secretaryEndpoint=/Matsuda/i.test(answer);
  evidence.checks.secretaryProgress=/功效分析/.test(answer)&&/未|待|pending|尚/.test(answer);
  evidence.checks.catchUp=evidence.secretary.followUp.seenOrdinal>=40;
  await call('chat',{chatId:'context-main-b',projectId:'context-project-b',model,text:'这里只是另一个项目。只回答“已记录”。'});
  const global=await call('assistant/chat',{scope:'global',ownerId:'global',model,contextChatId:'context-main-b',text:'虽然现在聚焦语境评测乙，请查阅语境评测甲的待办和未完成导图节点，简短回答。必要时用上下文工具。'});
  evidence.globalAnswer=global.find(event=>event.type==='completed')?.text??'';
  evidence.checks.crossProject=/功效分析/.test(evidence.globalAnswer);
  evidence.checks.allPassed=Object.values(evidence.checks).every(Boolean);
  if(!evidence.checks.allPassed)process.exitCode=1;
} catch(error){evidence.failure={name:error.name,message:error.message};process.exitCode=1;} finally{await run.close();}
