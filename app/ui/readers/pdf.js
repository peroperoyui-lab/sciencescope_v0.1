import './polyfills.js';
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import {
  PDFViewer,
  EventBus,
  PDFFindController,
  PDFLinkService,
} from 'pdfjs-dist/web/pdf_viewer.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf-worker.js', import.meta.url).href;

/** The page number a bookmark's destination points at, or null. @param {any} doc @param {any} dest */
async function pageOf(doc, dest) {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    const ref = explicit?.[0];
    if (ref == null) return null;
    return (typeof ref === 'number' ? ref : await doc.getPageIndex(ref)) + 1;
  } catch {
    return null;
  }
}

/**
 * The PDF's bookmarks as outline entries; empty when it has none.
 * @param {any} doc @returns {Promise<{level:number,text:string,page:number|null}[]>}
 */
async function bookmarks(doc) {
  const entries = [];
  const walk = async (items, level) => {
    for (const item of items ?? []) {
      const text = item.title?.trim();
      if (text) entries.push({ level, text, page: await pageOf(doc, item.dest) });
      await walk(item.items, level + 1);
    }
  };
  await walk(await doc.getOutline().catch(() => null), 0);
  return entries;
}

/**
 * The first page of a PDF as a PNG, for a figure a TeX file includes.
 * @param {ArrayBuffer} bytes @returns {Promise<Blob | null>}
 */
export async function pdfPicture(bytes) {
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes), wasmUrl: '/vendor/pdf/wasm/' });
  try {
    const page = await (await loading.promise).getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } finally {
    void loading.destroy().catch(() => {});
  }
}

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
    outline: () => bookmarks(doc),
    zoom: (factor) => {
      viewer.currentScale *= factor;
    },
    dispose() {
      viewer.setDocument(null);
      void loading.destroy().catch(() => {});
    },
  };
}
