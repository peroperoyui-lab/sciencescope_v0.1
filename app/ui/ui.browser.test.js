// The meeting path in a real browser against the real host with a scripted
// AI: a person creates a project, starts a meeting, asks a question, watches
// the answer stream in with its tool card, searches, then finds the AI's plan
// on the workbench and undoes it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import('../runtime/scripted.js').Script} */
async function* script({ instructions, call }) {
  const projectId = /（id：(prj_[a-z0-9]+)）/.exec(instructions)?.[1];
  yield '我先把这项工作';
  await pause(150);
  yield '记到计划里。';
  await call('workspace_edit', {
    resource: 'plans',
    key: projectId,
    op: 'append',
    args: { text: '- [ ] 清洗面板数据\n' },
  });
  yield '已记下：**清洗面板数据**。';
}

test(
  'a person meets the main expert in the interface and previews its plan version',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-meeting', script, async ({ page, app, shot }) => {
      await app.core.workspace.edit(
        {
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              providers: [
                {
                  id: 'scripted',
                  name: 'Scripted',
                  api: 'openai-completions',
                  baseUrl: 'http://127.0.0.1:9/v1',
                  keyRef: 'SCIENCESCOPE_SCRIPTED_KEY',
                  models: [{ id: 'scripted', contextWindow: 100000 }],
                },
              ],
              models: { default: { provider: 'scripted', model: 'scripted' } },
            },
          },
        },
        {},
      );
      await page.getByText('今天想研究什么？').waitFor();
      await shot('home');

      await page.locator('.ss-sidebar').getByRole('button', { name: '新建项目' }).click();
      await page.getByLabel('项目名称').fill('城市就业韧性');
      await page.getByRole('button', { name: '创建项目' }).click();
      await page.getByText('本项目日志').waitFor();

      await page
        .locator('.workbench-page > .ss-header')
        .getByRole('button', { name: '更多' })
        .click();
      await page.getByRole('menuitem', { name: '在项目中新对话' }).click();
      await page.getByPlaceholder('输入问题或下一步工作…').fill('请把下一步记到计划里');
      await page.getByRole('button', { name: '发送' }).click();

      const answer = page.locator('.ss-msg:not([data-user])').last();
      await answer.getByText('已记下：').waitFor();
      // A finished answer folds its activity timeline into one line; opening
      // it shows the model's pre-call words and the call in plain words.
      const activity = answer.locator('[data-turn-activity]');
      assert.match(await activity.locator('.ss-act__summary').textContent(), /1 个步骤/);
      assert.equal(await activity.locator('.ss-act__list').count(), 0);
      await activity.locator('.ss-act__summary').click();
      assert.match(
        await activity.locator('.ss-act__narr').textContent(),
        /我先把这项工作记到计划里。/,
      );
      const row = activity.locator('[data-tool-call]');
      assert.equal(await row.locator('.ss-act__verb').textContent(), '修改');
      assert.equal(await row.locator('.ss-act__target').textContent(), '计划');
      await row.click();
      assert.match(await activity.locator('.ss-act__detail').textContent(), /workspace_edit/);
      assert.equal(await answer.locator('.message-text strong').textContent(), '清洗面板数据');
      assert.equal(await page.locator('.ss-tree-row--child[aria-selected="true"]').count(), 1);
      await shot('meeting');

      await page.locator('[data-usage="main"][data-context-known="true"]').waitFor();
      await page.locator('.ss-header').getByRole('button', { name: '查找当前对话' }).click();
      await page.getByPlaceholder('查找当前对话').fill('清洗');
      await page.locator('.ss-msg[data-target]', { hasText: '清洗面板数据' }).waitFor();
      await page.keyboard.press('Escape');
      await answer.getByRole('button', { name: '消息菜单' }).click();
      await page.getByRole('menuitem', { name: '引用到输入框' }).click();
      await page.waitForFunction(() =>
        /** @type {HTMLTextAreaElement} */ (
          document.querySelector('.ss-composer textarea')
        )?.value.startsWith('> 已记下'),
      );
      await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
      await page.getByRole('menuitem', { name: '项目置顶摘要' }).click();
      await page.locator('.project-flyout .flyfile', { hasText: '计划' }).first().waitFor();
      await page.getByRole('button', { name: '关闭项目摘要' }).click();

      await page.keyboard.press('Control+K');
      await page.getByPlaceholder('搜索项目、对话或消息…').fill('面板');
      await page
        .locator('#command-palette .ss-cmd__item', { hasText: '清洗面板数据' })
        .first()
        .waitFor();
      await page.keyboard.press('Escape');

      await page
        .locator('.ss-sidebar')
        .getByRole('button', { name: '工作站', exact: true })
        .click();
      await page.locator('.ss-note-card', { hasText: '清洗面板数据' }).waitFor();
      await shot('workbench');
      await page
        .locator('.workbench-page > .ss-header')
        .getByRole('button', { name: '更多' })
        .click();
      await page.getByRole('menuitem', { name: '计划的历史版本' }).click();
      await page
        .getByRole('dialog', { name: '历史版本', exact: true })
        .getByRole('button', { name: '查看', exact: true })
        .first()
        .click();
      await page
        .locator('[data-snapshot-preview]')
        .getByText('清洗面板数据', { exact: true })
        .waitFor();
      assert.equal(await page.locator('[data-snapshot-preview] textarea').count(), 0);
      await page
        .getByRole('dialog', { name: '历史版本', exact: true })
        .getByRole('button', { name: '关闭', exact: true })
        .click();

      await page.getByRole('button', { name: '视图', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'English' }).click();
      await page.getByText('No log entries yet.', { exact: false }).waitFor();
      await shot('workbench-en');
    }),
);
