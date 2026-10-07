import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'native edges resize, fullscreen/maximize disable handles, browser chrome stays hidden',
  { skip: browserSkip },
  () =>
    withBrowserApp(
      'native-window',
      async function* () {},
      async ({ page }) => {
        assert.equal(await page.locator('.native-resize-frame').count(), 0);
        await page.evaluate(async () => {
          const { installWindowResize } = await import(String('/native-window.js'));
          const state = {
            calls: [],
            maximized: false,
            fullscreen: false,
            changed: null,
            stopped: false,
          };
          /** @type {any} */ (window).nativeTest = state;
          const win = {
            startResizeDragging: async (direction) => {
              state.calls.push(direction);
            },
            isMaximized: async () => state.maximized,
            isFullscreen: async () => state.fullscreen,
            setFullscreen: async (active) => {
              state.fullscreen = active;
              state.changed();
            },
            onResized: async (changed) => {
              state.changed = changed;
              return () => {
                state.stopped = true;
              };
            },
          };
          /** @type {any} */ (window).stopNativeTest = installWindowResize({
            getCurrentWindow: () => win,
          });
        });
        for (const direction of [
          'North',
          'NorthEast',
          'East',
          'SouthEast',
          'South',
          'SouthWest',
          'West',
          'NorthWest',
        ]) {
          await page
            .locator(`[data-resize-direction="${direction}"]`)
            .dispatchEvent('mousedown', { button: 0 });
        }
        assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).nativeTest.calls), [
          'North',
          'NorthEast',
          'East',
          'SouthEast',
          'South',
          'SouthWest',
          'West',
          'NorthWest',
        ]);
        await page.keyboard.press('F11');
        await page.locator('.native-resize-frame').waitFor({ state: 'hidden' });
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).nativeTest.fullscreen),
          true,
        );
        await page.keyboard.press('F11');
        await page.locator('.native-resize-frame').waitFor({ state: 'visible' });
        await page.evaluate(() => {
          /** @type {any} */ (window).nativeTest.maximized = true;
          /** @type {any} */ (window).nativeTest.changed();
        });
        await page.locator('.native-resize-frame').waitFor({ state: 'hidden' });
        await page.evaluate(() => /** @type {any} */ (window).stopNativeTest());
        assert.equal(await page.locator('.native-resize-frame').count(), 0);
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (window).nativeTest.stopped),
          true,
        );
      },
    ),
);
