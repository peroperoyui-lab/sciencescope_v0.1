// R4-4b uses the real host and scripted runtime, including a real tool proposal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'the secretary catches up separately, streams a draft proposal, and fills Main without sending',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let releaseAnswer = () => {};
    const gate = new Promise((resolve) => {
      releaseAnswer = () => resolve(undefined);
    });
    const inputs = [];
    try {
      await withBrowserApp(
        'r4-4b-secretary',
        async function* ({ instructions, input, call, signal }) {
          inputs.push({ instructions, input });
          if (input.includes('Please stop this secretary answer')) {
            yield 'Secretary is working.';
            await new Promise((resolve) =>
              signal.addEventListener('abort', resolve, { once: true }),
            );
            return;
          }
          yield '## Secretary response\n\nI have followed the Main conversation.';
          await call('propose_main_draft', {
            text: 'Compare the identification strategies and cite the evidence.',
          });
          yield '# Secretary response\n\nI have followed the Main conversation.';
          await gate;
          yield '\n\nThe proposed instruction is ready.';
        },
        async ({ page, app, shot }) => {
          page.setDefaultTimeout(10000);
          try {
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
                        { id: 'deepseek-v4-pro', name: 'secretary-model' },
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
                    workbench: { map: 'off', plans: 'off', log: 'off' },
                  },
                },
              },
            });
            const main = app.core.meetings.create({
              title: 'Secretary meeting',
              members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
            });
            app.core.messages.post({
              meetingId: main.id,
              authorId: 'agent_main',
              text: 'The Main conversation has selected a natural experiment.',
            });
            await page.goto(new URL('/?token=ui-token#/meeting/' + main.id, page.url()).href);
            const mainInput = page.locator('[data-composer="main"] textarea');
            await mainInput.fill('Keep this Main draft.');
            await page.getByRole('button', { name: '会议秘书', exact: true }).click();
            const panel = page.locator('.side-panel', {
              has: page.locator('[data-scope="secretary"]'),
            });
            const input = panel.getByLabel('任务秘书输入');
            await input.waitFor();
            await input.fill('Temporary secretary draft.');
            await panel.getByRole('button', { name: '关闭秘书', exact: true }).click();
            await page.getByRole('button', { name: '会议秘书', exact: true }).click();
            assert.equal(await input.inputValue(), 'Temporary secretary draft.');
            assert.equal(await mainInput.inputValue(), 'Keep this Main draft.');
            await panel.getByRole('button', { name: '秘书模型', exact: true }).click();
            const picker = page.getByRole('dialog', { name: '秘书模型', exact: true });
            await picker.getByRole('option', { name: /secretary-model/u }).click();
            await picker.getByRole('button', { name: '高', exact: true }).click();
            const attached = app.core.meetings.list({ attachedTo: main.id })[0];
            await page.waitForFunction(() =>
              document
                .querySelector('[data-composer="secretary"] .ss-composer__bar')
                ?.textContent.includes('secretary-model · 高'),
            );
            assert.deepEqual(app.core.meetings.get(attached.id).policy.model, {
              provider: 'scripted',
              model: 'deepseek-v4-pro',
              effort: 'high',
            });
            assert.equal(
              (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value.models
                .default.model,
              'main-model',
            );
            await input.fill('Please propose the next Main instruction.');
            await input.dispatchEvent('keydown', {
              key: 'Escape',
              isComposing: true,
              bubbles: true,
            });
            assert.equal(await panel.count(), 1);
            const before = app.core.messages.since(attached.id, 0).length;
            await input.dispatchEvent('keydown', {
              key: 'Enter',
              isComposing: true,
              bubbles: true,
            });
            await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true });
            assert.equal(app.core.messages.since(attached.id, 0).length, before);
            await panel.getByRole('button', { name: '发送给任务秘书', exact: true }).click();
            // The words before the tool call render as Markdown too; wait for the answer body.
            await panel
              .locator('.ss-msg__body')
              .getByRole('heading', { name: 'Secretary response', exact: true })
              .waitFor();
            const proposal = panel.locator('.ss-proposal').first();
            await proposal.getByLabel('编辑秘书提案').waitFor();
            await proposal
              .getByLabel('编辑秘书提案')
              .fill('Edited instruction: compare the natural experiment with matching.');
            assert.equal(await mainInput.inputValue(), 'Keep this Main draft.');
            await shot('r4-4b-secretary-streaming-zh');
            releaseAnswer();
            await panel.getByText('The proposed instruction is ready.', { exact: false }).waitFor();
            await panel.locator('[data-follow-up]', { hasText: '第 1 条' }).waitFor();
            assert.match(inputs[0].input, /selected a natural experiment/u);
            await proposal.getByRole('button', { name: '填入主对话草稿', exact: true }).click();
            await page.waitForFunction(
              () =>
                /** @type {HTMLTextAreaElement} */ (
                  document.querySelector('[data-composer="main"] textarea')
                ).value === 'Edited instruction: compare the natural experiment with matching.',
            );
            assert.equal(app.core.messages.since(main.id, 0).length, 1);
            assert.equal(
              await mainInput.inputValue(),
              'Edited instruction: compare the natural experiment with matching.',
            );
            await shot('r4-4b-secretary-filled-zh');
            await page.reload();
            await page.getByRole('button', { name: '会议秘书', exact: true }).click();
            await proposal.getByText('已填入草稿', { exact: true }).waitFor();
            await proposal.getByRole('button', { name: /秘书提案/u }).click();
            assert.match(await panel.innerText(), /Edited instruction/u);
            await proposal.getByRole('button', { name: '最近修改记录', exact: true }).click();
            await proposal.getByRole('button', { name: '撤销', exact: true }).first().click();
            await proposal.getByLabel('编辑秘书提案').waitFor();
            assert.equal(
              await proposal.getByLabel('编辑秘书提案').inputValue(),
              'Compare the identification strategies and cite the evidence.',
            );
            await proposal.getByRole('button', { name: '忽略', exact: true }).click();
            await proposal.getByText('已忽略', { exact: true }).waitFor();
            await input.fill('Please stop this secretary answer');
            await panel.getByRole('button', { name: '发送给任务秘书', exact: true }).click();
            await panel.getByText('Secretary is working.', { exact: true }).waitFor();
            await panel.getByRole('button', { name: '停止秘书回复', exact: true }).click();
            await panel
              .getByText('你停止了这次回答，已保留到目前的内容。', { exact: true })
              .waitFor();
            await panel.getByRole('button', { name: '发送给任务秘书', exact: true }).waitFor();
            await proposal.getByRole('button', { name: /秘书提案/u }).click();
            await page.getByRole('button', { name: '视图', exact: true }).click();
            await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
            await panel.getByRole('button', { name: 'Close secretary', exact: true }).waitFor();
            assert.doesNotMatch(await panel.innerText(), /[一-鿿]/u);
            await shot('r4-4b-secretary-en');
          } finally {
            releaseAnswer();
          }
        },
      );
    } finally {
      releaseAnswer();
    }
  },
);

