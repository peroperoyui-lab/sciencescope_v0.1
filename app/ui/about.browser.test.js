// Help → 关于 ScienceScope opens the About settings page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'the About page shows the version and credits, and the data page the data folder',
  { skip: browserSkip, timeout: 60000 },
  async () => {
    const { version } = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    await withBrowserApp(
      'about',
      async function* () {
        yield '';
      },
      async ({ page, shot }) => {
        page.setDefaultTimeout(10000);
        await page.locator('.ss-home__hello .ss-art').waitFor();
        await shot('about-welcome');
        await page.getByRole('button', { name: '帮助', exact: true }).click();
        await page.getByRole('menuitem', { name: '关于 ScienceScope' }).click();
        const about = page.locator('[data-about]');
        await about.getByText(version, { exact: true }).waitFor();
        assert.match(await about.innerText(), /peroperoyui/u);
        assert.match(await about.innerText(), /Claude（Anthropic/u);
        // A checkout has no third-party notices file, so the button stays hidden.
        assert.equal(await about.getByRole('button', { name: '第三方声明' }).count(), 0);
        await shot('about-page');
        await page.locator('.ss-settings__nav').getByText('数据与备份', { exact: true }).click();
        await page
          .locator('[data-settings="data"]')
          .getByRole('button', { name: /打开/u })
          .first()
          .waitFor();
      },
    );
  },
);
