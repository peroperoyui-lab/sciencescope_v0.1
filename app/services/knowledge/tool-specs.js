const guidance =
  'Only write when the user explicitly asks to organize or modify knowledge; otherwise read only. ' +
  'Every written edge needs original evidence in an array: [{ref:"chunk:<id>",quote,page}] or [{ref:"message:<id>",quote}] ' +
  'from an explicit user statement. Without evidence do not write it. Never store your own inference, evaluation or guess. ' +
  'Do not extract entities from data files or editing-desk manuscripts. Search names and aliases before creating entities; reuse or merge matches. ' +
  'Prefer relation keys cites, proposes, implements, variant-of, uses, compares, evaluates-on, describes, supports, contradicts, qualifies, defines, part-of, same-as, derived-from. ' +
  'Explain what you changed in one or two sentences in your answer. similar-to and cites are discovery clues, not conclusions; read and cite original passages. ';

/** @type {import('../../runtime/port.js').ToolSpec[]} */
export const KNOWLEDGE_TOOL_SPECS = [
  {
    name: 'kb_graph',
    description:
      'Read active knowledge relationships around ref or query (entity name/alias first, then research search). ' +
      'Node refs use source:<id>, item:<id>, entity:<id>, chunk:<id>, or folder:<projectId>/<directory>. ' +
      'Results contain only node ref/name/kind/degree and edge from/relation/to/layer. ' +
      'For depth >= 2, paths connect the paged nodes to the center; use offset/limit for remaining edges. ' +
      'Read entity descriptions with research_read. Project folders are virtual, never stored. ' +
      guidance,
    parameters: {
      ref: { type: 'string' },
      query: { type: 'string' },
      depth: { type: 'integer' },
      relations: { type: 'array', items: { type: 'string' } },
      layers: { type: 'array', items: { type: 'string' } },
      projectId: { type: 'string' },
      limit: { type: 'integer' },
      offset: { type: 'integer' },
    },
  },
  {
    name: 'kb_write',
    description:
      'Apply ops independently in order; each returns an id/ref or error, and the batch returns one versionId shared by this turn. ' +
      'createEntity: {name,kind,nameEn?,aliases?,description?,attrs?,layer?}; optionally key:"method" lets later ops use "$method" as a ref. ' +
      'updateEntity: {id,patch}. createEdge: {fromRef,relation,toRef,evidence,attrs?,layer?,weight?,validFrom?,validTo?}; ' +
      'updateEdge: {id,patch}. remove: {ref} for an entity or edge. merge: {into,from[]} for entity ids/refs. ' +
      'label: {ref,add?:string[],remove?:string[]}. member: {projectId,ref,remove?:boolean}. ' +
      'Use op on every operation. Layers are curated (default) or extracted; derived is computed, not writable. ' +
      'Writes apply immediately and can be withdrawn with workspace_versions resource knowledge. ' +
      guidance,
    parameters: {
      ops: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          properties: {
            op: {
              type: 'string',
              required: true,
              enum: [
                'createEntity',
                'updateEntity',
                'createEdge',
                'updateEdge',
                'remove',
                'merge',
                'label',
                'member',
              ],
            },
          },
          additionalProperties: true,
        },
      },
    },
  },
  {
    name: 'research_write',
    description:
      'Write shared research items or source metadata using {op,args}. ' +
      'createItem args: {title,body,type?,subtype?,projectId?,scope?,payload?,status?,visibility?}; ' +
      'types: note, code, knowledge, model, claim, memory. ' +
      'updateItem args: {id,patch}; supersedeItem args: {id,replacement}; updateSource args: {id,patch} ' +
      '(title, kind, metadata). Updates keep existing revision history; supersede preserves the old item. ' +
      'Private items cannot be read or written. URL importing is not available. ' +
      guidance,
    parameters: {
      op: {
        type: 'string',
        required: true,
        enum: ['createItem', 'updateItem', 'supersedeItem', 'updateSource'],
      },
      args: { type: 'object', required: true, additionalProperties: true },
    },
  },
];
