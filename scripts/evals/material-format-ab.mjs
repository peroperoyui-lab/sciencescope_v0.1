// Opt-in paid A/B: legacy JSON-escaped material vs tagged blocks, same questions.
// Key: Git-ignored .sciencescope-local/secret/opencode.key. Env: MODEL, REP.
// Usage: REP=5 node scripts/evals/material-format-ab.mjs
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDshHost} from '../../adapters/runtime-dsh/host.mjs';
import {renderResearchMaterial} from '../research-input.mjs';
const key=(await readFile('.sciencescope-local/secret/opencode.key','utf8')).trim();
const modelId=process.env.MODEL||'deepseek-v4.1-flash';
// deterministic synthetic material
let seed=7;const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648);
const eqs=[];let tex='\\section{Methods}\n';
for(let i=1;i<=60;i++){const a=(rnd()*9+1).toFixed(2),b=Math.floor(rnd()*7)+2;const eq=`\\hat{\\beta}_{${i}} = \\frac{\\sum_{j=1}^{n} (x_{j}-\\bar{x})(y_{j}-\\bar{y})}{${a}\\,\\sigma_{x}^{${b}} + \\lambda\\|\\mathbf{w}\\|_{2}^{2}}`;eqs.push(eq);
 tex+=`We estimate the effect in stage ${i} with "robust" weights, as follows:\n\\begin{equation}\\label{eq:${i}}\n${eq}\n\\end{equation}\nwhere \\(\\lambda\\) is tuned by 10-fold CV on the \\texttt{train\\_${i}} split.\n\n`;}
const rows=['sample,treatment,response,note'];const csv={};
for(let i=1;i<=700;i++){const id='S'+String(i).padStart(3,'0');const t=rnd()<.5?'A':'B';const r=rnd().toFixed(4);const note=`"batch ${Math.floor(rnd()*9)}, ""flagged"" by QC-${Math.floor(rnd()*90+10)}"`;rows.push(`${id},${t},${r},${note}`);csv[id]={t,r,note:note.slice(1,-1).replaceAll('""','"')};}
const attachments=[{id:'res-tex',name:'methods.tex',path:'/project/methods.tex',text:tex,truncated:false},{id:'res-csv',name:'samples.csv',path:'/project/samples.csv',text:rows.join('\n'),truncated:false}];
const legacy=JSON.stringify({attachments,attachmentIds:['res-tex','res-csv'],messageQuotes:[],annotations:[],annotationResources:{},contextRefs:[]});
const tagged=renderResearchMaterial({attachments});
const wrap=m=>`[User-provided research material]\n${m}\n[End user-provided research material]\n`;
const qs=[
 {q:'From methods.tex, reproduce the LaTeX body of equation \\label{eq:17} exactly, character for character, inside a single ```latex code block and nothing else.',check:t=>(t.match(/```latex\s*([\s\S]*?)```/)?.[1]||'').replace(/\\begin\{equation\}|\\end\{equation\}|\\label\{eq:17\}/g,'').replace(/\s+/g,'')===eqs[16].replace(/\s+/g,'')},
 {q:'From samples.csv, what is the response value for sample S587? Answer with just the number.',check:t=>t.includes(csv.S587.r)},
 {q:'From samples.csv, give the note field of sample S458 exactly as it reads after CSV unquoting, and nothing else.',check:t=>t.includes(csv.S458.note)},
 {q:'From samples.csv, which treatment did sample S641 receive? Answer with one letter.',check:t=>(t.match(/\b([AB])\b/)?.[1])===csv.S641.t},
];
const root=await (await import('node:fs/promises')).mkdir(path.resolve('.sciencescope-local/temp/eval'),{recursive:true}).then(()=>mkdtemp(path.resolve('.sciencescope-local/temp/eval/run-')));
const runtimeConfig={providers:{live:{api:'openai-completions',baseURL:'https://opencode.ai/zen/go/v1',apiKeyEnv:'K',models:[{id:modelId,contextWindow:262144,maxTokens:2048}]}}};
const host=await createDshHost({home:root,cwd:root,sessionHeaders:['x-opencode-session'],env:{K:key}});
const REP=Number(process.env.REP||3);const results={legacy:[],tagged:[]};const log=[];
try{
 const jobs=[];for(const [fmt,m] of [['legacy',legacy],['tagged',tagged]])for(const [qi,q] of qs.entries())for(let r=0;r<REP;r++)jobs.push({fmt,m,qi,q});
 let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<jobs.length){const j=jobs[next++];
  try{const sid=await host.startSession({model:{providerId:'live',modelId},workspace:root,runtimeConfig,persona:'You are a careful research assistant. Answer only from the supplied material. Do not use tools.'});
   await host.configurePolicy({sessionId:sid,approvalPolicy:'ask',sandboxMode:'read-only'}).catch(()=>{});
   const out=await host.send({sessionId:sid,text:j.q.q+'\n'+wrap(j.m)});const ok=j.q.check(out.finalResponse);results[j.fmt].push({qi:j.qi,ok});log.push({fmt:j.fmt,qi:j.qi,ok,answer:out.finalResponse.slice(0,300)});await host.releaseSession(sid);}
  catch(e){results[j.fmt].push({qi:j.qi,ok:false,error:true});log.push({fmt:j.fmt,qi:j.qi,error:e.message.slice(0,200)});}}}));
}finally{await host.close();}
await writeFile('.sciencescope-local/temp/eval/material-format-ab.log.json',JSON.stringify({modelId,sizes:{legacy:legacy.length,tagged:tagged.length},log},null,1));
for(const fmt of ['legacy','tagged']){const per=qs.map((_,qi)=>{const r=results[fmt].filter(x=>x.qi===qi);return `${r.filter(x=>x.ok).length}/${r.length}`;});console.log(fmt.padEnd(7),'chars',(fmt==='legacy'?legacy:tagged).length,'| per-question',per.join(' '),'| total',results[fmt].filter(x=>x.ok).length+'/'+results[fmt].length,'| errors',results[fmt].filter(x=>x.error).length);}
await rm(root,{recursive:true,force:true});
