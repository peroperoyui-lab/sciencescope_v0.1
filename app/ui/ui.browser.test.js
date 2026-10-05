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
  'a person meets the main expert in the interface and undoes its plan edit',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-meeting', script, async ({ page, app, shot }) => {
      await app.core.workspace.edit(
        {
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        },
        {},
      );
      await page.getByText('今天想研究什么？').waitFor();
      await shot('home');

      await page.locator('.navsection').getByRole('button', { name: '新建项目' }).click();
      await page.locator('#modal input').fill('城市就业韧性');
      await page.locator('#modal').getByRole('button', { name: '创建' }).click();
      await page.getByText('本项目日志').waitFor();

      await page.locator('.mainhead').getByRole('button', { name: '新建项目内聊天' }).click();
      await page.getByPlaceholder('输入问题或下一步工作…').fill('请把下一步记到计划里');
      await page.getByRole('button', { name: '发送' }).click();

      const answer = page.locator('.message:not(.user)').last();
      await answer.getByText('已记下：').waitFor();
      assert.equal(await answer.locator('.tool small').textContent(), 'workspace_edit');
      assert.match(
        await answer.locator('.tool summary').textContent(),
        /我先把这项工作记到计划里。/,
      );
      assert.equal(await answer.locator('.message-text strong').textContent(), '清洗面板数据');
      assert.equal(await page.locator('.tree-row.child.active').count(), 1);
      await shot('meeting');

      await page.keyboard.press('Control+K');
      await page.getByPlaceholder('搜索项目、对话或消息…').fill('面板');
      await page.locator('.command-results button', { hasText: '清洗面板数据' }).first().waitFor();
      await page.keyboard.press('Escape');

      await page.locator('.sidebar').getByRole('button', { name: '工作站' }).click();
      await page.locator('.plancard', { hasText: '清洗面板数据' }).waitFor();
      await shot('workbench');
      await page.locator('.wb-left').getByRole('button', { name: '撤销' }).first().click();
      await page.locator('.wb-left').getByText('已撤销').waitFor();
      assert.equal(await page.locator('.plancard', { hasText: '清洗面板数据' }).count(), 0);

      await page.getByRole('button', { name: '视图' }).click();
      await page.getByRole('menuitemcheckbox', { name: 'English' }).click();
      await page.getByText('No project log entries yet').waitFor();
      await shot('workbench-en');
    }),
);
