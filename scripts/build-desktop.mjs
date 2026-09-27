import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareDesktop, defaultRoot } from './prepare-desktop.mjs';
import { build as bundle } from 'esbuild';

// Keep the approved source intact. Only the generated desktop entry gets wiring.
export const DESKTOP_ASSETS = ['model-settings.mjs', 'model-settings.css', 'provider-draft.mjs', 'host-client.mjs', 'live-chat.mjs', 'turn-activity.mjs', 'main-outbox.mjs', 'background-activity.mjs', 'context-meter.mjs', 'native-window.mjs', 'markdown.mjs', 'chat.css', 'workspace.mjs', 'workspace-layout.mjs', 'workspace.css', 'preferences.mjs', 'workbench.mjs', 'workbench.css', 'library.mjs', 'execution.mjs', 'assistant-chat.mjs', 'assistant-chat.css', 'reasoning.mjs', 'work-mode.mjs', 'discussion.mjs', 'composer-menu.mjs', 'desktop-behavior.mjs', 'desktop-behavior.css'];
DESKTOP_ASSETS.push('refresh.css','refresh.mjs','settings.mjs','role-settings.mjs','expert-settings.mjs','extensions.mjs','settings.css','secretary-settings.mjs','shortcuts.mjs','assistant-window-settings.mjs','research-input.mjs');
DESKTOP_ASSETS.push('file-preview.mjs','marks.css','creation-details.mjs','info-tip.mjs','features.mjs','deliverables.mjs','i18n.mjs','i18n-en.mjs','minutes.mjs');
DESKTOP_ASSETS.push('math-render.mjs','document-readers.mjs','document-readers.css','js-polyfills.mjs','pdf-worker.mjs');
DESKTOP_ASSETS.push('research-base.mjs','research-base.css','research-citations.mjs');
// Third-party files copied from node_modules and served verbatim. The build and
// the production router both use this list, so they cannot drift apart.
// The default interface font is 思源黑体 (Noto Sans SC, SIL OFL 1.1), split
// into unicode-range subsets that load only when their characters appear.
const FONT_PACKAGE = '@fontsource-variable/noto-sans-sc';
const vendorTree = (target, source) => readdirSync(path.join(defaultRoot, 'node_modules', source), {recursive:true, withFileTypes:true})
  .filter(entry => entry.isFile() && !entry.name.endsWith('.map'))
  .map(entry => {
    const relative = path.relative(path.join(defaultRoot, 'node_modules', source), path.join(entry.parentPath, entry.name)).replaceAll('\\','/');
    const type = relative.endsWith('.woff2') ? 'font/woff2' : relative.endsWith('.woff') ? 'font/woff' : relative.endsWith('.ttf') ? 'font/ttf' : relative.endsWith('.svg') ? 'image/svg+xml' : relative.endsWith('.gif') ? 'image/gif' : relative.endsWith('.css') ? 'text/css; charset=utf-8' : relative.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream';
    return [`${target}/${relative}`, `${source}/${relative}`, type];
  });
export const VENDOR_ASSETS = [
  ['marked.mjs', 'marked/lib/marked.esm.js', 'text/javascript; charset=utf-8'],
  ['purify.mjs', 'dompurify/dist/purify.es.mjs', 'text/javascript; charset=utf-8'],
  ['noto-sans-sc/wght.css', `${FONT_PACKAGE}/wght.css`, 'text/css; charset=utf-8'],
  ['noto-sans-sc/LICENSE', `${FONT_PACKAGE}/LICENSE`, 'text/plain; charset=utf-8'],
  ...readdirSync(path.join(defaultRoot, 'node_modules', FONT_PACKAGE, 'files')).filter(file => file.endsWith('.woff2'))
    .map(file => [`noto-sans-sc/files/${file}`, `${FONT_PACKAGE}/files/${file}`, 'font/woff2']),
  ['katex/katex.mjs', 'katex/dist/katex.mjs', 'text/javascript; charset=utf-8'],
  ['katex/katex.min.css', 'katex/dist/katex.min.css', 'text/css; charset=utf-8'],
  ['katex/LICENSE', 'katex/LICENSE', 'text/plain; charset=utf-8'],
  ...vendorTree('katex/fonts', 'katex/dist/fonts'),
  ['pdf/pdf.mjs', 'pdfjs-dist/build/pdf.mjs', 'text/javascript; charset=utf-8'],
  ['pdf/pdf.worker.mjs', 'pdfjs-dist/build/pdf.worker.mjs', 'text/javascript; charset=utf-8'],
  ['pdf/pdf_viewer.mjs', 'pdfjs-dist/web/pdf_viewer.mjs', 'text/javascript; charset=utf-8'],
  ['pdf/pdf_viewer.css', 'pdfjs-dist/web/pdf_viewer.css', 'text/css; charset=utf-8'],
  ['pdf/LICENSE', 'pdfjs-dist/LICENSE', 'text/plain; charset=utf-8'],
  ...vendorTree('pdf/images', 'pdfjs-dist/web/images'),
  ...vendorTree('pdf/cmaps', 'pdfjs-dist/cmaps'),
  ...vendorTree('pdf/standard_fonts', 'pdfjs-dist/standard_fonts'),
  ...vendorTree('pdf/wasm', 'pdfjs-dist/wasm'),
  ...vendorTree('pdf/iccs', 'pdfjs-dist/iccs'),
];
export const GENERATED_ASSETS = [['vendor/reader-vendor.mjs', 'text/javascript; charset=utf-8']];
let readerBundle;

