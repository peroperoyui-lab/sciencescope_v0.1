import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'paste image sends image content; native screenshot uses the stored hiding preference',
  { skip: browserSkip },
  async () => {
    const received = [];
    await withBrowserApp(
      'images',
      async function* ({ images }) {
        received.push(images);
        yield 'Image received.';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'test', model: 'vision' } } } },
        });
        const meeting = app.core.meetings.create({
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        await page.evaluate((id) => {
          location.hash = '#/meeting/' + id;
        }, meeting.id);
        const composer = page.locator('[data-composer="main"]');
        await composer.waitFor();
        const base64 =
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
        await composer.evaluate((element, data) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([Uint8Array.from(atob(data), (value) => value.charCodeAt(0))], '图表.png', {
              type: 'image/png',
            }),
          );
          element.dispatchEvent(
            new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }),
          );
        }, base64);
        await composer.getByRole('button', { name: '图表.png', exact: true }).waitFor();
        await page.getByLabel('主输入框').fill('Explain the picture');
        await composer.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText('Image received.', { exact: true }).waitFor();
        assert.equal(received[0][0].data, base64);
        // The sent message shows the image as a thumbnail that opens full size.
        const thumb = page
          .locator('.ss-msg--user')
          .getByRole('button', { name: '查看图片 图表.png', exact: true });
        await thumb
          .locator('img')
          .evaluate((img) =>
            img.complete ? null : new Promise((resolve) => (img.onload = resolve)),
          );
        assert.ok(await thumb.locator('img').evaluate((img) => img.naturalWidth > 0));
        await thumb.click();
        await page.getByRole('dialog', { name: '图表.png' }).locator('img').waitFor();
        await page.keyboard.press('Escape');
        assert.equal(app.research.store.listSources({}).length, 0);
        for (const hideWindow of [true, false]) {
          await app.core.workspace.edit({
            resource: 'settings',
            key: 'app',
            op: 'patch',
            args: { changes: { composer: { hideWindowOnScreenshot: hideWindow } } },
          });
          // Reload observes the saved preference, independent of event-delivery timing.
          await page.reload();
          await composer.waitFor();
          await page.evaluate((data) => {
            globalThis.__TAURI__ = {
              core: {
                invoke: async (command, options) => {
                  globalThis.__screenshotCall = { command, options };
                  return data;
                },
              },
            };
          }, base64);
          await composer.getByRole('button', { name: '添加材料' }).click();
          await page.getByRole('menuitem', { name: '截图', exact: true }).click();
          await page.waitForFunction(() => Boolean(globalThis.__screenshotCall));
          assert.deepEqual(await page.evaluate(() => globalThis.__screenshotCall), {
            command: 'capture_screenshot',
            options: { hideWindow },
          });
          await composer
            .getByRole('button', { name: /^Screenshot-/ })
            .first()
            .waitFor();
        }
        await shot('image-input');
      },
    );
  },
);
