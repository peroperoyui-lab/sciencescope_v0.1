const empty=()=>({attachmentIds:[],messageQuotes:[],annotations:[],contextRefs:[]});
export function createResearchInputStore({db}){
  db.exec('CREATE TABLE IF NOT EXISTS research_input_drafts(scope TEXT NOT NULL,owner_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope,owner_id)); CREATE TABLE IF NOT EXISTS research_input_receipts(chat_id TEXT NOT NULL,message_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(chat_id,message_id))');
  db.exec('CREATE TABLE IF NOT EXISTS research_input_consumed(owner_id TEXT NOT NULL,kind TEXT NOT NULL,item_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner_id,kind,item_id,revision))');
  function key(scope,owner){if(!['main','secretary','global'].includes(scope)||typeof owner!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(owner))throw new Error('INVALID_RESEARCH_DRAFT');}
  function get(scope,owner){key(scope,owner);return JSON.parse(db.prepare('SELECT payload FROM research_input_drafts WHERE scope=? AND owner_id=?').get(scope,owner)?.payload||JSON.stringify(empty()));}
  function save(scope,owner,value){key(scope,owner);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_RESEARCH_DRAFT');const next=Object.fromEntries(Object.keys(empty()).map(k=>[k,value[k]??[]]));if(Object.values(next).some(v=>!Array.isArray(v)||v.length>32)||JSON.stringify(next).length>180000)throw new Error('INVALID_RESEARCH_DRAFT');if(scope==='main')for(const field of ['annotations','messageQuotes'])next[field]=next[field].filter(item=>!item?.id||!Number.isInteger(item.revision)||!db.prepare('SELECT 1 FROM research_input_consumed WHERE owner_id=? AND kind=? AND item_id=? AND revision=?').get(owner,field,item.id,item.revision));db.prepare('INSERT OR REPLACE INTO research_input_drafts VALUES(?,?,?)').run(scope,owner,JSON.stringify(next));return next;}
  function accepted(scope,owner,chatId,messageId,snapshot){
    key(scope,owner);db.exec('BEGIN IMMEDIATE');try{
      const receipt=db.prepare('INSERT OR IGNORE INTO research_input_receipts VALUES(?,?,?)').run(chatId,messageId,JSON.stringify(snapshot));
      if(scope==='main'&&receipt.changes){
        for(const kind of ['annotations','messageQuotes'])for(const item of snapshot[kind])if(item.id&&Number.isInteger(item.revision))db.prepare('INSERT OR IGNORE INTO research_input_consumed VALUES(?,?,?,?)').run(owner,kind,item.id,item.revision);
        const current=get(scope,owner),same=(a,b)=>a.id===b.id&&a.revision===b.revision;
        current.attachmentIds=current.attachmentIds.filter(id=>!snapshot.attachmentIds.includes(id));
        current.messageQuotes=current.messageQuotes.filter(q=>!snapshot.messageQuotes.some(s=>same(q,s)));
        current.annotations=current.annotations.filter(a=>!snapshot.annotations.some(s=>same(a,s)));
        current.contextRefs=current.contextRefs.filter(r=>!snapshot.contextRefs.some(s=>s.resourceId===r.resourceId));
        save(scope,owner,current);
      }
      db.exec('COMMIT');
    }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  }
  function restore(scope,owner,snapshot){key(scope,owner);db.exec('BEGIN IMMEDIATE');try{const current=get(scope,owner);for(const kind of ['annotations','messageQuotes'])for(const item of snapshot[kind]){if(scope==='main'&&item.id&&Number.isInteger(item.revision))db.prepare('DELETE FROM research_input_consumed WHERE owner_id=? AND kind=? AND item_id=? AND revision=?').run(owner,kind,item.id,item.revision);if(!current[kind].some(old=>old.id===item.id))current[kind].push(item);}current.attachmentIds=[...new Set([...current.attachmentIds,...snapshot.attachmentIds])];for(const ref of snapshot.contextRefs)if(!current.contextRefs.some(old=>old.resourceId===ref.resourceId))current.contextRefs.push(ref);save(scope,owner,current);db.exec('COMMIT');return current;}catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}}
  return {get,save,accepted,restore,receipt:(chatId,messageId)=>JSON.parse(db.prepare('SELECT payload FROM research_input_receipts WHERE chat_id=? AND message_id=?').get(chatId,messageId)?.payload||'null')};
}
