// Settings in a real browser: add a model service and make it the default,
// change the theme, and rename an expert on the roster. Each change is
// checked where it is stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test(
  'a person configures a model service, the theme and the expert roster',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-settings', silent, async ({ page, app, shot }) => {
      const settings = async () =>
        (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value;

      await page.locator('.userbar').getByRole('button', { name: '设置' }).click();
      await page.locator('.settingsnav').getByRole('button', { name: '模型与 API' }).click();
      await page.getByRole('button', { name: '添加第一个服务' }).click();
      await page.getByLabel('服务名称').fill('OpenCode Go');
      await page.getByLabel('API 格式').selectOption('openai-completions');
      await page.getByLabel('接口地址 · Base URL').fill('https://opencode.ai/zen/go/v1');
      await page.locator('#api-key-preview').fill('sk-test');
      await page.locator('#api-headers').fill('x-opencode-session: s1');
      await page.locator('#api-models').fill('deepseek-v4.1-flash');
      await page.getByLabel('deepseek-v4.1-flash 上下文窗口').fill('128000');
      await page.getByRole('button', { name: '保存服务' }).click();
      await page.locator('.api-provider', { hasText: 'OpenCode Go' }).waitFor();
      await shot('settings-models');

      const saved = await settings();
      assert.equal(saved.providers[0].headers['x-opencode-session'], 's1');
      assert.equal(saved.providers[0].models[0].contextWindow, 128000);
      assert.deepEqual(saved.models.default, {
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
      });
      const keys = await (
        await fetch(`${page.url().split('#')[0]}api/providers/keys`, {
          headers: { authorization: 'Bearer ui-token' },
        })
      ).json();
      assert.deepEqual(keys.refs, ['SCIENCESCOPE_OPENCODE_GO_KEY']);

      await page.locator('.settingsnav').getByRole('button', { name: '个人资料与常规' }).click();
      await page.locator('.settingrow', { hasText: '主题' }).locator('select').selectOption('dark');
      await page.getByRole('button', { name: '保存并应用' }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      assert.equal((await settings()).appearance.theme, 'dark');

      await page.locator('.settingsnav').getByRole('button', { name: '专家角色' }).click();
      const first = page.locator('.expert-card').first();
      await first.locator('input').first().fill('研究设计专家');
      await page.getByRole('button', { name: '保存名册' }).click();
      await page.getByText('名册已保存。').waitFor();
      await shot('settings-experts');
      const expert = await app.core.participants.get('agent_methodologist');
      assert.equal(expert.name, '研究设计专家');
      assert.equal(expert.definition.panel, 'expert');
    }),
);
