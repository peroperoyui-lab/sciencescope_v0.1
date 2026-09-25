import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareDesktop, defaultRoot } from './prepare-desktop.mjs';

// Keep the approved source intact. Only the generated desktop entry gets wiring.
export const DESKTOP_ASSETS = ['model-settings.mjs', 'model-settings.css', 'provider-draft.mjs', 'host-client.mjs', 'live-chat.mjs', 'turn-activity.mjs', 'main-outbox.mjs', 'background-activity.mjs', 'context-meter.mjs', 'native-window.mjs', 'markdown.mjs', 'chat.css', 'workspace.mjs', 'workspace-layout.mjs', 'workspace.css', 'preferences.mjs', 'workbench.mjs', 'workbench.css', 'library.mjs', 'execution.mjs', 'assistant-chat.mjs', 'assistant-chat.css', 'reasoning.mjs', 'work-mode.mjs', 'discussion.mjs', 'composer-menu.mjs', 'desktop-behavior.mjs', 'desktop-behavior.css'];
DESKTOP_ASSETS.push('refresh.css','refresh.mjs','settings.mjs','role-settings.mjs','expert-settings.mjs','extensions.mjs','settings.css','secretary-settings.mjs','shortcuts.mjs','assistant-window-settings.mjs','research-input.mjs');
DESKTOP_ASSETS.push('file-preview.mjs','marks.css','creation-details.mjs','info-tip.mjs');
export async function buildDesktop({ root = defaultRoot, outputDir = path.join(root, '.sciencescope-local', 'desktop-dist') } = {}) {
  const assets = DESKTOP_ASSETS;
  await Promise.all(assets.map(file => readFile(path.join(root, 'desktop', file))));
  const result = await prepareDesktop({root, outputDir});
  const html = await readFile(result.output, 'utf8');
  if (!html.includes('</body>')) throw new Error('Desktop entry requires a closing body tag');
  await mkdir(path.join(outputDir, 'desktop'), {recursive:true});
  for (const file of assets) await copyFile(path.join(root, 'desktop', file), path.join(outputDir, 'desktop', file));
  await mkdir(path.join(outputDir, 'desktop', 'vendor'), {recursive:true});
  for (const [source, target] of [['marked/lib/marked.esm.js','marked.mjs'],['dompurify/dist/purify.es.mjs','purify.mjs']]) {
    await copyFile(path.join(root, 'node_modules', source), path.join(outputDir, 'desktop', 'vendor', target));
  }
  const extension = '<script type="module" src="./desktop/info-tip.mjs"></script><script type="module" src="./desktop/desktop-behavior.mjs"></script><script type="module" src="./desktop/model-settings.mjs"></script><script type="module" src="./desktop/live-chat.mjs"></script><script type="module" src="./desktop/preferences.mjs"></script><script type="module" src="./desktop/native-window.mjs"></script><script type="module" src="./desktop/workbench.mjs"></script><script type="module" src="./desktop/library.mjs"></script><script type="module" src="./desktop/execution.mjs"></script><script type="module" src="./desktop/work-mode.mjs"></script><script type="module" src="./desktop/discussion.mjs"></script><script type="module" src="./desktop/refresh.mjs"></script><script type="module" src="./desktop/file-preview.mjs"></script><script type="module" src="./desktop/creation-details.mjs"></script><script type="module" src="./desktop/reasoning.mjs"></script><script type="module" src="./desktop/assistant-chat.mjs"></script>';
  // The inherited renderer replaces body contents. Styles must live in head.
  const styles = '<link rel="stylesheet" href="./desktop/model-settings.css"><link rel="stylesheet" href="./desktop/chat.css"><link rel="stylesheet" href="./desktop/workspace.css"><link rel="stylesheet" href="./desktop/workbench.css"><link rel="stylesheet" href="./desktop/desktop-behavior.css"><link rel="stylesheet" href="./desktop/assistant-chat.css">';
  await writeFile(result.output, html.replace('</head>', `${styles}<link rel="stylesheet" href="./desktop/settings.css"><link rel="stylesheet" href="./desktop/refresh.css"><link rel="stylesheet" href="./desktop/marks.css"></head>`).replace('</body>', `${extension}</body>`));
  return result.output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildDesktop().then(() => console.log('Desktop entry prepared with model-settings UI.')).catch(error => { console.error(error.message); process.exitCode = 1; });
}
