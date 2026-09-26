// Offline browser smoke for T04 document readers. Uses the production asset
// router/API, generated PDF and DOCX fixtures, and an installed Edge browser.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createDesktopServer } from './preview-desktop.mjs';
import { apiFetch, installApiToken } from './smoke-auth.mjs';
import { createChineseDocxFixture, createPdfFixture } from '../tests/helpers/document-fixtures.mjs';

const output = path.resolve('.sciencescope-local/temp/local-validation-r4/viewer-ui');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(output, 'run-'));
process.env.TEMP = root;
process.env.TMP = root;

const formulaAnswer = [
  '# Formula answer',
  '',
  'Inline mass-energy is $E=mc^2$ and parenthesized math is \\(a^2+b^2=c^2\\).',
  '',
  '$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$',
  '',
  'The code span `$not_math$` and fenced code stay literal:',
  '',
  '```text',
  '$$not_math$$',
  '```',
].join('\n');
const markdown = [
  '# Markdown mathematics',
  '',
  'Inline $\\alpha+\\beta=\\gamma$ appears beside prose.',
  '',
  '$$\\sum_{i=1}^{n} i=\\frac{n(n+1)}{2}$$',
  '',
  '```javascript',
  'const literal = "$not_math$";',
  '```',
].join('\n');
const latex = String.raw`\title{Viewer Fixture}
\author{Ada Lovelace}
\begin{document}
\section{Energy}
The source tab remains readable.
\begin{equation}
E = mc^2
\end{equation}
\subsection{Integral}
\[
\int_0^1 x^2\,dx = \frac{1}{3}
\]
\end{document}`;
const textFixture = 'Plain text viewer line one.\nPlain text viewer line two.';
const csvFixture = 'variable,result\nalpha,significant\nbeta,stable\n';

let browser;
let server;
let page;
const pageErrors = [];
const failedRequests = [];
const modelCalls = [];
const docxLayoutAudits = [];
let phase = 'setup';

const runtimeHost = {
  capabilities: { tokenStreaming: true },
  listProviders: async () => [{ id: 'viewer-fixture', name: 'Viewer Fixture', models: ['offline'] }],
  getModelInfo: async () => ({}),
  getRuntimeConfig: async () => ({}),
  startSession: async ({ sessionId, noTools }) => noTools ? 'viewer-minutes' : sessionId || 'viewer-main',
  configurePolicy: async () => {},
  configureReasoning: async () => {},
  observeSession: () => () => {},
  getContextUsage: async () => null,
  releaseSession: async () => {},
  close: async () => {},
  send: async ({ sessionId, text, onEvent }) => {
    if (sessionId === 'viewer-minutes') return { finalResponse: 'VIEWER_MINUTES' };
    modelCalls.push(text);
    onEvent({ type: 'text-delta', delta: formulaAnswer });
    onEvent({ type: 'completed', text: formulaAnswer });
  },
};

