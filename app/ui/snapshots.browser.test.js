// History paths use the real host: page-leave snapshots, restore preservation,
// confirmed deletion, and undo/redo that belongs only to one open map editor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

async function openProject(page, app) {
  const project = await app.core.projects.create({ name: 'History project' });
  await page.goto(new URL(`/?token=ui-token#/workbench/${project.id}`, page.url()).href);
  await page.getByText('本项目日志').waitFor();
  return project;
}

async function addPlan(page, text) {
  await page.getByRole('button', { name: '+ 添加计划', exact: true }).click();
  await page.locator('#modal input').fill(text);
  await page.locator('#modal').getByRole('button', { name: '添加', exact: true }).click();
  await page.locator('.plancard', { hasText: text }).waitFor();
}

async function leavePlans(page, projectId) {
  await page.locator('.wb-top').first().getByRole('button', { name: '查看全部' }).click();
  await page.getByRole('heading', { name: '全局计划', exact: true }).waitFor();
  await page.evaluate((id) => {
    location.hash = `#/workbench/${id}`;
  }, projectId);
  await page.getByText('本项目日志').waitFor();
}

test(
  'history previews, restores and deletes versions while keeping current content',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-resource-history', silent, async ({ page, app, shot }) => {
      const project = await openProject(page, app);
      await addPlan(page, 'Original plan');
      await leavePlans(page, project.id);
      const history = page.locator('.wb-left [data-resource-history]');
      const planGroup = history.locator('[data-snapshot-group="plans"]');
      await planGroup.locator('[data-snapshot-id]').waitFor();
      const original = await planGroup
        .locator('[data-snapshot-id]')
        .first()
        .getAttribute('data-snapshot-id');
      await addPlan(page, 'Current plan');
      const originalRow = history.locator(`[data-snapshot-id="${original}"]`);
      await originalRow.getByRole('button', { name: '查看', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '历史版本', exact: true });
      const preview = dialog.locator('[data-snapshot-preview]');
      await preview.getByText('Original plan', { exact: true }).waitFor();
      assert.equal(await preview.getByText('Current plan', { exact: true }).count(), 0);
      assert.equal(
        await preview.locator('textarea, input:not(:disabled), [contenteditable]').count(),
        0,
      );
      await shot('r4-11a-history-preview');
      await preview.getByRole('button', { name: '恢复到此版本', exact: true }).click();
      await page.waitForFunction(
        () =>
          ![...document.querySelectorAll('.plancard')].some((card) =>
            card.textContent.includes('Current plan'),
          ),
      );
      assert.equal(
        (await app.core.workspace.read({ resource: 'plans', key: project.id })).text,
        '- [ ] Original plan\n',
      );
      const preserved = app.core.workspace
        .snapshots({ resource: 'plans', key: project.id })
        .find((snapshot) => snapshot.source === 'before-restore');
      assert.match(app.core.workspace.getSnapshot(preserved.id).text, /Current plan/);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      const preservedRow = history.locator(`[data-snapshot-id="${preserved.id}"]`);
      await preservedRow.getByRole('button', { name: '恢复到此版本', exact: true }).click();
      await page.locator('.plancard', { hasText: 'Current plan' }).waitFor();
      await history
        .locator(`[data-snapshot-id="${original}"]`)
        .getByRole('button', { name: '删除', exact: true })
        .click();
      await page
        .locator('[data-snapshot-confirm]')
        .getByText('删除这个历史版本？当前内容不受影响。')
        .waitFor();
      assert.ok(app.core.workspace.getSnapshot(original));
      await page
        .locator('[data-snapshot-confirm]')
        .getByRole('button', { name: '取消', exact: true })
        .click();
      await history
        .locator(`[data-snapshot-id="${original}"]`)
        .getByRole('button', { name: '删除', exact: true })
        .click();
      await page
        .locator('[data-snapshot-confirm]')
        .getByRole('button', { name: '删除版本', exact: true })
        .click();
      await page.waitForFunction(
        (id) => !document.querySelector(`[data-snapshot-id="${id}"]`),
        original,
      );
      assert.throws(() => app.core.workspace.getSnapshot(original), { code: 'SNAPSHOT_NOT_FOUND' });
      assert.match(
        (await app.core.workspace.read({ resource: 'plans', key: project.id })).text,
        /Current plan/,
      );
      await shot('r4-11a-history-list');
      await page.getByRole('button', { name: '视图', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
      await page
        .locator('.wb-left .wb-title')
        .getByText('History versions', { exact: true })
        .waitFor();
      await page
        .locator('.wb-top')
        .first()
        .getByRole('button', { name: 'History versions', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: 'History versions', exact: true })
        .getByRole('button', { name: 'View', exact: true })
        .first()
        .click();
      await page
        .getByRole('dialog', { name: 'History versions', exact: true })
        .getByText('Read-only preview', { exact: true })
        .waitFor();
      await shot('r4-11a-history-en');
    }),
);

