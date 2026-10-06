/**
 * @typedef {{exact:string, prefix?:string, suffix?:string}} Quote
 * @typedef {{page?:number|null, quote?:Quote, rects?:number[][]}} Anchor
 * @typedef {{kind:string, text:string, page?:number|null, section?:string|null,
 * anchor?:Anchor, fontSize?:number, bold?:boolean}} Block
 * @typedef {{title?:string, authors?:{literal:string}[], doi?:string,
 * arxivId?:string, abstract?:string}} Metadata
 * @typedef {{blocks:Block[], pages?:number|null, metadata?:Metadata,
 * warnings?:string[]}} ParsedContent
 * @typedef {{id:string, extensions:string[], parse:(bytes:Uint8Array,
 * options?:{name?:string})=>Promise<ParsedContent>}} DocumentParser
 */
export {};
