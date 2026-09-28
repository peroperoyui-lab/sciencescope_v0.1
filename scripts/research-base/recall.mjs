/** Bounded derived recall, never a replacement for verbatim conversation history. */
export async function recallForTurn(retrieval,{text,projectId=null,expertId,briefRefs=[]}={}) {
  const query=String(text??'').trim().slice(0,2000);
  if(!query)return {text:'',refs:[],mode:'keyword'};
  const result=await retrieval.searchHybrid({query,projectId,expertId,audience:'agent',
    docTypes:['item'],itemTypes:['memory','knowledge','model','claim'],k:50});
  const excluded=new Set(briefRefs.filter(ref=>ref.type==='item').map(ref=>ref.id));
  const lines=[],refs=[];let remaining=1500-'[与本轮相关的记忆]\n'.length;
  for(const hit of result.hits){
    if(excluded.has(hit.ref.id)||refs.length>=8)continue;
    const prefix=`${hit.cite} ${hit.title}: `;
    if(prefix.length+2>remaining)continue;
    const content=String(hit.snippet??'').replace(/\s+/gu,' ');
    const room=remaining-prefix.length-1;
    const line=prefix+(content.length>room?content.slice(0,Math.max(0,room-1))+'…':content);
    lines.push(line);refs.push(hit.ref);remaining-=line.length+1;
  }
  return {text:lines.length?`[与本轮相关的记忆]\n${lines.join('\n')}`:'',refs,mode:result.mode,...(result.fallbackReason?{fallbackReason:result.fallbackReason}:{})};
}