async function importResource(name, bytes) {
  const response = await apiFetch(server, 'api/library/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, base64: Buffer.from(bytes).toString('base64'), projectId: null }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `${name} import: ${JSON.stringify(body)}`);
  assert.ok(body.id, `${name} resource id`);
  return body;
}

async function ingest(resourceId) {
  const response = await apiFetch(server, 'api/research/sources/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceId, wait: true }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, `ingest ${resourceId}: ${JSON.stringify(body)}`);
  assert.equal(body.source.contentStatus, 'parsed');
  return body;
}

async function setAppearance(language, theme) {
  await page.evaluate(({ language, theme }) => {
    window.ScienceScopeI18n.setLanguage(language);
    document.documentElement.dataset.theme = theme;
  }, { language, theme });
  await page.waitForTimeout(120);
}

async function captureMatrix(prefix, prepare) {
  for (const language of ['zh-CN', 'en']) {
    for (const theme of ['light', 'dark']) {
      await setAppearance(language, theme);
      await prepare?.({ language, theme });
      await page.screenshot({ path: path.join(output, `${prefix}-${language}-${theme}.png`), fullPage: false });
    }
  }
}

async function openPreview(resourceId, options = {}) {
  await page.evaluate(({ resourceId, options }) => window.ScienceScopePreview.open(resourceId, options), { resourceId, options });
  await page.waitForFunction((id) => document.querySelector('.file-preview-panel [data-preview-doc]')?.dataset.resourceId === id, resourceId);
}

try {
  server = await createDesktopServer({ dataRoot: root, outputDir: path.join(root, 'assets'), runtimeHost });
  const resources = {
    pdf: await importResource('viewer-fixture.pdf', await createPdfFixture()),
    docx: await importResource('中文阅读器.docx', await createChineseDocxFixture()),
    markdown: await importResource('formula-notes.md', Buffer.from(markdown)),
    latex: await importResource('equations.tex', Buffer.from(latex)),
    text: await importResource('plain.txt', Buffer.from(textFixture)),
    csv: await importResource('results.csv', Buffer.from(csvFixture)),
  };

  const chatResponse = await apiFetch(server, 'api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chatId: 'viewer-chat', projectId: null, text: 'Render formulas offline.',
      model: { providerId: 'viewer-fixture', modelId: 'offline' },
      userMessageId: 'viewer-user', assistantMessageId: 'viewer-answer',
    }),
  });
  await chatResponse.text();
  assert.equal(chatResponse.status, 200);

  browser = await chromium.launchPersistentContext(path.join(root, 'profile'), {
    headless: true,
    viewport: { width: 1440, height: 960 },
    executablePath: process.env.SCIENCESCOPE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    env: { ...process.env, TEMP: root, TMP: root },
  });
  page = await browser.newPage();
  await installApiToken(page, server);
  page.on('pageerror', (error) => pageErrors.push({ phase, message: error.message, stack: error.stack || '' }));
  page.on('requestfailed', (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  await page.goto(server.url);
  await page.waitForFunction(() => window.ScienceScopeWorkspace?.ready && window.ScienceScopePreview && window.ScienceScopeResearchInput);
  await page.evaluate(async () => { await window.ScienceScopeWorkspace.ready; await window.SSV2.loadThread('viewer-chat'); });
  await page.waitForSelector('#message-viewer-answer .message-text');
  await setAppearance('zh-CN', 'light');

  // PDF: unparsed -> explicit reparse, page 2 + find highlight, then a real
  // text-layer selection produces a page/quote/rect annotation.
  phase = 'pdf';
  await openPreview(resources.pdf.id, { page: 2, highlight: 'The second page confirms page-aware extraction' });
  await page.waitForSelector('.document-reader[data-reader-format="pdf"]');
  assert.equal((await page.locator('.reader-status span').first().innerText()).trim(), '未解析');
  await page.locator('[data-preview-reparse]').click();
  await page.waitForFunction(() => document.querySelector('.reader-status span')?.textContent.trim() === '已解析');
  await page.waitForFunction(() => {
    const pageTwo = document.querySelector('.page[data-page-number="2"] .textLayer');
    return document.querySelector('[data-reader-page]')?.value === '2' && pageTwo?.textContent.includes('The second page confirms page-aware extraction');
  });
  await page.waitForSelector('.page[data-page-number="2"] .textLayer .highlight');
  const pdfSelection = await page.evaluate(() => {
    const needle = 'The second page confirms page-aware extraction and section paths.';
    const layer = document.querySelector('.page[data-page-number="2"] .textLayer');
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const nodes = []; let fullText = ''; let node;
    while ((node = walker.nextNode())) {
      const start = fullText.length; fullText += node.data;
      nodes.push({ node, start, end: fullText.length });
    }
    const start = fullText.indexOf(needle);
    if (start < 0) return null;
    const end = start + needle.length;
    const first = nodes.find((item) => item.start <= start && item.end > start);
    const last = nodes.find((item) => item.start < end && item.end >= end);
    if (!first || !last) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const rect = range.getBoundingClientRect();
    layer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: rect.left + 4, clientY: rect.bottom }));
    return range.toString();
  });
  assert.match(pdfSelection, /second page confirms/u);
  await page.locator('[data-research-selection] [data-mark-comment]').fill('PDF page two mark');
  await page.locator('[data-research-selection] [data-add]').click();
  await page.waitForFunction(() => document.querySelector('[data-composer="main"] [data-marks-toggle]')?.textContent.includes('1'));
  const pdfMark = await page.evaluate(async (resourceId) => (await window.ScienceScopeResearchInput.capture('main', V.chat)).annotations.find((item) => item.resourceId === resourceId), resources.pdf.id);
  assert.equal(pdfMark.location.page, 2);
  assert.match(pdfMark.location.quote.exact, /second page confirms/u);
  assert.ok(pdfMark.location.rects.length > 0);
  assert.ok(pdfMark.location.rects.every((rect) => rect.length === 4 && rect.every(Number.isFinite)));
  await page.waitForFunction(() => CSS.highlights.has('ss-marks'));
  await captureMatrix('pdf-page2-highlight-mark');

  // DOCX: semantic HTML is selectable; layout mode renders a separate,
  // read-only docx-preview tree without the marking surface attribute.
  phase = 'docx';
  await ingest(resources.docx.id);
  await setAppearance('zh-CN', 'light');
  await openPreview(resources.docx.id);
  await page.waitForFunction(() => document.querySelector('.document-reader[data-reader-format="docx"] .reader-surface')?.textContent.includes('这是一个可检索的中文段落'));
  assert.equal(await page.locator('.document-reader[data-reader-format="docx"] .reader-surface h1').innerText(), '中文研究标题');
  assert.equal(await page.locator('.document-reader[data-reader-format="docx"] .reader-surface table').count(), 1);
  assert.ok(await page.locator('.document-reader[data-reader-format="docx"] .reader-surface').getAttribute('data-preview-doc') !== null);
  await captureMatrix('docx-readable', async () => {
    await page.locator('[data-reader-action="readable"]').click();
    await page.waitForFunction(() => {
      const surface = document.querySelector('.document-reader[data-reader-format="docx"] .reader-surface');
      return surface?.hasAttribute('data-preview-doc') && surface.textContent.includes('这是一个可检索的中文段落');
    });
    assert.equal(await page.locator('.document-reader[data-reader-format="docx"] .reader-surface .docx-wrapper, .document-reader[data-reader-format="docx"] .reader-surface section.docx').count(), 0);
    assert.match(await page.locator('.document-reader[data-reader-format="docx"] .reader-surface').innerText(), /结果/u, 'DOCX user content is never translated');
  });
  await page.locator('[data-reader-action="layout"]').click();
  await page.waitForFunction(() => {
    const surface = document.querySelector('.document-reader[data-reader-format="docx"] .reader-surface');
    return surface?.textContent.includes('中文研究标题') && surface.querySelector('.docx-wrapper,section.docx');
  });
  assert.equal(await page.locator('.document-reader[data-reader-format="docx"] .reader-surface').getAttribute('data-preview-doc'), null);
  await captureMatrix('docx-layout', async ({ language, theme }) => {
    await page.locator('[data-reader-action="layout"]').click();
    await page.waitForFunction(() => {
      const surface = document.querySelector('.document-reader[data-reader-format="docx"] .reader-surface');
      return !surface?.hasAttribute('data-preview-doc') && surface?.textContent.includes('中文研究标题') && surface.querySelector('.docx-wrapper,section.docx');
    });
    const audit = await page.locator('.document-reader[data-reader-format="docx"]').evaluate((root) => {
      const surface = root.querySelector('.reader-surface');
      const wrapper = surface.querySelector('.docx-wrapper');
      const paper = surface.querySelector('section.docx');
      const style = (element) => element ? getComputedStyle(element) : null;
      const rect = (element) => element?.getBoundingClientRect().toJSON() ?? null;
      return {
        rootOuterHTML: root.outerHTML.slice(0, 2000),
        hasPreviewAttribute: surface.hasAttribute('data-preview-doc'),
        wrapperCount: surface.querySelectorAll('.docx-wrapper').length,
        paperCount: surface.querySelectorAll('section.docx').length,
        userTextPreserved: surface.textContent.includes('结果'),
        controls: [...root.querySelectorAll('[data-reader-action]')].map((button) => ({ action: button.dataset.readerAction, text: button.textContent.trim(), ariaPressed: button.getAttribute('aria-pressed') })),
        surface: { background: style(surface).backgroundColor, width: rect(surface)?.width, scrollWidth: surface.scrollWidth },
        wrapper: { background: style(wrapper)?.backgroundColor ?? null, width: rect(wrapper)?.width ?? null, scrollWidth: wrapper?.scrollWidth ?? null },
        paper: { background: style(paper)?.backgroundColor ?? null, color: style(paper)?.color ?? null, boxShadow: style(paper)?.boxShadow ?? null, width: rect(paper)?.width ?? null, height: rect(paper)?.height ?? null },
      };
    });
    docxLayoutAudits.push({ language, theme, ...audit });
    await writeFile(path.join(output, 'docx-layout-audits.json'), JSON.stringify(docxLayoutAudits, null, 2));
  });
  assert.ok(docxLayoutAudits.every((audit) => audit.wrapperCount === 1 && audit.paperCount >= 1 && audit.userTextPreserved && audit.paper.background === 'rgb(255, 255, 255)' && audit.paper.boxShadow !== 'none'), JSON.stringify(docxLayoutAudits));
  await page.locator('[data-reader-action="readable"]').click();
  await page.waitForFunction(() => document.querySelector('.document-reader[data-reader-format="docx"] .reader-surface')?.hasAttribute('data-preview-doc'));

  // Exercise the reader disposal race independently of the slower screenshot
  // flow: each open waits only for its reader mount, then switches immediately.
  phase = 'rapid-pdf-docx-roundtrip';
  const errorsBeforeRoundtrip = pageErrors.length;
  await openPreview(resources.pdf.id, { page: 2, highlight: 'The second page confirms page-aware extraction' });
  await page.waitForSelector('.document-reader[data-reader-format="pdf"]');
  await openPreview(resources.docx.id);
  await page.waitForSelector('.document-reader[data-reader-format="docx"]');
  await openPreview(resources.pdf.id, { page: 2 });
  await page.waitForSelector('.document-reader[data-reader-format="pdf"]');
  await openPreview(resources.docx.id);
  await page.waitForSelector('.document-reader[data-reader-format="docx"]');
  await page.waitForTimeout(300);
  assert.equal(pageErrors.length, errorsBeforeRoundtrip, 'rapid PDF/DOCX roundtrip has no pageerror');

  // Markdown math and syntax highlighting; fenced/code-span dollars remain code.
  phase = 'markdown';
  await setAppearance('zh-CN', 'light');
  await openPreview(resources.markdown.id);
  await page.waitForSelector('.document-reader[data-reader-format="markdown"] .ss-math-block .katex');
  assert.equal(await page.locator('.document-reader[data-reader-format="markdown"] h1').innerText(), 'Markdown mathematics');
  assert.ok(await page.locator('.document-reader[data-reader-format="markdown"] .ss-math-inline .katex').count() >= 1);
  assert.ok(await page.locator('.document-reader[data-reader-format="markdown"] pre code.hljs').count() >= 1);
  assert.match(await page.locator('.document-reader[data-reader-format="markdown"] pre code').innerText(), /\$not_math\$/u);
  assert.equal(await page.locator('.document-reader[data-reader-format="markdown"] pre .katex').count(), 0);
  await captureMatrix('markdown-formulas', async ({ language }) => {
    assert.equal((await page.locator('.document-reader[data-reader-format="markdown"] [data-copy-code]').innerText()).trim(), language === 'en' ? 'Copy code' : '复制代码');
  });

  // LaTeX source is a read-only CodeMirror surface; formula tab renders the
  // parser's equation blocks with KaTeX.
  phase = 'latex';
  await setAppearance('zh-CN', 'light');
  await openPreview(resources.latex.id);
  await page.waitForSelector('.document-reader[data-reader-format="latex"] .cm-editor');
  assert.match(await page.locator('.document-reader[data-reader-format="latex"] .cm-content').innerText(), /Viewer Fixture/u);
  assert.equal(await page.locator('.document-reader[data-reader-format="latex"] .cm-content').getAttribute('contenteditable'), 'false');
  assert.equal(await page.locator('.document-reader[data-reader-format="latex"] [data-reader-action]').count(), 2);
  await page.locator('[data-reader-action="formulas"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.document-reader[data-reader-format="latex"] .reader-surface .katex').length >= 2);
  assert.match(await page.locator('.document-reader[data-reader-format="latex"] .reader-surface').innerText(), /Energy/u);
  await captureMatrix('latex-formulas');
  await page.locator('[data-reader-action="source"]').click();
  await page.waitForSelector('.document-reader[data-reader-format="latex"] .cm-editor');

  // Plain text uses a read-only CodeMirror surface; CSV renders rows as a table.
  phase = 'text';
  await openPreview(resources.text.id);
  await page.waitForSelector('.document-reader[data-reader-format="text"] .cm-editor');
  assert.equal((await page.locator('.document-reader[data-reader-format="text"] .cm-content').innerText()).replaceAll('\n\n', '\n'), textFixture);
  assert.equal(await page.locator('.document-reader[data-reader-format="text"] .cm-content').getAttribute('contenteditable'), 'false');
  await captureMatrix('plain-text');
  phase = 'csv';
  await openPreview(resources.csv.id);
  await page.waitForSelector('.document-reader[data-reader-format="csv"] table');
  assert.equal(await page.locator('.document-reader[data-reader-format="csv"] tr').count(), 3);
  assert.deepEqual(await page.locator('.document-reader[data-reader-format="csv"] tr').nth(1).locator('td').allInnerTexts(), ['alpha', 'significant']);
  await captureMatrix('csv-table');

  // The persisted model answer uses the same math pipeline, while code keeps
  // raw dollar delimiters and receives no KaTeX descendants.
  phase = 'chat';
  await page.locator('.file-preview-panel [data-v="close-panel"]').click();
  await page.waitForSelector('.file-preview-panel', { state: 'detached' });
  const answer = page.locator('#message-viewer-answer .message-text');
  assert.ok(await answer.locator('.ss-math-inline .katex').count() >= 2);
  assert.ok(await answer.locator('.ss-math-block .katex').count() >= 1);
  assert.equal(await answer.locator('pre .katex, code .katex').count(), 0);
  assert.match(await answer.locator('pre code').innerText(), /\$\$not_math\$\$/u);
  assert.match(await answer.locator('p code').innerText(), /\$not_math\$/u);
  await captureMatrix('chat-formulas', async ({ language }) => {
    assert.equal((await answer.locator('[data-copy-code]').innerText()).trim(), language === 'en' ? 'Copy code' : '复制代码');
  });

  assert.equal(modelCalls.length, 1);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(failedRequests, []);
  console.log(JSON.stringify({
    productionRouter: true,
    formats: ['pdf', 'docx', 'markdown', 'latex', 'text', 'csv'],
    pdfPage2: true,
    pdfFindHighlight: true,
    pdfSelectionMark: true,
    pdfLocation: pdfMark.location,
    parseStatusAndReparse: true,
    docxReadableAndLayout: true,
    markdownMathAndHighlight: true,
    latexSourceAndFormulas: true,
    textAndCsv: true,
    chatMath: true,
    screenshotMatrices: 8,
    screenshots: 32,
    localModelRequests: modelCalls.length,
    paidRequests: 0,
  }));
} catch (error) {
  await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: false }).catch(() => {});
  console.error(JSON.stringify({
    pageErrors,
    failedRequests,
    ui: await page?.evaluate(() => ({
      route: window.route,
      chat: window.V?.chat,
      panel: window.V?.panel,
      format: document.querySelector('.document-reader')?.dataset.readerFormat,
      status: document.querySelector('.reader-status')?.innerText,
      error: document.querySelector('.reader-error')?.innerText,
      toast: document.querySelector('.toast')?.innerText,
    })).catch(() => null),
  }));
  throw error;
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