test(
  'a quick ask goes to the secretary as it is and keeps what the person was typing',
  { skip: browserSkip, timeout: 60000 },
  () =>
    withBrowserApp(
      'secretary-quick-ask',
      async function* () {
        yield '可以再追问样本的时间口径。';
      },
      async ({ page, app }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
        });
        const main = app.core.meetings.create({
          title: '样本口径',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        app.core.messages.post({
          meetingId: main.id,
          authorId: 'agent_main',
          text: '先看 2015 年。',
        });
        await page.goto(new URL('/?token=ui-token#/meeting/' + main.id, page.url()).href);
        await page.getByRole('button', { name: '会议秘书', exact: true }).click();
        const panel = page.locator('.side-panel', {
          has: page.locator('[data-scope="secretary"]'),
        });
        const input = panel.getByLabel('任务秘书输入');
        await input.fill('还没写完的话');
        await panel.locator('[data-quick-ask]', { hasText: '还有什么值得继续追问？' }).click();
        await panel.getByText('可以再追问样本的时间口径。').waitFor();
        const attached = app.core.meetings.list({ attachedTo: main.id })[0];
        assert.ok(
          app.core.messages
            .since(attached.id, 0)
            .some((message) => message.text === '还有什么值得继续追问？'),
        );
        assert.equal(await input.inputValue(), '还没写完的话');
      },
    ),
);
