import { ContextAccessError } from '../policy.mjs';
import { READ_CHARS, READ_LIMIT, checkScopeTarget, databaseOf } from './_shared.mjs';
import {normalizeHybridQueries,runVectorPhase,fuseHybridRankings,hybridRefKey} from '../../research-base/hybrid.mjs';
import {messageVectorVersion} from '../../research-base/semantic-service.mjs';

export const id = 'conversation';
export const sections = Object.freeze([]);
export const describe = (_role) => 'Read the numbered Main conversation. Search returns bounded excerpts; from/to returns complete messages within the read bound.';

export function createConversationSource({ db, minutes, vectorRetriever }) {
  const database = databaseOf({ db });
  if (!minutes?.messagesAfter || !minutes?.format) throw new TypeError('minutes.messagesAfter and minutes.format are required.');
  function read(scope, args = {}) {
    const target = checkScopeTarget(database, scope.role, scope.ctx, args);
    if (!target.chatId) throw new ContextAccessError('CHAT_REQUIRED', 'Specify chatId when the global assistant recalls a conversation.');
    const all = minutes.messagesAfter(target.chatId, 0);
    if (Number.isInteger(args.from) || Number.isInteger(args.to)) {
      const from = Math.max(1, Number.isInteger(args.from) ? args.from : args.to);
      const to = Number.isInteger(args.to) ? args.to : from + READ_LIMIT - 1;
      if (to < from) throw new ContextAccessError('INVALID_RANGE', 'to must be greater than or equal to from.');
      const picked = []; let size = 0;
      for (const message of all) {
        if (message.ordinal < from || message.ordinal > to) continue;
        const block = minutes.format(message);
        if (picked.length && (picked.length >= READ_LIMIT || size + block.length > READ_CHARS)) break;
        picked.push({ message, block }); size += block.length;
      }
      const last = picked.at(-1)?.message.ordinal;
      const more = last !== undefined && all.some((message) => message.ordinal > last && message.ordinal <= to);
      return { messages: picked.map((item) => item.block).join('\n'), count: picked.length, ...(more ? { next: { from: last + 1, to } } : {}), totalMessages: all.length, lastNumber: all.at(-1)?.ordinal ?? 0 };
    }
    if(args.query!==undefined&&(typeof args.query!=='string'||!args.query.trim()||args.query.length>400))throw new ContextAccessError('INVALID_QUERY','Give query (1–400 characters), queries or from/to message numbers.');
    let queries;try{queries=normalizeHybridQueries(args);}catch(error){throw new ContextAccessError('INVALID_QUERY',error.message);}
    return hybridRead(target,all,queries,args);
  }
  async function hybridRead(target,all,queries,args){
    const limit = Math.min(Math.max(1, Number.isInteger(args.limit) ? args.limit : 12), 30);
    const refFor=message=>({type:'message',id:JSON.stringify([target.chatId,message.id])});
    const candidates=all.map(message=>({ref:refFor(message),version:messageVectorVersion(message.text)}));
    const keywordRankings=queries.map(query=>{
      const terms=[...new Set(query.toLocaleLowerCase().split(/\s+/u).filter(Boolean))].slice(0,12);
      return all.map((message) => {
      const text = message.text.toLocaleLowerCase();
      return {ref:refFor(message),message,hits:terms.filter(term=>text.includes(term)).length};
      }).filter(item=>item.hits>0).sort((a,b)=>b.hits-a.hits||b.message.ordinal-a.message.ordinal).slice(0,30);
    });
    let fallbackReason='model-missing',vectorRankings=[];
    if(vectorRetriever){
      try{
        const phase=await runVectorPhase({search:input=>vectorRetriever.search(input),queries,candidates});
        fallbackReason=phase.timedOut?'timeout':phase.result?.fallbackReason??null;
        if(!fallbackReason){if(Array.isArray(phase.result?.rankings))vectorRankings=phase.result.rankings;else fallbackReason='index-incomplete';}
      }catch{fallbackReason='model-missing';}
    }
    const byRef=new Map(all.map(message=>[hybridRefKey(refFor(message)),message]));
    const scored=fuseHybridRankings({vectorRankings,keywordRankings,allowedRefs:candidates,limit});
    return {
      mode:fallbackReason?'keyword':'hybrid',...(fallbackReason?{fallbackReason}:{}),
      results: scored.map(({ref}) => {
        const message=byRef.get(hybridRefKey(ref)),text=message.text.toLocaleLowerCase(),terms=queries.flatMap(query=>query.toLocaleLowerCase().split(/\s+/u));
        const index = Math.max(0, text.indexOf(terms.find((term) => text.includes(term)) ?? ''));
        return { n: message.ordinal, speaker: message.speaker, excerpt: message.text.slice(Math.max(0, index - 200), Math.max(0, index - 200) + 600) };
      }),
      hint: (fallbackReason?'本次为关键词检索。 ':'')+'These are deliberate search excerpts. Read a whole message or its neighbours with chat_recall({from:n, to:n+2}).',
      totalMessages: all.length,
    };
  }
  return { id, sections, describe, read };
}

export default { id, sections, describe, create: createConversationSource };
