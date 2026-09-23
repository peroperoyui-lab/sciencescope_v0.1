// Opt-in paid check: several experts on different models answer one frozen
// prompt in parallel through DSH in-process subagents, then critique each other.
// Key: Git-ignored .sciencescope-local/secret/opencode.key. Usage:
//   node scripts/evals/expert-discussion-live.mjs [--rounds 2]
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';

const key=(await readFile('.sciencescope-local/secret/opencode.key','utf8')).trim();
const rounds=Number(process.argv[process.argv.indexOf('--rounds')+1]||2)||2;
const models=['deepseek-v4.1-flash','glm-5.3-flash','qwen3.8-flash','mimo-v2.6-flash'];
const experts=[
  {id:'methodologist',label:'方法学家',model:'glm-5.3-flash',persona:'You are the methodologist on a research panel. Check design validity: confounding, selection, measurement, causal claims versus what the design supports. Be concrete and cite the exact sentence you are criticising.'},
  {id:'statistician',label:'统计审稿人',model:'qwen3.8-flash',persona:'You are the statistical reviewer on a research panel. Always check sample size and power, multiple comparisons, effect sizes with intervals, model assumptions and data leakage. Name the specific statistic or number you are questioning.'},
  {id:'red-team',label:'魔鬼代言人',model:'mimo-v2.6-flash',persona:'You are the red-team member on a research panel. Argue the strongest alternative explanation for the reported result and state what evidence would distinguish it. Do not repeat generic caveats.'},
];
const study=`Draft abstract under review:
"We recruited 38 volunteers from a university running club and assigned them to a 6-week intermittent-fasting (IF) program; 40 non-club students formed the control group. We measured 24 blood biomarkers before and after. IF reduced fasting insulin (p = 0.041) and CRP (p = 0.048); the other 22 biomarkers showed no significant change. A random-forest model using post-intervention biomarkers predicted group membership with 91% accuracy (5-fold CV on all 78 participants after feature selection on the full dataset). We conclude that intermittent fasting causally improves metabolic health in young adults."`;
const task=`${study}

Give your independent assessment: the three most serious problems, each with why it matters and a concrete fix. Then a one-line overall verdict. Keep it under 350 words.`;

const base=path.resolve('.sciencescope-local/temp/eval');await mkdir(base,{recursive:true});
const root=await mkdtemp(path.join(base,'experts-'));
const runtimeConfig={providers:{live:{api:'openai-completions',baseURL:'https://opencode.ai/zen/go/v1',apiKeyEnv:'K',models:models.map(id=>({id,contextWindow:131072,maxTokens:16384}))}}};
const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-opencode-session'],env:{K:key}});
const transcript=[];
try{
  const sessionId=await host.startSession({model:{providerId:'live',modelId:'deepseek-v4.1-flash'},workspace:root,runtimeConfig});
  const panel=experts.map(e=>({id:e.id,label:e.label,persona:e.persona,model:{providerId:'live',modelId:e.model},tools:'none'}));
  let prompt=task;
  for(let round=1;round<=rounds;round++){
    const t=Date.now();const events=[];
    const result=await host.runExperts({sessionId,runId:`round${round}-${Date.now()}`,prompt,experts:panel,onEvent:e=>events.push(`${e.type}:${e.expertId}`)});
    console.log(`\n=== Round ${round} (${Math.round((Date.now()-t)/1000)}s, events: ${events.join(' ')})`);
    for(const r of result){const e=experts.find(x=>x.id===r.expertId);console.log(`\n--- ${e.label} [${e.model}] ${r.stopReason} ${Math.round(r.ms/1000)}s${r.diagnostic?' diag='+r.diagnostic:''}\n${r.text.slice(0,1800)}`);transcript.push({round,expert:e.label,model:e.model,...r});}
    const others=result.map(r=>`<expert name="${experts.find(x=>x.id===r.expertId).label}">\n${r.text}\n</expert>`).join('\n');
    prompt=`${study}\n\nThe panel answered independently:\n${others}\n\nCritique round: name the single most important point another expert raised that you missed or got wrong, state where you disagree with another expert and why, and give your revised top-three list. Under 300 words.`;
    for(const member of panel)member.prompt=`You are "${member.label}" on this panel; the block <expert name="${member.label}"> is your own previous answer. Refer to the others by their names.`;
  }
}finally{await host.close();}
await writeFile(path.join(base,'expert-discussion.last.json'),JSON.stringify(transcript,null,1));
await rm(root,{recursive:true,force:true});
