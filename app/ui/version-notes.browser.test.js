// The secretary's 稿件版本说明 in the workbench's version tree: files from
// outside are imported as versions and organized, their notes show in the
// version details, what the notes point to opens, and 重新整理 and 自动整理 work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'imported versions show the secretary notes in the version tree and can be reorganized',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let count = 0;
    let item;
    await withBrowserApp(
      'version-notes-tree',
      async function* ({ input }) {
        const packet = JSON.parse(input);
        yield JSON.stringify({
          markdown: `# 版本说明\n## 实际文件变化\n整理第${++count}次，基线${packet.baseline?.number ?? '无'}。\n## 待用户决定的建议\n建议尚未实施。`,
          references: [
            {
              schema: 1,
              kind: 'item',
              id: item.id,
              projectId: item.projectId,
              label: '关联研究条目',
            },
          ],
        });
      },
      async ({ page, app, shot }) => {
        const project = await app.core.projects.create({ name: '版本说明验收' });
        item = app.research.store.createItem({
          type: 'claim',
          subtype: 'hypothesis',
          title: '核查研究关联',
          body: '精确关联条目内容。',
          projectId: project.id,
          scope: 'project',
          visibility: 'shared',
          payload: {},
        });
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              models: { default: { provider: 'fake', model: 'notes' } },
              summary: { onEnterProject: false, onLeaveProject: false },
              memory: { enabled: false },
            },
          },
        });
        await page.evaluate((id) => (location.hash = '#/workbench/' + id), project.id);
        await page.getByRole('button', { name: '版本树', exact: true }).click();

        // Import two files as one manuscript, in the order chosen in the dialog.
        await page.locator('[data-version-import]').setInputFiles([
          { name: '第二版.md', mimeType: 'text/markdown', buffer: Buffer.from('第二版新增正文。') },
          { name: '第一版.md', mimeType: 'text/markdown', buffer: Buffer.from('第一版正文。') },
        ]);
        const dialog = page.getByRole('dialog', { name: '导入文稿版本' });
        await dialog.getByLabel('版本组名称').fill('论文');
        await dialog.getByRole('button', { name: '下移 第二版.md' }).click();
        await shot('version-import');
        await dialog.getByRole('button', { name: '导入', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        const tree = page.getByRole('tree', { name: '版本' });
        await tree.getByRole('treeitem', { name: /^v2\b/u }).waitFor();
        const saved = app.versions.list(project.id)[0];
        const numbers = Object.fromEntries(
          saved.versions.map((version) => [version.name, version.number]),
        );
        assert.deepEqual(numbers, { '第一版.md': 1, '第二版.md': 2 });

        // New versions are organized on import; the notes show in the version's details.
        await tree.getByRole('treeitem', { name: /^v2\b/u }).click();
        const notes = page.locator('[data-version-notes]');
        await notes.getByText('基线1。', { exact: false }).waitFor();
        await notes.locator('.ss-tag', { hasText: '已整理' }).waitFor();
        await shot('version-notes-tree');
        const before = count;
        await notes.getByRole('button', { name: '重新整理' }).click();
        await notes.getByText(`整理第${before + 1}次`, { exact: false }).waitFor();
        await notes.getByRole('button', { name: '关联研究条目' }).click();
        await page.getByRole('dialog').getByText('精确关联条目内容。', { exact: false }).waitFor();
        await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();

        // 自动整理 is a project setting.
        const auto = notes.getByLabel('这个项目的新版本自动整理说明');
        assert.equal(await auto.isChecked(), true);
        await auto.uncheck();
        for (let tries = 0; app.versionNotes.autoOrganize(project.id) && tries < 50; tries++)
          await new Promise((resolve) => setTimeout(resolve, 100));
        assert.equal(app.versionNotes.autoOrganize(project.id), false);
      },
    );
  },
);
