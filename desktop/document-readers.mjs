import './js-polyfills.mjs';
import DOMPurify from './vendor/purify.mjs';
import {hostBlob} from './host-client.mjs';
import {renderMarkdown} from './markdown.mjs';
import {mathHTML} from './math-render.mjs';
import {EditorState,EditorView,lineNumbers,drawSelection,StreamLanguage,syntaxHighlighting,defaultHighlightStyle,stex,javascript,python,Papa,renderDocx} from './vendor/reader-vendor.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label)=>`<button class="btn tiny" type="button" data-reader-action="${action}">${label}</button>`;
// Preserve the selected view through shell/theme repaint, with a bounded cache.
const viewModes=new Map();
export function readerHTML(doc) {
  const tabs=doc.format==='latex'?button('source','源码')+button('formulas','公式'):doc.format==='docx'?button('readable','正文')+button('layout','原始版式'):'';
  const pdf=doc.format==='pdf'?`${button('previous','上一页')}<input data-reader-page type="number" min="1" value="1" aria-label="页码"><span data-reader-pages></span>${button('next','下一页')}${button('zoom-out','缩小')}${button('zoom-in','放大')}`:'';
  return `<div class="document-reader" data-reader-format="${escape(doc.format)}"><div class="reader-controls">${tabs}${pdf}</div><div class="reader-surface" data-i18n-skip data-preview-doc data-resource-id="${escape(doc.id)}"></div><div class="reader-error" role="alert"></div></div>`;
}

