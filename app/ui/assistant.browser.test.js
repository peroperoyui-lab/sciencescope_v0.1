// R4-5b exercises the real host and Edge with an assistant turn held open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'the global assistant stays beside Main, navigates project links, retains drafts, and queues input',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let release = () => {};
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let requests = 0;
    let projectId;
    let mainId;
    try {
      await withBrowserApp(
        'r4-5b-assistant',
        async function* () {
          requests++;
          if (requests === 1) {
            yield `## Assistant answer\n\n[Open project](#/workbench/${projectId}) · [Open meeting](#/meeting/${mainId})`;
            await held;
          } else yield 'The queued question was answered.';
        },
        async ({ page, app, shot }) => {
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
                    models: [
                      { id: 'main-model' },
                      // A catalog model that supports the "high" thinking level.
                      { id: 'deepseek-v4-pro', name: 'assistant-model' },
                    ],
                  },
                ],
                models: { default: { provider: 'scripted', model: 'main-model' } },
                summary: {
                  afterDiscussion: false,
                  everyMessages: { enabled: false, n: 20 },
                  everyTokens: { enabled: false, n: 30000 },
                  onEnterProject: false,
                  onLeaveProject: false,
                },
              },
            },
          });
          await app.core.participants.updateDefinition('agent_assistant', {
            model: { provider: 'scripted', model: 'deepseek-v4-pro' },
          });
          const project = await app.core.projects.create({ name: 'Assistant project' });
          projectId = project.id;
          const main = app.core.meetings.create({
            projectId,
            title: 'Main research',
            members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          });
          mainId = main.id;
          await page.goto(new URL('/?token=ui-token#/meeting/' + main.id, page.url()).href);
          const mainInput = page.getByLabel('主输入框');
          await mainInput.fill('Main draft stays here.');
          await page
            .locator('.ss-sidebar__foot')
            .getByRole('button', { name: '全局助手', exact: true })
            .click();
          const panel = page.locator('.global-assistant-panel');
          const input = panel.getByLabel('全局助手输入');
          await input.waitFor();
          await panel.getByRole('button', { name: '助手模型', exact: true }).waitFor();
          assert.match(await panel.innerText(), /assistant-model/u);
          await panel.getByRole('button', { name: '助手模型', exact: true }).click();
          await page
            .getByRole('dialog', { name: '助手模型', exact: true })
            .getByRole('button', { name: '高', exact: true })
            .click();
          await panel.getByRole('button', { name: '助手模型', exact: true }).click();
          await input.fill('Which projects have pending tasks?');
          await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true });
          assert.equal(requests, 0);
          await panel.getByRole('button', { name: '发送给全局助手', exact: true }).click();
          await panel.getByRole('heading', { name: 'Assistant answer', exact: true }).waitFor();
          assert.equal(await mainInput.inputValue(), 'Main draft stays here.');
          const assistant = app.core.meetings
            .list()
            .find((meeting) => meeting.policy.respondent === 'agent_assistant');
          assert.ok(assistant);
          assert.equal(
            await page.locator('.navscroll').getByText(assistant.title, { exact: true }).count(),
            0,
          );
          await input.fill('Draft survives hiding.');
          await panel.getByRole('button', { name: '关闭助手', exact: true }).click();
          await page
            .locator('.ss-sidebar__foot')
            .getByRole('button', { name: '全局助手', exact: true })
            .click();
          assert.equal(await input.inputValue(), 'Draft survives hiding.');
          // Still answering: with text in the box the button queues instead of stopping.
          await panel.locator('.ss-msg[data-streaming]').waitFor();
          assert.equal(
            await panel.getByRole('button', { name: '发送给全局助手', exact: true }).isEnabled(),
            true,
          );
          assert.equal(requests, 1);
          await panel.getByRole('link', { name: 'Open project', exact: true }).click();
          await page.waitForURL('**/#/workbench/' + projectId);
          assert.equal(await panel.count(), 1);
          await panel.getByRole('link', { name: 'Open meeting', exact: true }).click();
          await page.waitForURL('**/#/meeting/' + mainId);
          await page.evaluate((id) => {
            location.hash = '#/map/' + id;
          }, projectId);
          await page.locator('.editorcanvas').waitFor();
          assert.equal(await panel.count(), 1);
          assert.equal(await input.inputValue(), 'Draft survives hiding.');
          await panel.getByRole('link', { name: 'Open meeting', exact: true }).click();
          await page.waitForURL('**/#/meeting/' + mainId);
          await input.fill('Queued question');
          await panel.getByRole('button', { name: '发送给全局助手', exact: true }).click();
          await panel.locator('.outbox__item', { hasText: 'Queued question' }).waitFor();
          assert.equal(
            app.core.messages
              .since(assistant.id, 0)
              .filter((message) => message.authorId === 'person_user').length,
            1,
          );
          await shot('r4-5b-assistant-queue-zh');
          await panel.getByRole('button', { name: '停止助手回复', exact: true }).click();
          release();
          await panel.getByText('The queued question was answered.', { exact: true }).waitFor();
          assert.equal(app.core.outbox.list(assistant.id).items.length, 0);
          assert.equal(requests, 2);
          assert.equal(app.core.meetings.get(mainId).policy.model, undefined);
          await page.getByRole('button', { name: '视图', exact: true }).click();
          await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
          await panel.getByRole('button', { name: 'Close assistant', exact: true }).waitFor();
          assert.doesNotMatch(await panel.innerText(), /[一-鿿]/u);
          await shot('r4-5b-assistant-en');
        },
      );
    } finally {
      release();
    }
  },
);
