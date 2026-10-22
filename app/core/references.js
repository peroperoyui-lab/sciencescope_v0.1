// A portable reference identifies durable content, never a parser/index row
// as the only surviving identity. R4-2 marks retain their existing storage.
/**
 * @typedef {{page?:number,paragraph?:number,blockId?:string,characters?:{start:number,end:number},
 * lines?:{start:number,end:number},textBasis?:'parsed'|'rendered',description?:string,
 * quote?:{exact:string,prefix?:string,suffix?:string}}} ReferenceLocation
 * @typedef {{schema:1,kind:'version'|'project-file'|'script'|'source'|'chunk'|'item'|'message'|'map-node',
 * id?:string,projectId?:string,path?:string,sourceId?:string,meetingId?:string,
 * location?:ReferenceLocation,label?:string}} ContentReference
 */
export {};