export async function mountReader(root,doc,{page=1,highlight,onReady=()=>{}}={}) {
  const surface=root.querySelector('.reader-surface');
  let disposed=false,editor,loadingTask,pdfViewer,findController,eventBus;
  const report=error=>{if(!disposed)root.querySelector('.reader-error').textContent=error.message;};
  const bytes=()=>hostBlob('library/content?'+new URLSearchParams({id:doc.id})).then(b=>b.arrayBuffer());
  const clear=()=>{editor?.destroy();editor=null;surface.replaceChildren();surface.className='reader-surface';surface.setAttribute('data-preview-doc','');};
  function code(){
    clear();const mode=doc.format==='latex'?stex:/^(js|mjs|cjs|ts|json)$/i.test(doc.kind)?javascript:/^py$/i.test(doc.kind)?python:null;
    editor=new EditorView({parent:surface,state:EditorState.create({doc:doc.text||'',extensions:[lineNumbers(),drawSelection(),EditorView.lineWrapping,EditorState.readOnly.of(true),EditorView.editable.of(false),syntaxHighlighting(defaultHighlightStyle),...(mode?[StreamLanguage.define(mode)]:[])]})});
    onReady();
  }
  let displayGeneration=0;
  async function display(mode){
    if(disposed)return;clear();
    viewModes.delete(doc.id);viewModes.set(doc.id,mode);if(viewModes.size>20)viewModes.delete(viewModes.keys().next().value);
    for(const tab of root.querySelectorAll('[data-reader-action]'))tab.setAttribute('aria-pressed',String(tab.dataset.readerAction===mode));
    const generation=++displayGeneration;
    if(doc.format==='latex'&&mode==='formulas'){
      surface.innerHTML=(doc.blocks||[]).filter(b=>b.kind==='equation').map(b=>`<section><h4>${escape(b.section||'')}</h4>${mathHTML(b.text.replace(/^\s*(?:\$\$|\\\[)|(?:\$\$|\\\])\s*$/g,'').replace(/\\(?:begin|end)\{(?:equation\*?|displaymath)\}/g,''),true)}</section>`).join('');
    }else if(doc.format==='docx'&&mode==='layout'){
      surface.removeAttribute('data-preview-doc');
      const content=await bytes();if(disposed||generation!==displayGeneration)return;
      const detached=document.createElement('div');
      await renderDocx(content,detached,undefined,{ignoreFonts:true,useBase64URL:true,renderComments:false,renderAltChunks:false});
      if(disposed||generation!==displayGeneration)return;
      // DOCX is untrusted input, including hyperlinks and embedded HTML.
      surface.innerHTML=DOMPurify.sanitize(detached.innerHTML,{FORBID_TAGS:['script','iframe','object','embed'],FORBID_ATTR:['srcset']});
      for(const el of surface.querySelectorAll('[src],[href]')){for(const attr of ['src','href']){const v=el.getAttribute(attr);if(v&&!v.startsWith('data:image/')&&!v.startsWith('#'))el.removeAttribute(attr);}}
    }else if(doc.format==='docx'){
      surface.innerHTML=DOMPurify.sanitize(doc.html||'',{FORBID_TAGS:['style','iframe','object','embed'],FORBID_ATTR:['style','srcset']});
      for(const el of surface.querySelectorAll('img'))if(!el.src.startsWith('data:image/'))el.remove();
      for(const el of surface.querySelectorAll('a'))el.removeAttribute('href');
    }else if(doc.format==='markdown')surface.innerHTML=renderMarkdown(doc.text);
    else if(doc.format==='csv'){
      const parsed=Papa.parse(doc.text||'',{preview:501,skipEmptyLines:true});
      surface.innerHTML=DOMPurify.sanitize(`<table><tbody>${parsed.data.slice(0,500).map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    }else{code();return;}
    onReady();
  }
  async function pdf(){
    const lib=await import('./vendor/pdf/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc=new URL('./pdf-worker.mjs',import.meta.url).href;
    const {PDFViewer,EventBus,PDFFindController,PDFLinkService}=await import('./vendor/pdf/pdf_viewer.mjs');
    if(disposed)return;
    surface.classList.add('reader-pdf');surface.innerHTML='<div class="reader-pdf-scroll"><div class="pdfViewer"></div></div>';
    eventBus=new EventBus();const linkService=new PDFLinkService({eventBus});findController=new PDFFindController({eventBus,linkService});
    pdfViewer=new PDFViewer({container:surface.firstElementChild,viewer:surface.querySelector('.pdfViewer'),eventBus,linkService,findController,annotationMode:lib.AnnotationMode.DISABLE,enableAutoLinking:false,maxCanvasPixels:8_000_000});
    linkService.setViewer(pdfViewer);
    eventBus.on('pagesinit',()=>{pdfViewer.currentScaleValue='page-width';pdfViewer.currentPageNumber=Math.min(Math.max(1,page),pdfViewer.pagesCount);focus({page,highlight});});
    eventBus.on('pagechanging',({pageNumber})=>{root.querySelector('[data-reader-page]').value=pageNumber;});
    eventBus.on('textlayerrendered',()=>onReady());
    const data=new Uint8Array(await bytes());if(disposed)return;
    const base=new URL('./vendor/pdf/',import.meta.url).href;
    loadingTask=lib.getDocument({data,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',iccUrl:base+'iccs/',isEvalSupported:false});
    const document=await loadingTask.promise;if(disposed)return;
    // Initialize before exposing a disposable viewer. PDFViewer resets its
    // capabilities during setDocument(null); aborting its first-page request
    // then rejects a newly created, unobserved capability inside upstream.
    // Warm these public, cached requests while we still own initialization.
    await Promise.all([document.getPage(1),document.getMetadata()]);
    if(disposed)return;
    root.querySelector('[data-reader-pages]').textContent='/ '+document.numPages;root.querySelector('[data-reader-page]').max=document.numPages;
    linkService.setDocument(document);pdfViewer.setDocument(document);
    // PDFViewer exposes initialization promises. A rapid resource switch can
    // abort first-page loading and reject pagesPromise after setDocument(null).
    // Observe those promises; only this reader's explicit disposal is silent.
    for(const promise of [pdfViewer.firstPagePromise,pdfViewer.pagesPromise])promise?.catch(report);
    await pdfViewer.firstPagePromise;
  }
  function focus(target={}){
    if(pdfViewer?.pagesCount){if(target.page)pdfViewer.currentPageNumber=Math.max(1,Math.min(target.page,pdfViewer.pagesCount));if(target.highlight)eventBus.dispatch('find',{source:root,type:'',query:target.highlight,caseSensitive:false,entireWord:false,highlightAll:true,findPrevious:false});return true;}
    return false;
  }
  function location(range){
    if(editor){
      const position=editor.posAtDOM(range.startContainer,range.startOffset);
      return {description:`第 ${editor.state.doc.lineAt(position).number} 行`};
    }
    const node=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const pageElement=node?.closest('.page');if(!pageElement)return null;
    const bounds=pageElement.getBoundingClientRect(),scale=pdfViewer.currentScale;
    return {page:Number(pageElement.dataset.pageNumber),quote:{exact:range.toString(),prefix:'',suffix:''},rects:[...range.getClientRects()].filter(r=>r.width&&r.height&&r.top<bounds.bottom&&r.bottom>bounds.top).map(r=>[(r.left-bounds.left)/scale,(r.top-bounds.top)/scale,r.width/scale,r.height/scale])};
  }
  const click=event=>{const action=event.target.closest('[data-reader-action]')?.dataset.readerAction;if(!action)return;
    if(pdfViewer?.pagesCount){if(action==='previous')pdfViewer.previousPage();if(action==='next')pdfViewer.nextPage();if(action==='zoom-in')pdfViewer.currentScale=Math.min(4,pdfViewer.currentScale*1.2);if(action==='zoom-out')pdfViewer.currentScale=Math.max(.25,pdfViewer.currentScale/1.2);}
    else void display(action).catch(report);
  };
  const change=event=>{if(event.target.matches('[data-reader-page]'))focus({page:Number(event.target.value)});};
  root.addEventListener('click',click);root.addEventListener('change',change);
  try{if(doc.format==='pdf')await pdf();else await display(viewModes.get(doc.id)||(doc.format==='docx'?'readable':'source'));}catch(error){report(error);}
  return {focus,location,dispose(){disposed=true;root.removeEventListener('click',click);root.removeEventListener('change',change);editor?.destroy();pdfViewer?.setDocument(null);loadingTask?.destroy().catch(()=>{});}};
}
