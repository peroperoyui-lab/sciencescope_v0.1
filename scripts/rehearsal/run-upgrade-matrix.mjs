#!/usr/bin/env node
// Repeat the five pinned-node API upgrade rehearsals. Materialize/install the
// historical worktrees first; see materialize-historical.py and the report.
// Usage: node scripts/rehearsal/run-upgrade-matrix.mjs [--historical-root PATH]
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const base=path.join(root,'.sciencescope-local/temp/dot/upgrade');
const args=process.argv.slice(2),index=args.indexOf('--historical-root');
const historical=index>=0?path.resolve(args[index+1]):path.join(base,'sources');
const pins={
 '98e560a':'98e560a13356d18455d1f397b416812e2fceb63a',
 '7eaa4aa':'7eaa4aaae841eb1416df24a6a4c3cffbacca7c11',
 'a3e79e2':'a3e79e24f59b1da06eb91e941f1f816a9062671c',
 '46f4e8f':'46f4e8f9bc100c70828baff21e15900fbf7a36a9',
 'edf02f3':'edf02f33ccb720c1e0d9178cb03a11ea28f47052',
};
const git=promisify(execFile);
await mkdir(base,{recursive:true});
const run=await mkdtemp(path.join(base,'matrix-'));
const summary={latest:pins.edf02f3,run,scope:'real Linux DSH + localhost model; API-created owned synthetic datasets',nodes:[],passed:false};
async function execute(phase,source,data,evidence,label){
 const log=path.join(evidence,phase+'.log');let output='';
 const exitCode=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'scripts/rehearsal/upgrade-api.mjs'),phase,source,data,evidence,label],{cwd:source,env:{...process.env,TMPDIR:path.join(root,'.sciencescope-local/temp')}});
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});child.once('error',reject);child.once('exit',(code,signal)=>resolve(code??(signal?128:1)));
 });
 await writeFile(log,output);const result=JSON.parse(await readFile(path.join(evidence,phase+'-result.json'),'utf8'));
 return {exitCode,result,log};
}
try{
 const changed=(await git('git',['diff','--name-only',pins.edf02f3],{cwd:root})).stdout.trim().split('\n').filter(Boolean);assert.ok(changed.every(p=>p.startsWith('scripts/rehearsal/')||p.startsWith('docs/archive/legacy/dot/')||p.startsWith('tests/')),'Only approved rehearsal/test/report changes may differ from pinned product baseline');
 for(const [label,sha] of Object.entries(pins)){
  const source=label==='edf02f3'?root:path.join(historical,label);
  if(label!=='edf02f3')assert.equal((await git('git',['rev-parse','HEAD'],{cwd:source})).stdout.trim(),sha,'Exact pinned historical checkout required');
  const evidence=path.join(run,label),data=path.join(run,'data-'+label);await mkdir(evidence,{recursive:true});
  const node={label,sha,source,data,evidence};summary.nodes.push(node);
  node.seed=await execute('seed',source,data,evidence,label);
  if(node.seed.exitCode===0)node.verify=await execute('verify',root,data,evidence,label);
  node.passed=node.seed.exitCode===0&&node.verify?.exitCode===0;
  console.log(JSON.stringify({label,passed:node.passed,evidence}));
  await writeFile(path.join(run,'summary.json'),JSON.stringify(summary,null,2));
 }
 summary.passed=summary.nodes.length===5&&summary.nodes.every(node=>node.passed);
}catch(error){summary.blocker=error.message;}
await writeFile(path.join(run,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({passed:summary.passed,summary:path.join(run,'summary.json')}));
process.exitCode=summary.passed?0:1;
