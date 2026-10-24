// Settings in a real browser: add a preset provider with only its key, set
// the compaction threshold, add and remove another compatible service, change
// the theme, and rename an expert on the roster. Each change is checked where
// it is stored.
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

      await page.locator('.ss-sidebar__foot').getByRole('button', { name: '设置' }).click();
      const keyRefs = async () =>
        (
          await (
            await fetch(`${page.url().split('#')[0]}api/providers/keys`, {
              headers: { authorization: 'Bearer ui-token' },
            })
          ).json()
        ).refs;
      await page.locator('.settingsnav').getByRole('button', { name: '模型与服务商' }).click();

      // Quick add: only the key; the test request runs before the dialog closes.
      await page.getByRole('button', { name: '添加 OpenCode Go 订阅' }).click();
      const dialog = page.getByRole('dialog', { name: '添加 OpenCode Go 订阅' });
      await dialog.getByLabel('订阅密钥').fill('sk-test');
      await dialog.getByRole('button', { name: '测试并保存' }).click();
      await dialog.waitFor({ state: 'detached' });
      const card = page.locator('[data-provider="opencode-go"]');
      await card.getByText(/连接正常 · \d+ ms/).waitFor();
      await page.locator('[data-preset="opencode-go"]').getByText('已添加').waitFor();
      const flash = card.locator('tr[data-model="deepseek-v4.1-flash"]');
      assert.match(await flash.textContent(), /1M.*384K.*目录/);
      assert.deepEqual((await settings()).models.default, {
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
      });
      assert.deepEqual(await keyRefs(), ['opencode-go']);

      await page.locator('[data-settings="models"] input[type="range"]').evaluate((input) => {
        /** @type {HTMLInputElement} */ (input).value = '70';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.getByText('70%', { exact: true }).waitFor();
      await shot('settings-models');
      await page.waitForFunction(
        async () =>
          (
            await (
              await fetch('/api/settings', { headers: { authorization: 'Bearer ui-token' } })
            ).json()
          ).context.compactPercent === 70,
      );

      // Any other compatible service: address, protocol, key and model IDs.
      await page.getByRole('button', { name: '其他兼容服务' }).click();
      await page.getByLabel('服务名称').fill('Lab Proxy');
      await page.getByRole('button', { name: 'API 格式' }).click();
      await page.getByRole('menuitemradio', { name: 'OpenAI Chat Completions' }).click();
      await page.getByLabel('接口地址').fill('https://proxy.example.com/v1');
      await page.getByLabel('API 密钥').fill('sk-lab');
      await page.getByLabel('附加请求头').fill('x-session: s1');
      await page.getByRole('textbox', { name: '模型 ID' }).fill('deepseek-v4.1-flash');
      await shot('settings-provider-form');
      await page.getByRole('button', { name: '保存服务' }).click();
      const lab = page.locator('[data-provider="lab-proxy"]');
      await lab.getByText('proxy.example.com · 1 个模型 · 密钥已保存').waitFor();
      const saved = await settings();
      assert.deepEqual(saved.providers[1].headers['x-session'], {
        keyRef: 'provider.lab-proxy.headers.x-session',
      });
      assert.deepEqual(saved.providers[1].models, [{ id: 'deepseek-v4.1-flash' }]);
      assert.deepEqual(await keyRefs(), [
        'opencode-go',
        'SCIENCESCOPE_LAB_PROXY_KEY',
        'provider.lab-proxy.headers.x-session',
      ]);

      await lab.getByRole('button', { name: 'Lab Proxy 的更多操作' }).click();
      await page.getByRole('menuitem', { name: '移除服务商' }).click();
      await page
        .getByRole('dialog', { name: '移除 Lab Proxy？' })
        .getByRole('button', { name: '移除' })
        .click();
      await lab.waitFor({ state: 'detached' });
      assert.deepEqual(
        (await settings()).providers.map((provider) => provider.id),
        ['opencode-go'],
      );

      await page.locator('.settingsnav').getByRole('button', { name: '个人资料与常规' }).click();
      await page.locator('.settingrow', { hasText: '主题' }).locator('select').selectOption('dark');
      await page.getByRole('combobox', { name: '对话字号' }).selectOption('16');
      await page.getByRole('combobox', { name: '对话行距' }).selectOption({ label: '宽松' });
      await page.getByRole('combobox', { name: '侧栏字号' }).selectOption('13');
      await page.getByRole('button', { name: '保存并应用' }).click();
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      const look = (await settings()).appearance;
      assert.deepEqual(
        [look.theme, look.chatFontSize, look.chatLineHeight, look.sideFontSize],
        ['dark', 16, 1.75, 13],
      );
      assert.equal(
        await page
          .locator('.ss-sidebar .ss-nav-item')
          .first()
          .evaluate((node) => getComputedStyle(node).fontSize),
        '13px',
      );

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

test(
  'an OpenCode Go service configured by hand switches to the built-in preset and keeps its key and choices',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-settings-adopt', silent, async ({ page, app }) => {
      const settings = async () =>
        (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value;
      const old = { provider: 'opencode-go-old', model: 'deepseek-v4.1-flash' };
      await app.core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: {
          changes: {
            providers: [
              {
                id: 'opencode-go-old',
                name: 'OpenCode Go',
                api: 'openai-completions',
                baseUrl: 'https://opencode.ai/zen/go/v1',
                keyRef: 'SCIENCESCOPE_OPENCODE_GO_KEY',
                models: [{ id: 'deepseek-v4.1-flash' }, { id: 'retired-model' }],
              },
            ],
            models: { default: old },
          },
        },
      });
      await fetch(`${page.url().split('#')[0]}api/providers/keys/SCIENCESCOPE_OPENCODE_GO_KEY`, {
        method: 'POST',
        headers: { authorization: 'Bearer ui-token', 'content-type': 'application/json' },
        body: JSON.stringify({ key: 'sk-old' }),
      });
      await app.core.participants.updateDefinition('agent_reviewer', {
        model: { provider: 'opencode-go-old', model: 'retired-model' },
      });

      await page.goto(new URL('/?token=ui-token#/settings/models', page.url()).href);
      const card = page.locator('[data-provider="opencode-go-old"]');
      await card.getByRole('button', { name: '改用内置配置' }).click();
      await page
        .locator('[data-provider="opencode-go"]')
        .getByText(/连接正常/)
        .waitFor();
      await card.waitFor({ state: 'detached' });

      const saved = await settings();
      assert.deepEqual(
        saved.providers.map((provider) => provider.preset),
        ['opencode-go'],
      );
      assert.deepEqual(saved.models.default, { ...old, provider: 'opencode-go' });
      const reviewer = await app.core.participants.get('agent_reviewer');
      assert.equal(reviewer.definition.model ?? null, null);
      const { readCredentials } = await import('../services/providers.js');
      assert.equal((await readCredentials(app.core.paths)).refs['opencode-go'], 'sk-old');
    }),
);
