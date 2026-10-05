// T18 opt-in paid acceptance. Synthetic facts only; the application API and
// real DSH execute every Main turn, discussion, summary and plan proposal.
// Usage: node scripts/evals/summary-policy-live.mjs --live
import {createContextLiveHarness} from './context-live-harness.mjs';

if(!process.argv.includes('--live'))throw new Error('Paid evaluation requires explicit --live');

const run=await createContextLiveHarness('summary-policy-live',{maxRequests:40,maxTokens:4096});
const {call,model,evidence}=run;
// Fictional evaluation data only: retain these small structured replies for
// diagnosis. Production does not log model prompts or replies this way.
evidence.workbenchOutputs=[];
const send=run.host.send.bind(run.host);
run.host.send=async input=>{const result=await send(input);if(input.text.includes('工作站现状：'))evidence.workbenchOutputs.push(String(result.finalResponse??''));return result;};
const chatId='summary-policy-main';
const projectId='summary-policy-project';
const pendingTodo='核对预注册功效分析，并记录效应量假设';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const rows=value=>Array.isArray(value)?value:Array.isArray(value?.proposals)?value.proposals:Array.isArray(value?.items)?value.items:[];

async function state() {
  const [minutes,page,proposalValue,plansValue]=await Promise.all([
    call(`chats/minutes?chatId=${encodeURIComponent(chatId)}`),
    call(`chats/${encodeURIComponent(chatId)}/messages?limit=60`),
    call(`summary/proposals?chatId=${encodeURIComponent(chatId)}`),
    call('workbench/plans'),
  ]);
  return {minutes,page,proposals:rows(proposalValue),plans:Array.isArray(plansValue)?plansValue:plansValue?.plans??[]};
}

async function settle(label,predicate,{timeoutMs=240000}={}) {
  const deadline=Date.now()+timeoutMs;let previous='';let stable=0;let current;
  while(Date.now()<deadline){
    current=await state();
    const signature=JSON.stringify({revision:current.minutes.minutes?.revision??0,through:current.minutes.minutes?.throughOrdinal??0,updating:current.minutes.updating,proposals:current.proposals.length,requests:evidence.requests.length});
    if(predicate(current)&&!current.minutes.updating){stable=signature===previous?stable+1:0;if(stable>=2)return current;}else stable=0;
    previous=signature;await delay(2000);
  }
  throw new Error(`${label} did not settle before timeout: ${JSON.stringify({revision:current?.minutes?.minutes?.revision,through:current?.minutes?.minutes?.throughOrdinal,latest:current?.minutes?.latestMessage,proposals:current?.proposals?.length,requests:evidence.requests.length})}`);
}

