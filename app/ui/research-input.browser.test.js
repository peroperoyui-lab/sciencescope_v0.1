import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'drop material, persist draft, keep failed send, select references and inspect the sent receipt in both languages',
  { skip: browserSkip },
  async () => {
    await withBrowserApp(
      'research-input',
      async function* ({ input }) {
        assert.match(input, /\[User-provided research material\]/u);
        yield 'Material received.';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
        });
        const project = await app.core.projects.create({ name: '研究输入验证' });
        const meeting = app.core.meetings.create({
          projectId: project.id,
          title: '附件验收',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        await page.evaluate((id) => {
          location.hash = '#/meeting/' + id;
        }, meeting.id);
        const composer = page.locator('[data-composer="main"]');
        await composer.waitFor();
        await composer.evaluate((element) => {
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(
            new File(['Evidence from the uploaded document.'], '中文材料.txt', {
              type: 'text/plain',
            }),
          );
          element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
        });
        await composer.getByRole('button', { name: '中文材料.txt', exact: true }).waitFor();
        assert.equal(app.research.store.listSources({ projectId: project.id }).length, 1);
        await page.reload();
        await composer.getByRole('button', { name: '中文材料.txt', exact: true }).waitFor();
        await page.route('**/api/meetings/*/messages', async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ code: 'TEST', message: 'Send unavailable' }),
          });
        });
        await page.getByLabel('主输入框').fill('Use this document');
        await composer.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText('Send unavailable', { exact: true }).waitFor();
        assert.equal(
          await composer.getByRole('button', { name: '中文材料.txt', exact: true }).count(),
          1,
        );
        await page.unroute('**/api/meetings/*/messages');
        await composer.getByRole('button', { name: '添加材料', exact: true }).click();
        await page.getByRole('menuitem', { name: '引用', exact: true }).click();
        await page.locator('.materials-panel input[type="checkbox"]').waitFor();
        await shot('attachments-materials-zh');
        await page.getByLabel('关闭侧栏').click();
        await composer.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText('Material received.', { exact: true }).waitFor();
        // The sent message names its file; clicking it shows this message's context.
        const receipt = page
          .locator('.ss-msg--user [data-input-receipt]')
          .getByRole('button', { name: '中文材料.txt', exact: true });
        await receipt.waitFor();
        await receipt.click();
        await page.locator('#modal').getByText('本次上下文', { exact: true }).waitFor();
        await shot('attachments-receipt-zh');
        await page.locator('#modal').getByRole('button', { name: '关闭', exact: true }).click();
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await composer.getByLabel('Add material').waitFor();
        await receipt.click();
        await page.getByText('Context for this message', { exact: true }).waitFor();
        await shot('attachments-receipt-en');
      },
    );
  },
);
