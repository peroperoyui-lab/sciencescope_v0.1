import test from 'node:test';
import assert from 'node:assert/strict';
import { withBrowserApp, browserSkip } from './browser-testing.js';
import { fakeUv } from '../services/python/testing.js';

test(
  'Python settings reports an unavailable host without unhandled initialization failures',
  { skip: browserSkip },
  async () => {
    await withBrowserApp(
      'python-ui-unavailable',
      async function* () {},
      async ({ page }) => {
        await page.route('**/api/python', (route) => route.abort('failed'));
        await page.evaluate(() => {
          location.hash = '#/settings/environment';
        });
        await page
          .locator('.python-settings')
          .getByText('Failed to fetch', { exact: true })
          .waitFor();
      },
    );
  },
);

test(
  'Python settings manage packages and selection follows project, meeting and standalone details in both languages',
  { skip: browserSkip },
  async () => {
    const fake = fakeUv();
    await withBrowserApp(
      'python-ui',
      async function* () {
        yield 'Python selection received.';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
        });
        await page.evaluate(() => {
          location.hash = '#/settings/environment';
        });
        await page.getByLabel('环境名称', { exact: true }).fill('统计环境');
        await page.getByRole('button', { name: '新建环境', exact: true }).click();
        await page.locator('[data-python-editor]').waitFor();
        await page.getByLabel('软件包清单', { exact: true }).fill('pandas==3.0.6');
        await page.getByRole('button', { name: '同步到清单', exact: true }).click();
        await page
          .locator('.python-packages')
          .getByText('pandas==3.0.6', { exact: true })
          .waitFor();
        const entry = (await app.python.list()).environments[0];
        await page.locator('#python-default').selectOption(entry.id);
        await page.getByLabel('Python 下载源', { exact: true }).selectOption('custom');
        await page
          .getByLabel('Python 下载地址', { exact: true })
          .fill('https://example.test/python');
        await page.getByRole('button', { name: '保存环境设置' }).click();
        await page.getByText('环境操作已完成', { exact: true }).waitFor();
        assert.equal(
          (await app.python.list()).settings.installMirror,
          'https://example.test/python',
        );
        await shot('python-settings-zh');
        await page.evaluate(() => {
          location.hash = '#/project-new';
        });
        await page.locator('#new-project-name').fill('分析项目');
        await page.waitForFunction(
          (id) =>
            /** @type {HTMLSelectElement} */ (document.querySelector('#new-project-python'))
              ?.value === id,
          entry.id,
        );
        await page.getByRole('button', { name: '创建项目', exact: true }).click();
        await page.getByText('分析项目', { exact: true }).first().waitFor();
        const project = app.core.projects.list().find((item) => item.name === '分析项目');
        const meeting = app.core.meetings.create({
          projectId: project.id,
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        assert.equal(await app.python.selected(meeting.id, null), entry.id);
        await page.evaluate((id) => {
          location.hash = '#/meeting/' + id;
        }, meeting.id);
        await page.getByRole('button', { name: '工作区菜单' }).click();
        await page.getByRole('menuitem', { name: 'Python 环境', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name: '系统 Python', exact: true }).click();
        await page.getByText('Python 环境将在下一轮生效。', { exact: true }).waitFor();
        assert.equal(await app.python.selected(meeting.id, null), 'system');
        await page.keyboard.press('Control+Alt+N');
        await page.getByRole('dialog').waitFor();
        await page.locator('#python-choice').selectOption('system');
        await shot('python-new-chat-zh');
        await page.getByRole('button', { name: '确定', exact: true }).click();
        const before = app.core.meetings.list().length;
        await page.getByLabel('主输入框').fill('Run my standalone analysis');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page.getByText('Python selection received.', { exact: true }).waitFor();
        assert.equal(app.core.meetings.list().length, before + 1);
        const standalone = app.core.meetings
          .list()
          .find((item) => item.title === 'Run my standalone analysis');
        assert.equal(await app.python.selected(standalone.id, null), 'system');
        assert.ok(standalone.workFolder.includes('workspaces'));
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await page.evaluate(() => {
          location.hash = '#/settings/environment';
        });
        await page.getByRole('button', { name: 'Create environment', exact: true }).waitFor();
        await shot('python-settings-en');
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByRole('dialog').getByText('分析项目', { exact: true }).waitFor();
        await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByText('Environment operation completed', { exact: true }).waitFor();
        assert.equal((await app.python.list()).environments.length, 0);
        assert.equal(app.python.binding('project', project.id), null);
      },
      { pythonOptions: { runner: fake.runner } },
    );
  },
);