try {
  const workspace=await call('workspace');
  await call('workspace',{...workspace,projects:[{id:projectId,name:'总结策略评测',desc:'仅含虚构验收数据'}]});

  const roles=await call('roles');
  const secretary=roles.roles.find(role=>role.role==='secretary');
  await call('roles/save',{role:'secretary',config:{prompt:secretary.prompt,model,reasoningEffort:null}});
  const roster=await call('experts');
  await call('experts',{experts:roster.experts.map(expert=>expert.id==='methodologist'?{...expert,enabled:true,model,reasoningEffort:null}:expert)});

  const preferences=await call('secretary/preferences');
  const defaultSummary=structuredClone(preferences.summary);
  const summary={...defaultSummary,workbench:{...defaultSummary.workbench,plans:'propose'}};
  await call('secretary/preferences',{notesTemplate:preferences.notesTemplate,summary});
  evidence.settings={default:defaultSummary,evaluated:summary};
  evidence.checks.defaultMessageThreshold=defaultSummary.everyMessages?.enabled===true&&defaultSummary.everyMessages?.n===20;
  evidence.checks.defaultDiscussionTrigger=defaultSummary.afterDiscussion===true;
  evidence.checks.onlyPlansChanged=JSON.stringify({...summary,workbench:{...summary.workbench,plans:'off'}})===JSON.stringify(defaultSummary);

  const facts=[
    '研究主题是虚构的六周运动干预。',
    '主要终点使用 Matsuda 胰岛素敏感性指数。',
    '对照组采用等待名单。',
    '纳入 18 至 30 岁志愿者。',
    '排除 BMI 大于 30 的志愿者。',
    '采血统一安排在早晨。',
    '所有时间戳使用 UTC。',
    '不会把相关性表述为因果关系。',
    '先核对基线平衡，再解释组间差异。',
    `唯一未完成待办：${pendingTodo}。`,
    '数据字典已经完成。尚未完成的功效分析应作为计划提议等待用户确认，不要创建其它待办。',
    `结论仍待上述待办完成；当前不要把“${pendingTodo}”标成已完成。`,
  ];
  for(const [index,fact] of facts.entries()){
    const events=await call('chat',{chatId,projectId,model,text:`${fact} 只回复“已记录”。`,userMessageId:`summary-user-${index+1}`,assistantMessageId:`summary-answer-${index+1}`});
    const answer=events.find(event=>event.type==='completed')?.text??'';
    evidence.turns.push({turn:index+1,answer:answer.slice(0,200)});
    console.log(`Main ${index+1}/12 completed`);
  }

  const beforeDiscussion=await settle('20-message summary',value=>(value.minutes.minutes?.revision??0)>=1&&(value.minutes.minutes?.throughOrdinal??0)>=20);
  evidence.beforeDiscussion={
    total:beforeDiscussion.page.total,
    rows:beforeDiscussion.page.messages.map((message,index)=>({position:index+1,id:message.id,role:message.role,expert:message.expert?.id??null})),
    minutes:{revision:beforeDiscussion.minutes.minutes?.revision,throughOrdinal:beforeDiscussion.minutes.minutes?.throughOrdinal},
    proposals:beforeDiscussion.proposals,
    forwardedRequests:evidence.requests.length,
  };
  evidence.checks.twelveRoundsAre24Messages=beforeDiscussion.page.total===24&&beforeDiscussion.page.messages.filter(message=>message.role==='user').length===12&&beforeDiscussion.page.messages.filter(message=>message.role==='assistant'&&!message.expert).length===12;

  const discussionText=`请作为方法学家确认当前唯一未完成待办是“${pendingTodo}”，并用一句话说明为什么不能标成完成。`;
  const discussionEvents=await call('discussion',{chatId,projectId,model,kind:'ordered',text:discussionText,expertIds:['methodologist'],userMessageId:'summary-discussion-user'});
  evidence.discussion={events:discussionEvents.filter(event=>!['text-delta','expert-delta','expert-reset'].includes(event.type)).map(event=>({type:event.type,expertId:event.expertId,stopReason:event.stopReason,messageId:event.messageId}))};

  const afterDiscussionPage=await call(`chats/${chatId}/messages?limit=60`);
  const discussionIndex=afterDiscussionPage.messages.findIndex(message=>message.id==='summary-discussion-user');
  const latestAfterDiscussion=afterDiscussionPage.total;
  const afterDiscussion=await settle('discussion summary and plan proposal',value=>(value.minutes.minutes?.revision??0)>(beforeDiscussion.minutes.minutes?.revision??0)&&(value.minutes.minutes?.throughOrdinal??0)>=latestAfterDiscussion&&value.proposals.length>=1);
  const proposalText=JSON.stringify(afterDiscussion.proposals);
  const minuteText=String(afterDiscussion.minutes.minutes?.text??'');
  evidence.afterDiscussion={
    total:afterDiscussion.page.total,
    discussionUserPosition:discussionIndex+1,
    rows:afterDiscussion.page.messages.map((message,index)=>({position:index+1,id:message.id,role:message.role,expert:message.expert?.id??null,review:Boolean(message.expert?.review)})),
    minutes:{revision:afterDiscussion.minutes.minutes?.revision,throughOrdinal:afterDiscussion.minutes.minutes?.throughOrdinal,text:minuteText},
    minutesHistory:afterDiscussion.minutes.history,
    proposals:afterDiscussion.proposals,
    actualPlans:afterDiscussion.plans,
    forwardedRequests:evidence.requests.length,
  };

  evidence.checks.discussionUserIsMessage25=discussionIndex===24&&afterDiscussionPage.messages[24]?.role==='user';
  evidence.checks.oneDiscussionExpertAnswer=afterDiscussionPage.messages.slice(25).filter(message=>message.expert).length===1;
  evidence.checks.minutesRevisionAtMost3=(afterDiscussion.minutes.minutes?.revision??Infinity)<=3;
  evidence.checks.minutesCoverDiscussion=(afterDiscussion.minutes.minutes?.throughOrdinal??0)>=latestAfterDiscussion;
  evidence.checks.minutesRetainPendingTodo=/预注册/.test(minuteText)&&/功效分析/.test(minuteText)&&/待|未完成|todo/i.test(minuteText);
  evidence.checks.planProposalMatchesTodo=afterDiscussion.proposals.some(proposal=>String(proposal.target??proposal.kind??'').includes('plan'))&&/预注册/.test(proposalText)&&/功效分析/.test(proposalText);
  evidence.checks.proposalDidNotApply=!afterDiscussion.plans.some(plan=>/预注册/.test(JSON.stringify(plan))||/功效分析/.test(JSON.stringify(plan)));
  evidence.checks.noRequestBudgetBlock=evidence.blocked===0&&evidence.requests.length<=40;
  evidence.checks.noBackgroundErrors=evidence.errors.length===0;
  evidence.checks.allPassed=Object.values(evidence.checks).every(Boolean);
  if(!evidence.checks.allPassed)process.exitCode=1;
} catch(error){evidence.failure={name:error.name,message:error.message};process.exitCode=1;} finally{await run.close();}
