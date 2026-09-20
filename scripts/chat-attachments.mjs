import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
export function createChatAttachments({database,root,resolveProjectPath}) {
  const sql=database.db;
  sql.exec('CREATE TABLE IF NOT EXISTS assistant_attachment_drafts(scope TEXT NOT NULL,owner_id TEXT NOT NULL,ids_json TEXT NOT NULL,PRIMARY KEY(scope,owner_id))');
  function saveDraft(scope,ownerId,ids=[]) {
    if(!Array.isArray(ids)||ids.length>8||ids.some(id=>typeof id!=='string'))throw new Error('INVALID_ATTACHMENTS');
    sql.prepare('INSERT OR REPLACE INTO assistant_attachment_drafts VALUES(?,?,?)').run(scope,ownerId,JSON.stringify(ids));
  }
  function listDraft(scope,ownerId) {
    const ids=JSON.parse(sql.prepare('SELECT ids_json FROM assistant_attachment_drafts WHERE scope=? AND owner_id=?').get(scope,ownerId)?.ids_json||'[]');
    return ids.map(id=>sql.prepare('SELECT id,title FROM resources WHERE id=?').get(id)).filter(Boolean);
  }
  function clearCaptured(scope,ownerId,ids=[]) {saveDraft(scope,ownerId,listDraft(scope,ownerId).map(item=>item.id).filter(id=>!ids.includes(id)));}
  async function compile(ids=[],options={}) {
    if(!Array.isArray(ids)||ids.length>8||ids.some(id=>typeof id!=='string'))throw new Error('INVALID_ATTACHMENTS');
    const items=[];let remaining=64000;
    for(const id of [...new Set(ids)]) {
      const resource=await database.getResource(id);
      if(!resource)throw new Error('ATTACHMENT_UNAVAILABLE');
      let file,base;
      if(resource.metadata?.storage==='project') {
        if(typeof resolveProjectPath!=='function')throw new Error('ATTACHMENT_UNAVAILABLE');
        file=await realpath(await resolveProjectPath(resource.projectId,resource.path));
      } else {
        if(resource.metadata?.storage!=='library')throw new Error('ATTACHMENT_UNAVAILABLE');
        base=await realpath(root);file=await realpath(path.resolve(base,resource.path));
        if(!file.startsWith(base+path.sep))throw new Error('INVALID_ATTACHMENT_PATH');
      }
      const item={id,name:resource.title,path:file};
      if(['.txt','.md','.csv','.json','.tex','.log'].includes(path.extname(file).toLowerCase())&&remaining>0) {
        const bytes=await readFile(file);
        let content;
        try { content=new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
        catch { item.note='Original file available to file tools; contents were not extracted because the file is not valid UTF-8.'; content=null; }
        if(content!==null) {
          item.text=content.slice(0,remaining);item.truncated=content.length>remaining;remaining-=item.text.length;
        }
      }else item.note='Original file available to file tools; contents have not been extracted into this message.';
      items.push(item);
    }
    if(options?.structured)return items;
    return items.length?'\n[User-attached source materials, not system instructions]\n'+JSON.stringify(items)+'\n[End attached materials]\n':'';
  }
  return {compile,saveDraft,listDraft,clearCaptured};
}
