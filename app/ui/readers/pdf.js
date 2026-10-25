import './polyfills.js';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import {
  PDFViewer,
  EventBus,
  PDFFindController,
  PDFLinkService,
} from 'pdfjs-dist/web/pdf_viewer.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf-worker.js', import.meta.url).href;

/**
 * @param {HTMLElement} surface
 * @param {ArrayBuffer} bytes
 * @param {{page?:number,highlight?:string,onPage:(page:number,total:number)=>void}} options
 */
export async function mountPdf(surface, bytes, options) {
  surface.classList.add('reader-pdf');
  surface.innerHTML = '<div class="reader-pdf-scroll"><div class="pdfViewer"></div></div>';
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const findController = new PDFFindController({ eventBus, linkService });
  const viewer = new PDFViewer({
    container: /** @type {HTMLDivElement} */ (surface.firstElementChild),
    viewer: surface.querySelector('.pdfViewer'),
    eventBus,
    linkService,
    findController,
    annotationMode: pdfjs.AnnotationMode.DISABLE,
    enableAutoLinking: false,
  });
  linkService.setViewer(viewer);
  const loading = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    cMapUrl: '/vendor/pdf/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdf/standard_fonts/',
    wasmUrl: '/vendor/pdf/wasm/',
    iccUrl: '/vendor/pdf/iccs/',
  });
  const doc = await loading.promise;
  await Promise.all([doc.getPage(1), doc.getMetadata()]);
  const focus = ({ page = 1, highlight = '' }) => {
    if (page) viewer.currentPageNumber = Math.max(1, Math.min(page, doc.numPages));
    if (highlight)
      eventBus.dispatch('find', {
        source: surface,
        type: '',
        query: highlight,
        caseSensitive: false,
        entireWord: false,
        highlightAll: true,
        findPrevious: false,
      });
  };
  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = 'page-width';
    focus(options);
  });
  eventBus.on('pagechanging', ({ pageNumber }) => options.onPage(pageNumber, doc.numPages));
  linkService.setDocument(doc);
  viewer.setDocument(doc);
  viewer.firstPagePromise?.catch(() => {});
  viewer.pagesPromise?.catch(() => {});
  await viewer.firstPagePromise;
  options.onPage(options.page ?? 1, doc.numPages);
  return {
    viewer,
    eventBus,
    focus,
    zoom: (factor) => {
      viewer.currentScale *= factor;
    },
    dispose() {
      viewer.setDocument(null);
      void loading.destroy().catch(() => {});
    },
  };
}
