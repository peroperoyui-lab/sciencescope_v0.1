import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test(
  'the project files page shows how files are indexed, recycles entries and changes location',
  { skip: browserSkip },
  () =>
    withBrowserApp('r411-project-folder', silent, async ({ page, app, shot }) => {
      const chosen = path.join(app.core.paths.root, '中文外部文件夹');
      await mkdir(chosen);
      const project = await app.core.projects.create({ name: '文件夹验收' });
      const internal = path.join(app.core.paths.projects, project.dirName);
      await mkdir(path.join(internal, 'notes-data'), { recursive: true });
      await writeFile(
        path.join(internal, 'notes-data', '访谈纪要.md'),
        '# 访谈\n\n社区韧性的三种说法。\n',
      );
      await page.locator('.ss-sidebar .ss-tree-row__open', { hasText: project.name }).click();
      // The workbench card shows the same tree; ScienceScope's own folders stay hidden.
      const card = page.locator('.ss-folder-card');
      await card.getByRole('treeitem', { name: /notes-data/ }).waitFor();
      assert.equal(await card.getByRole('treeitem', { name: /^workbench/ }).count(), 0);
      await card.getByRole('button', { name: '打开项目资料页' }).click();

      const tree = page.getByRole('tree', { name: '项目文件夹' });
      await tree.getByRole('treeitem', { name: /notes-data/ }).click();
      const file = tree.getByRole('treeitem', { name: /访谈纪要\.md/ });
      await file.click();
      await file.locator('[data-state="parsed"]').waitFor();
      const details = page.locator('.ss-folder__detail');
      await details.getByText('社区韧性的三种说法。').waitFor();
      await details.getByText(/已解析 · \d+ 个文本块/).waitFor();
      await page.locator('.ss-folder__summary', { hasText: '已索引 1 个文件' }).waitFor();
      await shot('project-folder');
      // A project's own notes open in its database with the file selected.
      await details.getByRole('button', { name: '在知识库中查看' }).click();
      await page.waitForFunction(() => location.hash.startsWith('#/database/'));
      await page
        .locator('[data-rb-source-detail], .ss-panel', { hasText: '访谈纪要' })
        .first()
        .waitFor();
      await page.goBack();
      await tree.getByRole('treeitem', { name: /notes-data/ }).click();
      await file.click();
      // Keyboard: up goes back to the folder, left closes it.
      await file.press('ArrowUp');
      await tree.getByRole('treeitem', { name: /notes-data/ }).press('ArrowLeft');
      await file.waitFor({ state: 'detached' });

      await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
      let dialog = page.getByRole('dialog', { name: '新建文件夹' });
      await dialog.getByLabel('名称').fill('回收站验收');
      await dialog.getByRole('button', { name: '创建', exact: true }).click();
      const row = tree.getByRole('treeitem', { name: /回收站验收/ });
      await row.click({ button: 'right' });
      await page.getByRole('menuitem', { name: '移到回收站' }).click();
      dialog = page.getByRole('dialog', { name: '移到回收站？' });
      await dialog.getByRole('button', { name: '取消', exact: true }).click();
      await row.waitFor();
      await row.press('Delete');
      await dialog.getByRole('button', { name: '移到回收站', exact: true }).click();
      await row.waitFor({ state: 'detached' });
      assert.equal((await readdir(internal)).includes('回收站验收'), false);

      await page.evaluate((folder) => {
        globalThis.__TAURI__ = { dialog: { open: async () => folder } };
      }, chosen);
      const header = page.locator('.ss-folder-page > .ss-header');
      await header.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '项目文件夹位置…' }).click();
      dialog = page.getByRole('dialog', { name: '项目文件夹位置' });
      await dialog.getByRole('button', { name: '选择已有文件夹' }).click();
      await dialog.getByRole('button', { name: '绑定', exact: true }).click();
      await header.locator('.ss-folder__root', { hasText: chosen }).waitFor();
      assert.equal(app.core.projects.get(project.id).folder, chosen);
      await page
        .getByRole('heading', { name: '项目文件夹是空的' })
        .or(page.getByText('项目文件夹是空的'))
        .waitFor();
      await header.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '项目文件夹位置…' }).click();
      await dialog.getByRole('button', { name: '使用项目自带文件夹' }).click();
      await header.locator('.ss-folder__root', { hasText: internal }).waitFor();
      assert.equal(app.core.projects.get(project.id).folder, null);
    }),
);