export async function buildDesktop({ root = defaultRoot, outputDir = path.join(root, '.sciencescope-local', 'desktop-dist') } = {}) {
  const assets = DESKTOP_ASSETS;
  await Promise.all(assets.map(file => readFile(path.join(root, 'desktop', file))));
  const result = await prepareDesktop({root, outputDir});
  // The prototype's copy icon supplied SVG markup where ic() expects path data.
  // Repair the generated runtime entry only; preserve the approved source file.
  const html = (await readFile(result.output, 'utf8')).replace(
    `iconPaths.copy ||= '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>';`,
    `iconPaths.copy ||= 'M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M16 8V4H4v12h4';`);
  if (!html.includes('</body>')) throw new Error('Desktop entry requires a closing body tag');
  await mkdir(path.join(outputDir, 'desktop'), {recursive:true});
  for (const file of assets) await copyFile(path.join(root, 'desktop', file), path.join(outputDir, 'desktop', file));
  await mkdir(path.join(outputDir, 'desktop', 'vendor', 'noto-sans-sc', 'files'), {recursive:true});
  for (const [target, source] of VENDOR_ASSETS) {
    const destination = path.join(outputDir, 'desktop', 'vendor', target);
    await mkdir(path.dirname(destination), {recursive:true});
    await copyFile(path.join(root, 'node_modules', source), destination);
  }
  readerBundle ??= bundle({entryPoints:[path.join(root,'desktop/reader-vendor-entry.mjs')], bundle:true, format:'esm', platform:'browser', target:'es2022', write:false, legalComments:'inline'});
  const compiled = await readerBundle;
  await writeFile(path.join(outputDir,'desktop/vendor/reader-vendor.mjs'), compiled.outputFiles[0].contents);
  const extension = '<script type="module" src="./desktop/i18n.mjs"></script><script type="module" src="./desktop/info-tip.mjs"></script><script type="module" src="./desktop/features.mjs"></script><script type="module" src="./desktop/desktop-behavior.mjs"></script><script type="module" src="./desktop/model-settings.mjs"></script><script type="module" src="./desktop/live-chat.mjs"></script><script type="module" src="./desktop/preferences.mjs"></script><script type="module" src="./desktop/native-window.mjs"></script><script type="module" src="./desktop/workbench.mjs"></script><script type="module" src="./desktop/library.mjs"></script><script type="module" src="./desktop/execution.mjs"></script><script type="module" src="./desktop/work-mode.mjs"></script><script type="module" src="./desktop/discussion.mjs"></script><script type="module" src="./desktop/refresh.mjs"></script><script type="module" src="./desktop/file-preview.mjs"></script><script type="module" src="./desktop/creation-details.mjs"></script><script type="module" src="./desktop/minutes.mjs"></script><script type="module" src="./desktop/reasoning.mjs"></script><script type="module" src="./desktop/assistant-chat.mjs"></script>';
  // The inherited renderer replaces body contents. Styles must live in head.
  const styles = '<link rel="stylesheet" href="./desktop/vendor/noto-sans-sc/wght.css"><link rel="stylesheet" href="./desktop/model-settings.css"><link rel="stylesheet" href="./desktop/chat.css"><link rel="stylesheet" href="./desktop/workspace.css"><link rel="stylesheet" href="./desktop/workbench.css"><link rel="stylesheet" href="./desktop/desktop-behavior.css"><link rel="stylesheet" href="./desktop/assistant-chat.css">';
  const readerStyles = '<link rel="stylesheet" href="./desktop/vendor/pdf/pdf_viewer.css"><link rel="stylesheet" href="./desktop/vendor/katex/katex.min.css">';
  await writeFile(result.output, html.replace('</head>', `${readerStyles}${styles}<link rel="stylesheet" href="./desktop/settings.css"><link rel="stylesheet" href="./desktop/refresh.css"><link rel="stylesheet" href="./desktop/marks.css"><link rel="stylesheet" href="./desktop/document-readers.css"><link rel="stylesheet" href="./desktop/research-base.css"></head>`).replace('</body>', `${extension}<script type="module" src="./desktop/research-base.mjs"></script><script type="module" src="./desktop/research-citations.mjs"></script></body>`));
  return result.output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildDesktop().then(() => console.log('Desktop entry prepared with model-settings UI.')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
