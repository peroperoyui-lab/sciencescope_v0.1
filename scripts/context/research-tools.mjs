import {ContextAccessError, POLICY} from './policy.mjs';
import {parseCitationLabel} from '../research-base/citations.mjs';

/** Reuse Research Base search/read; only the session scope differs. */
export function createScopedResearchTools({research, projectIds}) {
  function allowedRef(ref, ctx) {
    if (!ref) throw new ContextAccessError('REFERENCE_NOT_FOUND','Research reference is unavailable.',404);
    const record = ref.type === 'item' ? research.store.getItem(ref.id)
      : ref.type === 'source' ? research.store.getSource(ref.id)
      : ref.type === 'chunk' ? research.store.getSource(research.store.getChunk(ref.id)?.sourceId) : null;
    if (!record || record.visibility === 'private') throw new ContextAccessError('REFERENCE_NOT_FOUND','Research reference is unavailable.',404);
    if (record.scope?.startsWith('expert:') && record.scope !== `expert:${ctx.expertId}`) throw new ContextAccessError('REFERENCE_NOT_FOUND','Research reference is unavailable.',404);
    if (ctx.role !== 'global' && record.projectId && record.projectId !== ctx.projectId) throw new ContextAccessError('REFERENCE_OUT_OF_SCOPE','Research reference is outside this session.');
    return ref;
  }
  return async function call(name,args,ctx) {
    if (!POLICY[ctx.role]) throw new ContextAccessError('ROLE_NOT_ALLOWED','Research tools are not available in this session.');
    if (args.projectId !== undefined || args.chatId !== undefined) throw new ContextAccessError('TARGET_NOT_ALLOWED','Research tool scope is assigned by the session; use the context tools to select a conversation.');
    if (name === 'research_search' && ctx.role === 'global') {
      // One vector phase and one deadline for the entire authorized workspace.
      // projectIds comes from the host, never the model's tool parameters.
      const result=await research.retrieval.searchHybrid({query:args.query,queries:args.queries,projectIds:await projectIds(),includePersonal:true,
        docTypes:args.types?.length?args.types:undefined,itemTypes:args.itemTypes,k:Math.max(1,Math.min(20,Number(args.limit)||8)),audience:'agent',expertId:ctx.expertId??undefined});
      const selected=result.hits.map(hit=>({...hit,projectId:(hit.item?research.store.getItem(hit.ref.id):research.store.getSource(hit.source?.id))?.projectId??null}));
      if(ctx.chatId&&ctx.messageId)research.store.recordUsage({chatId:ctx.chatId,messageId:ctx.messageId,refs:selected.map(hit=>hit.ref),how:'search'});
      return {mode:result.mode,...(result.fallbackReason?{fallbackReason:result.fallbackReason}:{}),hits:selected.map(hit=>({cite:hit.cite,ref:hit.ref,title:hit.title,section:hit.section??undefined,
        page:hit.page??undefined,snippet:hit.snippet,projectId:hit.projectId,
        ...(hit.item?{type:hit.item.type,subtype:hit.item.subtype,status:hit.item.claimStatus??hit.item.status}:{})})),
        hint:(result.mode==='keyword'?'本次为关键词检索。 ':'')+'These are bounded excerpts, not evidence of absence. Use research_read with a promising hit\'s exact ref to verify missing detail. Once direct evidence covers the question, answer with citations. Further lookups should resolve a specific missing fact or contradiction. Across projects, read the returned ref rather than a potentially ambiguous project-local citation label.'};
    }
    if (name === 'research_read') {
      let ref=args.ref;
      let page=args.page;
      let toPage=args.toPage;
      if(!ref && args.cite) {
        const parsed=parseCitationLabel(args.cite);
        if(parsed.citations.length>1)throw new ContextAccessError('AMBIGUOUS_CITATION','This citation contains multiple records; read each citation or exact ref separately.');
        if(parsed.parseStatus==='partial')throw new ContextAccessError('INVALID_CITATION','This citation contains an unrecognized member; read a complete citation separately.');
        const ids=ctx.role==='global'?[null,...await projectIds()]:[ctx.projectId??null];
        const refs=new Map();
        for(const projectId of ids){const match=research.retrieval.resolveCitation(args.cite,{projectId});if(match)refs.set(JSON.stringify(match.ref),match);}
        if(refs.size>1)throw new ContextAccessError('AMBIGUOUS_CITATION','This label identifies more than one project source; read the exact ref from research_search.');
        const citation=[...refs.values()][0];
        // Preserve the page through scope resolution; a chunk-neighbor read
        // can otherwise omit the page explicitly requested by the citation.
        ref=citation?.source?{type:'source',id:citation.source.id}:citation?.ref;
        page=args.page??citation?.page;
        toPage=args.page!=null?args.toPage:args.toPage??(citation?.fromPage!==citation?.toPage?citation?.toPage:undefined);
      }
      const result=await research.toolCall(name,{...args,page,toPage,ref:allowedRef(ref,ctx)},ctx);
      // A public item must not expose a private/out-of-scope neighbour through
      // its evidence links (including the link's quote and note).
      if(Array.isArray(result.links))return {...result,links:result.links.filter(link=>{
        try{allowedRef(link.from,ctx);allowedRef(link.to,ctx);return true;}
        catch(error){if(error instanceof ContextAccessError)return false;throw error;}
      })};
      return result;
    }
    return research.toolCall(name,args,ctx);
  };
}
