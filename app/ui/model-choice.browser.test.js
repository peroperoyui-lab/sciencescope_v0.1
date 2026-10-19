// The composer's model picker chooses the model of the current chat; the
// default model in settings only changes in Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'choosing a model in the composer changes only the current chat',
  { skip: browserSkip, timeout: 60000 },
  async () => {
    const used = [];
    await withBrowserApp(
      'model-choice',
      async function* ({ model }) {
        used.push(model?.model);
        yield 'Answered.';
      },
      async ({ page, app }) => {
        page.setDefaultTimeout(10000);
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              providers: [
                {
                  id: 'scripted',
                  name: 'Scripted',
                  models: [{ id: 'default-model' }, { id: 'chat-model' }],
                },
              ],
              models: { default: { provider: 'scripted', model: 'default-model' } },
            },
          },
        });
        await page.reload();
        const picker = page.getByRole('button', { name: '本对话的模型和思考强度', exact: true });
        await picker.click();
        await page
          .getByRole('dialog', { name: '本对话的模型和思考强度', exact: true })
          .getByRole('option', { name: /chat-model/u })
          .click();
        await page.getByLabel('主输入框').fill('First question');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText('Answered.', { exact: true }).waitFor();
        const [meeting] = app.core.meetings.list();
        assert.equal(meeting.policy.model?.model, 'chat-model');
        assert.deepEqual(used, ['chat-model']);
        const settings = (await app.core.workspace.read({ resource: 'settings', key: 'app' }))
          .value;
        assert.equal(settings.models.default.model, 'default-model');

        // Back to following the default inside the meeting.
        await picker.click();
        await page
          .getByRole('dialog', { name: '本对话的模型和思考强度', exact: true })
          .getByRole('option', { name: /跟随默认模型/u })
          .click();
        await page.waitForFunction(
          () =>
            !document.querySelector('[data-v="model-menu"]')?.textContent?.includes('chat-model'),
        );
        assert.equal(app.core.meetings.get(meeting.id).policy.model ?? null, null);
      },
    );
  },
);
