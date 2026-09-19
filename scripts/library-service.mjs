import path from 'node:path';
import {mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openLocalDocument} from './workbench-api.mjs';

export function createLibraryService({database,root,workbench,getWorkspace}){
  async function importFile({name,base64,projectId=null}){
    if(projectId!==null)await workbench.project(projectId);
    if(typeof name!=='string'||path.basename(name)!==name||/[<>:"|?*\u0000]/u.test(name)||!name.trim()||typeof base64!=='string')throw new TypeError('INVALID_RESOURCE');
    const bytes=Buffer.from(base64,'base64');if(bytes.length>20*1024*1024)throw new Error('RESOURCE_TOO_LARGE');
    const id=randomUUID(),directory=path.join(root,'originals',id),relative=path.join('originals',id,name);
    await mkdir(directory,{recursive:true});await writeFile(path.join(root,relative),bytes,{flag:'wx'});
    try{return await database.addResource({id,projectId,title:name,kind:path.extname(name).slice(1).toLowerCase()||'file',path:relative,metadata:{storage:'library',bytes:bytes.length}});}
    catch(error){await rm(directory,{recursive:true,force:true});throw error;}
  }
  async function indexProject(id){
    const snapshot=await workbench.call(id,'get');
    for(const version of snapshot.versions){
      const resourceId=`version-${id}-${version.id}`;
      if(await database.getResource(resourceId))continue;
      await database.addResource({id:resourceId,projectId:id,title:version.name,kind:path.extname(version.name).slice(1)||'file',path:version.relativePath,metadata:{storage:'project',versionId:version.id,version:version.number}});
    }
  }
  async function list({projectId,query,limit=200}={}){
    if(projectId){await workbench.project(projectId);await indexProject(projectId);}
    else for(const project of (await getWorkspace()).projects.filter(p=>!p.archived))await indexProject(project.id);
    return database.listResources({projectId,query,limit});
  }
  async function open(id){
    const resource=await database.getResource(id);if(!resource)throw new Error('RESOURCE_NOT_FOUND');
    if(resource.metadata?.storage==='project')return workbench.open(resource.projectId,resource.path);
    const base=await realpath(root),file=await realpath(path.resolve(base,resource.path));
    if(!file.startsWith(base+path.sep))throw new Error('INVALID_RESOURCE_PATH');
    return openLocalDocument(file);
  }
  return {importFile,list,open};
}
