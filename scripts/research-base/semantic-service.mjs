import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {embeddingManifest,embeddingHardware,verifyEmbeddingFiles,downloadEmbeddingFiles} from './model-assets.mjs';

/** One local, rebuildable projection beside the canonical Research Base tables.
 * Calls never wait for downloads or cold model load. Startup warms in background. */
export function createSemanticService({database,store,dataRoot,isBusy=()=>false,onError=()=>{},
  hardware=embeddingHardware,verifyFiles=verifyEmbeddingFiles,downloadFiles=downloadEmbeddingFiles,
  embeddingFactory,vectorFactory}={}) {
  const {db}=database;
  db.exec(`CREATE TABLE IF NOT EXISTS rb_embedding_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO rb_embedding_settings(id,enabled) VALUES(1,0);`);
  let enabled=!!db.prepare('SELECT enabled FROM rb_embedding_settings WHERE id=1').get().enabled;
  let closed=false,engine=null,vector=null,manifest=null,init=null,job=null,timer=null,dirty=false,controller=null,downloadJob=null;
  let messageProvider=()=>[],progress={state:'disabled',indexed:0,total:0,error:null,hardware:null,download:null};
  const modelDir=path.join(dataRoot,'.sciencescope-local','models','multilingual-e5-small');
  function status(){return {...progress,enabled,model:manifest?.modelId??'Xenova/multilingual-e5-small',version:manifest?.revision??null,modelDir};}
  const noteError=error=>{progress.error=String(error?.message??error);onError(error);};
  function documents() {
    const docs=[];
    for(const row of db.prepare('SELECT id,title,abstract,updated_at FROM rb_sources ORDER BY id').all())docs.push({ref:{type:'source',id:row.id},version:row.updated_at,text:[row.title,row.abstract].filter(Boolean).join('\n'),group:row.id});
    for(const row of db.prepare('SELECT c.id,c.text,c.source_id,s.updated_at FROM rb_chunks c JOIN rb_sources s ON s.id=c.source_id ORDER BY c.source_id,c.ordinal').all())docs.push({ref:{type:'chunk',id:row.id},version:row.updated_at,text:row.text,group:row.source_id});
    for(const row of db.prepare("SELECT id,title,body,body_json,revision FROM rb_items WHERE status NOT IN ('proposed','rejected') ORDER BY id").all())docs.push({ref:{type:'item',id:row.id},version:String(row.revision),text:[row.title,row.body,row.body_json==='{}'?'':row.body_json].filter(Boolean).join('\n'),group:'item:'+row.id});
    for(const message of messageProvider())docs.push({...message,group:message.group??'messages'});
    return docs;
  }
  function later(){if(closed||timer)return;timer=setTimeout(()=>{timer=null;void drain();},500);timer.unref?.();}
  function rebuild(){dirty=true;if(enabled&&vector)later();}
  async function drain(){
    if(closed||job||!enabled||!vector||!dirty)return;
    if(isBusy()){progress.state='paused';later();return;}
    dirty=false;progress.state='indexing';progress.error=null;
    job=(async()=>{
      const docs=documents(),groups=new Map();progress.total=docs.length;progress.indexed=0;
      for(const doc of docs){const batch=groups.get(doc.group)??[];batch.push(doc);groups.set(doc.group,batch);}
      for(const batch of groups.values()){
        for(let offset=0;offset<batch.length;offset+=8){
          if(closed||!enabled)return;
          if(isBusy()){dirty=true;progress.state='paused';later();return;}
          const part=batch.slice(offset,offset+8);await vector.upsertDocuments(part);progress.indexed+=part.length;
        }
      }
      await vector.removeMissing(docs.map(doc=>doc.ref));
      progress.state='ready';
    })().catch(error=>{progress.state='error';noteError(error);}).finally(()=>{job=null;if(dirty)later();});
    return job;
  }
  async function initialize(){
    if(init)return init;
    init=(async()=>{
      manifest=await embeddingManifest();
      progress.hardware??=await hardware(path.join(dataRoot,'.sciencescope-local','temp','embedding-hardware'));
      if(closed)return;
      if(!enabled){progress.state='disabled';return;}
      if(!progress.hardware.supported){progress.state='unsupported';return;}
      if(!await verifyFiles(modelDir,manifest)){progress.state='model-missing';return;}
      if(closed)return;
      progress.state='warming';
      const makeEmbedding=embeddingFactory??(await import('./embedding.mjs')).createEmbedding;
      engine??=makeEmbedding({modelDir,modelId:manifest.modelId,modelVersion:manifest.revision});
      await engine.warmup();
      if(closed)return;
      const makeVector=vectorFactory??(await import('./vector-store.mjs')).createVectorStore;
      const config=vectorFactory?{hidden_size:manifest.dimensions}:JSON.parse(await readFile(path.join(modelDir,'config.json'),'utf8'));
      if(!Number.isInteger(config.hidden_size)||config.hidden_size<1)throw new Error('INVALID_MODEL_DIMENSIONS');
      vector??=await makeVector({dbPath:database.dbPath,embedding:engine,modelId:manifest.modelId,modelVersion:manifest.revision,dimensions:config.hidden_size,onRebuild:rebuild});
      rebuild();
    })().catch(error=>{progress.state='error';noteError(error);}).finally(()=>{init=null;});
    return init;
  }
  async function configure(action){
    if(closed)throw new Error('SEMANTIC_SERVICE_CLOSED');
    if(!['enable','disable','download','rebuild'].includes(action))throw Object.assign(new Error('INVALID_SEMANTIC_ACTION'),{status:400});
    if(action==='disable'){
      enabled=false;db.prepare('UPDATE rb_embedding_settings SET enabled=0 WHERE id=1').run();controller?.abort();progress.state='disabled';return status();
    }
    enabled=true;db.prepare('UPDATE rb_embedding_settings SET enabled=1 WHERE id=1').run();
    if(action==='download'){
      if(controller)return status();
      controller=new AbortController();progress.state='downloading';progress.error=null;
      // The HTTP request returns promptly; errors/progress remain inspectable.
      const current=controller;
      downloadJob=(async()=>{
        manifest??=await embeddingManifest();
        progress.hardware??=await hardware(path.join(dataRoot,'.sciencescope-local','temp','embedding-hardware'));
        if(!progress.hardware.supported){progress.state='unsupported';return;}
        await downloadFiles(modelDir,manifest,{signal:current.signal,onProgress:value=>{progress.download=value;}});
        if(!closed&&enabled)await initialize();
      })().catch(error=>{if(!current.signal.aborted){progress.state='error';noteError(error);}}).finally(()=>{if(controller===current)controller=null;downloadJob=null;});
    } else if(vector)rebuild();else void initialize();
    return status();
  }
  async function search(input){
    if(!enabled||progress.state==='model-missing'||progress.state==='unsupported'||progress.state==='error')return {fallbackReason:'model-missing'};
    if(!vector)return {fallbackReason:'index-incomplete'};
    const result=await vector.search(input);
    if(result.fallbackReason==='model-version-mismatch'||result.fallbackReason==='index-incomplete')rebuild();
    return result;
  }
  async function idle(){await init;if(dirty&&enabled&&vector&&!isBusy()){clearTimeout(timer);timer=null;await drain();}await job;}
  async function close(){closed=true;clearTimeout(timer);controller?.abort();await downloadJob;await init;await job;await vector?.close();await engine?.close();}
  function setMessageProvider(provider){messageProvider=provider;rebuild();}
  return {start:initialize,status,configure,search,rebuild,idle,close,documents,setMessageProvider};
}

export const messageVectorVersion=text=>createHash('sha256').update(text).digest('hex');
