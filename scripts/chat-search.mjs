export function createChatSearch({chatStore}) {
  const sql=chatStore.db.db;
  function search(query) {
    if(typeof query!=='string'||!query.trim()||query.length>200)return {results:[]};
    const term='%'+query.trim().replace(/[\\%_]/g,'\\$&')+'%';
    const rows=sql.prepare(`SELECT m.chat_id,m.id,m.ordinal,m.role,m.text,c.title,c.project_id
      FROM messages m JOIN chats c ON c.id=m.chat_id
      WHERE c.deleted_at IS NULL AND c.archived=0 AND m.role IN ('user','assistant')
      AND NOT EXISTS (SELECT 1 FROM assistant_conversations a WHERE a.chat_id=c.id)
      AND m.text LIKE ? ESCAPE '\\' ORDER BY m.created DESC,m.ordinal DESC LIMIT 40`).all(term);
    return {results:rows.map(row=>{
      const index=row.text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase());
      const start=Math.max(0,index-60);
      return {chatId:row.chat_id,messageId:row.id,title:row.title,projectId:row.project_id,ordinal:row.ordinal,role:row.role,excerpt:row.text.slice(start,start+220)};
    })};
  }
  async function locate(chatId,messageId) {
    const row=sql.prepare(`SELECT m.ordinal FROM messages m JOIN chats c ON c.id=m.chat_id
      WHERE m.chat_id=? AND m.id=? AND c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM assistant_conversations a WHERE a.chat_id=c.id)`).get(chatId,messageId);
    if(!row)return null;
    return chatStore.pageMessages(chatId,{after:String(Math.max(0,row.ordinal-25)),limit:60});
  }
  return {search,locate};
}
