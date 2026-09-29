// Opt-in real uv/CPython acceptance; no model calls. Keeps only this owned fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,mkdtemp,copyFile,writeFile,stat,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
import {createPythonEnvironmentService} from './python-env/environments.mjs';

if(!process.argv.includes('--install'))throw new Error('Real package download requires --install');
const run=promisify(execFile),base=path.resolve('.sciencescope-local/temp/t11-validation');
await mkdir(base,{recursive:true});
const resumeIndex=process.argv.indexOf('--resume');
const root=resumeIndex<0?await mkdtemp(path.join(base,'managed-')):path.resolve(process.argv[resumeIndex+1]);
if(path.dirname(root)!==base)throw new Error('Resume must use a direct owned T11 fixture');
let previous;
if(resumeIndex>=0){previous=JSON.parse(await readFile(path.join(root,'result.json'),'utf8'));assert.equal(previous.root,root);await copyFile(path.join(root,'result.json'),path.join(root,`result-before-resume-${Date.now()}.json`));}
await mkdir(path.join(root,'python'),{recursive:true});
for(const name of ['builtin.in','builtin.lock','builtin.json'])await copyFile(path.resolve('python',name),path.join(root,'python',name));
const db=new DatabaseSync(path.join(root,'environments.sqlite'));
const service=createPythonEnvironmentService({database:db,dataRoot:root,uvPath:path.resolve('.sciencescope-local/runtimes/uv/uv.exe')});
const evidence={root,modelRequests:0,checks:{},startedAt:new Date().toISOString()};
const python=id=>path.join(root,'.sciencescope-local/python/envs',id,process.platform==='win32'?'Scripts/python.exe':'bin/python');
try{
  let start=Date.now();const builtin=await service.ensureBuiltin();evidence.builtin={id:builtin.id,durationMs:previous?.builtin?.durationMs??Date.now()-start,status:builtin.status,failedPackages:builtin.failedPackages};
  if(previous)evidence.resumedFrom=previous.finishedAt;
  assert.equal(builtin.status,'ready');assert.deepEqual(builtin.failedPackages,[]);
  const imports=['numpy','scipy','pandas','polars','pyarrow','statsmodels','sklearn','pingouin','lifelines','matplotlib','seaborn','plotly','sympy','networkx','openpyxl','docx','pypdf','requests','bs4','lxml','tqdm','ipykernel'];
  const imported=await run(python(builtin.id),['-c',`import importlib,json; names=${JSON.stringify(imports)}; [importlib.import_module(n) for n in names]; print(json.dumps(names))`],{windowsHide:true,env:{...process.env,TEMP:path.join(root,'.sciencescope-local/python/tmp'),TMP:path.join(root,'.sciencescope-local/python/tmp'),MPLCONFIGDIR:path.join(root,'matplotlib')}});
  assert.deepEqual(JSON.parse(imported.stdout.trim()),imports);evidence.checks.all22Imports=true;
  start=Date.now();const copy=previous?.copy?(await service.list()).envs.find(env=>env.id===previous.copy.id):await service.operate({action:'copy',envId:builtin.id,name:'Acceptance B'});assert.ok(copy);evidence.copy={id:copy.id,durationMs:previous?.copy?.durationMs??Date.now()-start};
  await service.packages({envId:copy.id,action:'add',packages:['pyfiglet==1.0.4'],actor:'acceptance',reason:'Fixture-only additional package'});
  await service.bind({scope:'project',targetId:'fixture-project',envId:builtin.id});
  await service.bind({scope:'chat',targetId:'fixture-b',envId:copy.id});
  await service.bind({scope:'chat',targetId:'fixture-system',envId:'system'});
  assert.equal((await service.resolve({chatId:'fixture-a',projectId:'fixture-project'})).envId,builtin.id);
  assert.equal((await service.resolve({chatId:'fixture-b',projectId:'fixture-project'})).envId,copy.id);
  assert.equal((await service.resolve({chatId:'fixture-system',projectId:'fixture-project'})).kind,'system');
  evidence.checks.resolution=true;
  const relative=process.platform==='win32'?'Lib/site-packages/numpy/__init__.py':'lib/python3.14/site-packages/numpy/__init__.py';
  const aFile=path.join(path.dirname(path.dirname(python(builtin.id))),relative),bFile=path.join(path.dirname(path.dirname(python(copy.id))),relative);
  const [a,b]=await Promise.all([stat(aFile),stat(bFile)]);assert.equal(a.ino,b.ino);assert.ok(a.nlink>=3);
  evidence.hardlinks={sameFileIdentity:true,nlink:a.nlink};
  if(process.platform==='win32')evidence.hardlinks.windows=(await run(path.join(process.env.SystemRoot||'C:/Windows','System32/fsutil.exe'),['hardlink','list',aFile],{windowsHide:true})).stdout;
  evidence.environments=await service.list();
  evidence.checks.passed=true;
}catch(error){evidence.failure={name:error.name,code:error.code,message:error.message};throw error;}
finally{await service.close();db.close();evidence.finishedAt=new Date().toISOString();await writeFile(path.join(root,'result.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({root,checks:evidence.checks,builtin:evidence.builtin,copy:evidence.copy,failure:evidence.failure}));}
