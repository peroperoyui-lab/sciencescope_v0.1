// The global assistant panel uses the same timeline as a meeting: approval
// cards, the execution mode and a width that is remembered.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp, eventually } from './browser-testing.js';

test(
  'a command in the assistant panel waits for approval, 常规 stops asking and the width is kept',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    const results = [];
    await withBrowserApp(
      'panel-approval',
      async function* ({ call }) {
        results.push(await call('shell', { command: 'echo from-panel' }));
        yield '命令已运行';
      },
      async ({ page, app, shot }) => {
        page.setDefaultTimeout(10000);
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        await page.goto(new URL('/?token=ui-token#/', page.url()).href);
        await page
          .locator('.ss-sidebar__foot')
          .getByRole('button', { name: '全局助手', exact: true })
          .click();
        const panel = page.locator('.global-assistant-panel');
        const input = panel.getByLabel('全局助手输入');
        await input.waitFor();
        const mode = panel.getByRole('button', { name: '执行方式', exact: true });
        assert.match(await mode.textContent(), /请求批准/);
        await input.fill('看一下环境');
        await panel.getByRole('button', { name: '发送给全局助手', exact: true }).click();

        const card = panel.getByRole('group', { name: '需要你的批准' });
        await card.getByText('echo from-panel').waitFor();
        await panel.locator('.ss-status--wait', { hasText: '等待你的批准' }).waitFor();
        await shot('panel-approval');
        await card.getByRole('button', { name: '允许', exact: true }).click();
        await panel.getByText('命令已运行').waitFor();
        assert.match(results[0].output, /from-panel/);

        await mode.click();
        // Only 请求批准 and 常规 are offered.
        assert.equal(await page.getByRole('menuitemradio', { name: '自动化' }).count(), 0);
        await page.getByRole('menuitemradio', { name: '常规', exact: true }).click();
        const assistant = app.core.meetings
          .list()
          .find((meeting) => meeting.policy.respondent === 'agent_assistant');
        await eventually(() =>
          page.evaluate(async (id) => {
            const response = await fetch(`/api/meetings/${id}`, {
              headers: { authorization: 'Bearer ui-token' },
            });
            return (await response.json()).policy.approval === 'auto';
          }, assistant.id),
        );

        // Dragging the edge resizes the panel; the width is a setting.
        const splitter = panel.getByRole('separator', { name: '调整宽度' });
        const box = await splitter.boundingBox();
        await page.mouse.move(box.x + 4, box.y + 200);
        await page.mouse.down();
        await page.mouse.move(box.x - 96, box.y + 200, { steps: 4 });
        await page.mouse.up();
        await eventually(() =>
          page.evaluate(async () => {
            const response = await fetch('/api/settings', {
              headers: { authorization: 'Bearer ui-token' },
            });
            return (await response.json()).appearance.panels.assistant === 460;
          }),
        );
        await page.reload();
        await page
          .locator('.ss-sidebar__foot')
          .getByRole('button', { name: '全局助手', exact: true })
          .click();
        await input.waitFor();
        assert.equal(Math.round((await panel.boundingBox()).width), 460);
      },
    );
  },
);