test(
  'map captures final drafts on leave and resets undo redo on reopening',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-map-session-history', silent, async ({ page, app }) => {
      const project = await openProject(page, app);
      await app.core.workspace.edit({
        resource: 'map',
        key: project.id,
        op: 'addNode',
        args: { node: { text: 'Earlier work' } },
      });
      const initialCapture = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/snapshots') &&
          response.request().postDataJSON()?.resource === 'map',
      );
      await page.getByRole('button', { name: '打开研究导图编辑窗口' }).click();
      await initialCapture;
      await page.locator('.editorinspector textarea').waitFor();
      assert.equal(
        await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(),
        false,
      );
      assert.equal(
        await page.getByRole('button', { name: '重做', exact: true }).isEnabled(),
        false,
      );
      await page.locator('.editorinspector textarea').fill('Current session');
      await page.getByRole('button', { name: '保存并更新预览' }).click();
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await page.waitForFunction(
        () =>
          /** @type {HTMLTextAreaElement} */ (document.querySelector('.editorinspector textarea'))
            ?.value === 'Earlier work',
      );
      await page.getByRole('button', { name: '重做', exact: true }).click();
      await page.waitForFunction(
        () =>
          /** @type {HTMLTextAreaElement} */ (document.querySelector('.editorinspector textarea'))
            ?.value === 'Current session',
      );
      await page.locator('.editorinspector textarea').fill('Final draft');
      // Browser navigation also leaves the editing scope, without the editor's back button.
      const finalCapture = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/snapshots') &&
          response.request().postDataJSON()?.resource === 'map',
      );
      await page.goBack();
      await finalCapture;
      await page.getByText('本项目日志').waitFor();
      await page
        .locator('.wb-left [data-snapshot-group="map"] [data-snapshot-id]')
        .first()
        .waitFor();
      assert.equal(
        (await app.core.workspace.read({ resource: 'map', key: project.id })).value.nodes[0].text,
        'Final draft',
      );
      const snapshots = app.core.workspace.snapshots({ resource: 'map', key: project.id });
      assert.equal(snapshots.length, 2);
      assert.equal(
        app.core.workspace.getSnapshot(snapshots[0].id).value.nodes[0].text,
        'Final draft',
      );
      await page.getByRole('button', { name: '打开研究导图编辑窗口' }).click();
      await page.locator('.editorinspector textarea').waitFor();
      assert.equal(
        await page.getByRole('button', { name: '撤销', exact: true }).isEnabled(),
        false,
      );
      assert.equal(
        await page.getByRole('button', { name: '重做', exact: true }).isEnabled(),
        false,
      );
      await page.getByRole('button', { name: '历史版本', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '历史版本', exact: true });
      await dialog.getByRole('button', { name: '查看', exact: true }).first().click();
      await dialog.locator('.mapnode', { hasText: 'Final draft' }).waitFor();
      assert.equal(await dialog.getByRole('button', { name: '新增分支', exact: true }).count(), 0);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('button', { name: '返回工作站' }).click();
      await page.waitForFunction(() =>
        document.querySelector('.wb-left [data-snapshot-group="map"] [data-snapshot-id]'),
      );
      assert.equal(app.core.workspace.snapshots({ resource: 'map', key: project.id }).length, 2);
    }),
);

test(
  'journal and manually edited minutes retain history when their views close',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-journal-minutes-history', silent, async ({ page, app }) => {
      const project = await openProject(page, app);
      await page
        .locator('.wb-top')
        .nth(1)
        .getByRole('button', { name: '查看全部', exact: true })
        .click();
      await page.getByRole('button', { name: '添加日志', exact: true }).click();
      await page.locator('#modal input').fill('Research checkpoint');
      await page.locator('#modal textarea').fill('Preserve the project evidence.');
      await page.locator('#modal').getByRole('button', { name: '添加', exact: true }).click();
      await page.locator('.card', { hasText: 'Research checkpoint' }).waitFor();
      const journalCapture = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/snapshots') &&
          response.request().postDataJSON()?.resource === 'log',
      );
      await page.goBack();
      await journalCapture;
      await page.locator('.wb-left [data-snapshot-group="log"]').waitFor();
      await page
        .locator('.wb-top')
        .nth(1)
        .getByRole('button', { name: '历史版本', exact: true })
        .click();
      const journalHistory = page.getByRole('dialog', { name: '历史版本', exact: true });
      await journalHistory.getByRole('button', { name: '查看', exact: true }).click();
      await journalHistory.getByText('Preserve the project evidence.', { exact: true }).waitFor();
      await journalHistory.getByRole('button', { name: '关闭', exact: true }).click();
      const meeting = app.core.meetings.create({
        projectId: project.id,
        title: 'History meeting',
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      });
      await app.core.workspace.edit(
        {
          resource: 'minutes',
          key: meeting.id,
          op: 'write',
          args: { text: '# Earlier minutes\n\nOriginal research decision.' },
        },
        { actorId: 'person_user' },
      );
      await page.goto(new URL(`/?token=ui-token#/meeting/${meeting.id}`, page.url()).href);
      const openMinutes = async () => {
        await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
        await page.getByRole('menuitem', { name: '对话纪要', exact: true }).click();
        return page.getByRole('dialog', { name: '对话纪要', exact: true });
      };
      const minutes = await openMinutes();
      await minutes.getByRole('button', { name: '编辑', exact: true }).click();
      await minutes
        .getByLabel('纪要内容')
        .fill('# Updated minutes\n\nManually revised research decision.');
      await minutes.getByRole('button', { name: '保存纪要', exact: true }).click();
      await minutes.getByRole('heading', { name: 'Updated minutes', exact: true }).waitFor();
      const minutesCapture = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/snapshots') &&
          response.request().postDataJSON()?.resource === 'minutes',
      );
      await minutes.locator('[data-minutes-close]').click();
      await minutesCapture;
      assert.equal(
        app.core.workspace.snapshots({ resource: 'minutes', key: meeting.id }).length,
        1,
      );
      const reopened = await openMinutes();
      await reopened.getByRole('button', { name: '历史版本', exact: true }).click();
      await reopened.getByRole('button', { name: '查看', exact: true }).click();
      await reopened.getByRole('heading', { name: 'Updated minutes', exact: true }).waitFor();
      assert.equal(await reopened.locator('textarea').count(), 0);
      await reopened.getByRole('button', { name: '返回纪要', exact: true }).click();
      await reopened.getByRole('heading', { name: 'Updated minutes', exact: true }).waitFor();
      await reopened.locator('[data-minutes-close]').click();
    }),
);
