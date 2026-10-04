// Synthetic fixture only. No gold fields are sent to a model or put in source minutes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
export function memoryFixture(){
const profiles=[
  ['cedar','雪松项目','采样对象','湖泊藻类','保存格式','CSV','Parquet','许晴','2026-11-14','伦理审批编号'],
  ['tide','潮汐项目','测量设备','声学流速计','质量阈值','0.80','0.92','梁宁','2026-11-18','设备序列号'],
  ['lumen','微光项目','主要终点','夜间照度','时间基准','当地时间','UTC','沈禾','2026-11-22','资助合同编号'],
  ['orbit','轨道项目','数据分辨率','15分钟','分析方法','OLS','固定效应模型','唐越','2026-11-26','参与者身份证号'],
  ['moss','苔原项目','对照条件','等待名单','招募上限','48人','64人','罗溪','2026-11-30','样本运输追踪号'],
  ['grain','麦穗项目','缺失值标记','NA','交叉验证折数','5折','8折','周岚','2026-12-04','预注册登记号'],
];
const corpus={schema:1,synthetic:true,projects:[]};
const questions={schema:1,synthetic:true,answerFormat:{status:'answered | insufficient_evidence',values:'array of factual strings; no prose guesses',citations:'array of {chatId,messageNumbers?,itemHandle?,quote}; cite only inspected evidence'},questions:[]};
const gold={schema:1,synthetic:true,judgeVersion:'t09-exact-fields-v1',policy:{numericTolerance:0,extraValues:'fail unless an approved alias',unknown:'must abstain with no factual values; not a guessed identifier',citationSupport:'separate source audit, never inferred from parsed/nonempty citation'},questions:[]};
for(const [slug,name,factLabel,factValue,changedLabel,oldValue,newValue,owner,due,unknownLabel] of profiles){
  const projectId=`t09-${slug}`,chatA=`${projectId}-planning`,chatB=`${projectId}-handoff`;
  const user=(id,text,date)=>({id,role:'user',text,created:`${date}T09:00:00.000Z`,completionStatus:'completed'});
  const assistant=(id,date)=>({id,role:'assistant',text:'已记录。这是虚构项目记录。',created:`${date}T09:01:00.000Z`,completionStatus:'completed'});
  const messagesA=[user(`${slug}-u1`,`${name}：${factLabel}确定为${factValue}。这是内部研究决定。`,'2026-10-01'),assistant(`${slug}-a1`,'2026-10-01'),user(`${slug}-u2`,`${name}：2026-10-01初版约定，${changedLabel}采用${oldValue}。`,'2026-10-01'),assistant(`${slug}-a2`,'2026-10-01'),user(`${slug}-u3`,`${name}：2026-10-03正式修订，将${changedLabel}由${oldValue}改为${newValue}；初版不再作为当前方案，其他约定不变。`,'2026-10-03'),assistant(`${slug}-a3`,'2026-10-03')];
  const messagesB=[user(`${slug}-u4`,`${name}交接：复核负责人确定为${owner}。只负责本项目复核。`,'2026-10-04'),assistant(`${slug}-a4`,'2026-10-04'),user(`${slug}-u5`,`${name}交接：负责人应在${due}前完成复核，以立项会议计划为依据。`,'2026-10-04'),assistant(`${slug}-a5`,'2026-10-04')];
  // Numbered minutes are normal source records shared by both arms, not question answers.
  const minutesA=[{revision:1,throughOrdinal:4,author:'user',text:`研究目标：${name}。\n已定结论：${factLabel}为${factValue}（#1）。初版${changedLabel}采用${oldValue}（#3），生效日2026-10-01。\n待办：等待复核交接。`},{revision:2,throughOrdinal:6,author:'user',text:`研究目标：${name}。\n已定结论：${factLabel}为${factValue}（#1）。2026-10-03修订${changedLabel}为${newValue}（#5）。\n被否定的方案：初版${changedLabel}为${oldValue}，2026-10-01采用（#3），已由#5取代。\n待办：等待复核交接。`}];
  const minutesB=[{revision:1,throughOrdinal:4,author:'user',text:`${name}交接纪要。\n已定结论：复核负责人${owner}（#1），复核期限${due}（#3）。\n待办：负责人据立项会议方案复核；当前方案详见${chatA}。`}];
  corpus.projects.push({id:projectId,name,description:'虚构项目；仅用于记忆评测，无外部论文或真实个人数据。',chats:[{id:chatA,title:`${name}立项会议`,messages:messagesA,minutes:minutesA},{id:chatB,title:`${name}复核交接`,messages:messagesB,minutes:minutesB}],consolidationStages:[{id:`${slug}-initial`,chatId:chatA,throughMessage:4,minutesRevision:1},{id:`${slug}-revision`,chatId:chatA,throughMessage:6,minutesRevision:2},{id:`${slug}-handoff`,chatId:chatB,throughMessage:4,minutesRevision:1}]});
  const evidence=(chatId,n,quote)=>({chatId,messageNumbers:[n],quote});
  const add=(kind,prompt,values,refs)=>{
    const id=`${slug}-${kind}`;
    questions.questions.push({id,category:kind,projectId,projectName:name,prompt:`请查阅项目${name}（${projectId}）的已有记录。${prompt}请按统一JSON字段回答；若没有记录依据，明确拒答，不推断。`});
    gold.questions.push({questionId:id,category:kind,expectedStatus:kind==='unanswerable'?'insufficient_evidence':'answered',expectedValues:values,aliases:{},evidence:refs,forbiddenCurrentValues:kind==='update'?[oldValue]:[],sourceScope:{projectId,chatIds:[chatA,chatB]}});
  };
  add('single',`立项会议确定的${factLabel}是什么？`,[factValue],[evidence(chatA,1,messagesA[0].text)]);
  add('update',`2026-10-03修订后，当前${changedLabel}采用什么？`,[newValue],[evidence(chatA,5,messagesA[4].text)]);
  add('temporal',`2026-10-03修订之前、2026-10-01初版约定的${changedLabel}是什么？`,[oldValue],[evidence(chatA,3,messagesA[2].text)]);
  add('cross_session',`请把立项会议的当前${changedLabel}与交接会议的复核负责人和期限合并列出。`,[newValue,owner,due],[evidence(chatA,5,messagesA[4].text),evidence(chatB,1,messagesB[0].text),evidence(chatB,3,messagesB[2].text)]);
  add('unanswerable',`该项目的${unknownLabel}是什么？`,[],[]);
}
assert.equal(questions.questions.length,30);
for(const category of ['single','update','temporal','cross_session','unanswerable'])assert.equal(questions.questions.filter(q=>q.category===category).length,6);
for(const row of gold.questions)for(const ref of row.evidence){
 const chat=corpus.projects.flatMap(p=>p.chats).find(c=>c.id===ref.chatId);
 assert.ok(ref.messageNumbers.some(n=>chat.messages[n-1].text===ref.quote));
}
return {corpus,questions,gold};
}
export async function writeMemoryFixture(root=path.resolve('.sciencescope-local/temp/t09-validation/fixture')){
  const {corpus,questions,gold}=memoryFixture();
  await import('node:fs/promises').then(fs=>fs.mkdir(root,{recursive:true}));
const outputs={'corpus.json':corpus,'questions.json':questions,'gold.json':gold};
const manifest={schema:1,status:'DRAFT_FOR_ROOT_REVIEW_NOT_PAID_FROZEN',synthetic:true,questions:30,projects:6,chats:12,categories:5,files:{}};
for(const [file,value] of Object.entries(outputs)){
 const bytes=JSON.stringify(value,null,2)+'\n';
 await writeFile(path.join(root,file),bytes);
 manifest.files[file]={sha256:createHash('sha256').update(bytes).digest('hex'),bytes:Buffer.byteLength(bytes)};
}
manifest.files['scripts/evals/memory-eval-fixture.mjs']={sha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex')};
await writeFile(path.join(root,'manifest-draft.json'),JSON.stringify(manifest,null,2)+'\n');
return manifest;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await writeMemoryFixture()));
