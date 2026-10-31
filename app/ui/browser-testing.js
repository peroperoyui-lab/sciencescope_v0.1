// Browser tests: the real host with a scripted AI, driven in Chromium (or
// Edge on Windows). Tests are skipped where no browser is installed.
//
// Set SCIENCESCOPE_SCREENSHOTS=<folder> to save screenshots (`shot(name)`).
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../app.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { tempDir } from '../testing.js';
import { fakeUv } from '../services/python/testing.js';

export const CHROMIUM = [
  process.env.SCIENCESCOPE_CHROMIUM,
  '/opt/pw-browsers/chromium',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => candidate && existsSync(candidate));

export const browserSkip = CHROMIUM ? false : 'no Chromium found';

/**
 * Start the host, open the interface and run `work`. Page errors fail the test.
 * @param {string} name
 * @param {import('../runtime/scripted.js').Script} script
 * @param {(context: { page: any, app: any, shot: (name: string) => Promise<void> }) => Promise<void>} work
 * @param {Partial<Parameters<typeof createApp>[0]>} [options]
 */
export async function withBrowserApp(name, script, work, options = {}) {
  const { chromium } = await import('playwright-core');
  const { dir, cleanup } = await tempDir(name);
  const app = await createApp({
    dataRoot: dir,
    token: 'ui-token',
    runtime: createScriptedRuntime({ script }),
    runtimeName: 'scripted',
    pythonOptions: { runner: fakeUv().runner },
    ...options,
  });
  const url = await app.listen();
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
  try {
    // An explicit context also permits secondary assistant pages to share
    // storage and BroadcastChannel with Main during browser acceptance.
    // SCIENCESCOPE_SCREENSHOT_SCALE=1.25 takes the screenshots at 125% display scaling.
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: Number(process.env.SCIENCESCOPE_SCREENSHOT_SCALE ?? 1),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shot = async (shotName) => {
      if (!folder) return;
      await mkdir(folder, { recursive: true });
      await page.screenshot({ path: path.join(folder, `${shotName}.png`) });
    };
    await page.goto(`${url}/?token=ui-token`);
    await page.locator('.ss-titlebar').waitFor();
    await work({ page, app, shot });
    if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`);
  } finally {
    await browser.close();
    await app.close();
    await cleanup();
  }
}

/**
 * Types at the end of a MathLive field. MathLive takes keys only once the field
 * has focus, which a busy machine can give it a little after the click.
 * @param {any} field a Playwright locator
 * @param {string} text
 */
export async function typeAtEndOfMathField(field, text) {
  await field.click();
  await field.evaluate(
    (element) =>
      new Promise((resolve) => {
        const check = () =>
          document.activeElement === element ? resolve(undefined) : requestAnimationFrame(check);
        check();
      }),
  );
  await field.press('End');
  await field.pressSequentially(text);
}

/**
 * Wait until `read` (run here, in Node) gives a true value. Playwright's
 * waitForFunction takes a promise for true at once, so checks that must await
 * something in the page wait here instead.
 * @template T
 * @param {() => Promise<T>} read
 * @param {{ timeout?: number, interval?: number }} [options]
 * @returns {Promise<T>}
 */
export async function eventually(read, { timeout = 10000, interval = 100 } = {}) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > until) throw new Error('The condition did not come true in time.');
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
