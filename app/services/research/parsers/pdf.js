import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AppError } from '../../../core/errors.js';
import { readPageLines, removeRunningEdges } from './pdf-layout.js';
import { blocksFromLines, pdfMetadata } from './pdf-content.js';

const buildDirectory = path.dirname(
  fileURLToPath(import.meta.resolve('pdfjs-dist/legacy/build/pdf.mjs')),
);
// The Node pdfjs reader takes filesystem paths, including a trailing separator.
const assetDirectory = (name) =>
  `${path.resolve(buildDirectory, '../../', name).replaceAll('\\', '/')}/`;

/** @type {import('./types.js').DocumentParser} */
export const pdfParser = {
  id: 'pdf',
  extensions: ['.pdf'],
  async parse(bytes) {
    const loading = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useWorkerFetch: false,
      cMapUrl: assetDirectory('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: assetDirectory('standard_fonts'),
      useSystemFonts: true,
    });
    try {
      const document = await loading.promise;
      const pages = [];
      for (let number = 1; number <= document.numPages; number += 1) {
        const page = await document.getPage(number);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          pages.push({
            page: number,
            height: viewport.height,
            lines: readPageLines(content, viewport),
          });
        } finally {
          page.cleanup();
        }
      }
      if (!pages.some((page) => page.lines.length)) {
        throw new AppError(
          'PARSER_UNSUPPORTED',
          'PDF has no extractable text; OCR is not available.',
        );
      }
      const lines = removeRunningEdges(pages);
      const blocks = blocksFromLines(lines, document.numPages);
      const result = await document.getMetadata();
      return {
        blocks,
        pages: document.numPages,
        metadata: pdfMetadata(result.info, lines, blocks),
      };
    } finally {
      await loading.destroy();
    }
  },
};
