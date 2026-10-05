// Explicit opt-in: production application API -> DSH child -> cheap provider.
// Synthetic material only. The bound skill, not the user prompt, sets the format.
import assert from 'node:assert/strict';
import {createContextLiveHarness} from './context-live-harness.mjs';

const h=await createContextLiveHarness('reviewers-live',{maxRequests:8,maxTokens:2048});
try {
  const projectId='reviewer-evaluation', chatId='reviewer-evaluation-chat';
  await h.call('workspace',{projects:[{id:projectId,name:'独立审核技能验收',desc:'Synthetic reviewer acceptance only'}],pins:[],projectExpanded:{[projectId]:true}});
  await h.call('secretary/preferences',{summary:{afterDiscussion:false,everyMessages:{enabled:false,n:20},everyTokens:{enabled:false,n:30000},onEnterProject:false,onLeaveProject:false,saveMarkdown:false,workbench:{map:'off',versions:'off',plans:'off',log:'off'}}});
  const name='review-format';
  await h.call('skills/save',{markdown:`---\nname: ${name}\ndescription: Fixed format for a short independent review.\n---\nFor every review, start with T19_REVIEW. Include exactly these two section labels: Evidence: and Verdict:. Keep the entire review under 100 words. Do not use tools for this synthetic exercise.\n`});
  await h.call('experts',{experts:[
    {id:'analyst',kind:'expert',label:'Analyst',role:'Methods',persona:'Assess the supplied study briefly, using only its stated facts. Do not use tools.',enabled:true,model:h.model,skills:[]},
    {id:'independent-check',kind:'reviewer',label:'Independent check',role:'Review',persona:'Independently check the panel answers against the study facts. Do not simply repeat them. Use only the supplied material.',enabled:true,model:h.model,skills:[name]},
  ]});
  const events=await h.call('discussion',{chatId,projectId,model:h.model,kind:'ordered',expertIds:['analyst'],reviewerId:'independent-check',executionMode:'ask',userMessageId:'study-input',text:'Synthetic study: ten people per group. Control mean 2; treatment mean 3. Random assignment was not reported. Assess whether the difference establishes causation. Keep the answer brief and do not use tools.'});
  const answer=events.find(event=>event.type==='expert-end'&&event.expertId==='analyst');
  const review=events.find(event=>event.type==='expert-end'&&event.expertId==='independent-check');
  const stored=await h.call(`chats/${chatId}/messages`);
  h.evidence.answers={answer:answer?.text,review:review?.text};
  h.evidence.checks={
    participantCompleted:answer?.stopReason==='completed',
    reviewerCompleted:review?.stopReason==='completed',
    reviewRunsLast:events.findIndex(event=>event.type==='review-start')>events.indexOf(answer),
    boundFormat:!!review?.text?.startsWith('T19_REVIEW')&&/Evidence:/u.test(review.text)&&/Verdict:/u.test(review.text),
    noSkillLeakToParticipant:!answer?.text?.includes('T19_REVIEW'),
    persistedUnadopted:stored.messages.some(message=>message.id===review?.messageId&&message.expert?.review===true&&message.expert?.adopted===false),
    noToolCalls:!events.some(event=>event.type==='tool-call'),
    noProviderErrors:h.evidence.requests.every(request=>request.status===200),
    noBackgroundErrors:h.evidence.errors.length===0,
    noBudgetBlock:h.evidence.blocked===0,
  };
  h.evidence.checks.allPassed=Object.values(h.evidence.checks).every(Boolean);
  assert.equal(h.evidence.checks.allPassed,true,'Independent reviewer acceptance failed; see result.json');
}catch(error){h.evidence.failure={name:error.name,message:error.message};process.exitCode=1;}
finally{await h.close();}
