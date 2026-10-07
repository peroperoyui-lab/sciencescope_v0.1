import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test(
  'project folders recycle selected entries and change location without moving files',
  { skip: browserSkip },
  () =>
    withBrowserApp('r411-project-folder', silent, async ({ page, app, shot }) => {
      const chosen = path.join(app.core.paths.root, '中文外部文件夹');
      await mkdir(chosen);
      const project = await app.core.projects.create({ name: '文件夹验收' });
      await page.locator('.tree-name', { hasText: project.name }).click();
      await page.getByRole('button', { name: '展开文件视图' }).click();
      await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
      await page.locator('#modal input').fill('回收站验收');
      await page.locator('#modal').getByRole('button', { name: '创建', exact: true }).click();
      const row = page.locator('.wb-file-row', { hasText: '回收站验收' });
      await row.waitFor();
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '移到回收站' }).click();
      await page.locator('#modal').getByRole('button', { name: '取消', exact: true }).click();
      await row.waitFor();
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '移到回收站' }).click();
      await page.locator('#modal').getByRole('button', { name: '确认删除' }).click();
      await row.waitFor({ state: 'detached' });
      const internal = path.join(app.core.paths.projects, project.dirName);
      assert.equal((await readdir(internal)).includes('回收站验收'), false);
      await page.evaluate((folder) => {
        globalThis.__TAURI__ = { dialog: { open: async () => folder } };
      }, chosen);
      await page.getByRole('button', { name: '项目文件夹位置', exact: true }).click();
      await page.locator('#modal').getByRole('button', { name: '选择已有文件夹' }).click();
      await page.locator('.card > .wb-path').filter({ hasText: chosen }).waitFor();
      assert.equal(app.core.projects.get(project.id).folder, chosen);
      await page.getByRole('button', { name: '项目文件夹位置', exact: true }).click();
      await page.locator('#modal').getByRole('button', { name: '使用项目自带文件夹' }).click();
      await page.locator('.card > .wb-path').filter({ hasText: internal }).waitFor();
      await shot('project-folder');
      await page.evaluate((id) => {
        location.hash = '#/workbench/' + id;
      }, project.id);
      await page.locator('.wb-right').waitFor();
      assert.equal(await page.locator('.wb-right .wb-path').count(), 0);
    }),
);
