import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'drop ordered manuscript versions into one group, preview, rename, recycle and switch language',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    await withBrowserApp(
      'versions-ui',
      async function* () {
        yield '完成。';
      },
      async ({ page, app, shot }) => {
        const project = await app.core.projects.create({ name: '中文论文项目' });
        await page.goto(new URL(`/?token=ui-token#/workbench/${project.id}`, page.url()).href);
        await page.getByText('暂无文献版本', { exact: true }).waitFor();
        await page.locator('[data-drop="version"]').evaluate((element) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File(['第一稿的研究句子。'], '初稿.md', { type: 'text/markdown' }),
          );
          transfer.items.add(
            new File(['第二稿的研究句子。'], '修订稿.md', { type: 'text/markdown' }),
          );
          element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
        });
        await page.getByLabel('版本组名称').fill('研究论文');
        await page.getByRole('button', { name: '上移 修订稿.md', exact: true }).click();
        await page.getByRole('button', { name: '导入', exact: true }).click();
        await page.getByText('修订稿.md · v1', { exact: true }).waitFor();
        await page.getByText('初稿.md · v2', { exact: true }).waitFor();
        const groups = app.versions.list(project.id);
        assert.equal(groups.length, 1);
        assert.deepEqual(
          groups[0].versions.map((v) => v.name),
          ['初稿.md', '修订稿.md'],
        );
        const row = page.locator(`[data-version-id="${groups[0].versions[0].id}"]`);
        await row.getByRole('button', { name: '版本菜单', exact: true }).click();
        await page.getByRole('menuitem', { name: '预览', exact: true }).click();
        await page
          .locator('.file-preview-panel')
          .getByText('第一稿的研究句子。', { exact: false })
          .waitFor();
        await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
        await page.getByRole('button', { name: '重命名版本组', exact: true }).click();
        await page.getByRole('dialog').locator('input').fill('重命名研究论文');
        await page.getByRole('dialog').getByRole('button', { name: '确定', exact: true }).click();
        await page.getByText('重命名研究论文', { exact: true }).waitFor();
        await shot('versions-workbench');
        await row.getByRole('button', { name: '版本菜单', exact: true }).click();
        await page.getByRole('menuitem', { name: '移到回收站', exact: true }).click();
        await page.getByRole('button', { name: '确认删除', exact: true }).click();
        await row.waitFor({ state: 'detached' });
        await page.goto(new URL(`/#/versions/${project.id}`, page.url()).href);
        await page.locator('.mainbody [data-version-id]').waitFor();
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await page.locator('.mainhead').getByText('Manuscript versions', { exact: true }).waitFor();
        assert.match(await page.locator('.versionlist').innerText(), /Awaiting notes/);
        await shot('versions-english');
        await page.goto(new URL('/#/settings/environment', page.url()).href);
        await page.getByLabel('Model download source').selectOption('custom');
        await page.getByLabel('Model source URL').fill('https://domestic.example');
        await page.getByLabel('Model source URL').blur();
        await page.waitForFunction(async () => {
          const r = await fetch('/api/settings', {
            headers: { authorization: 'Bearer ' + sessionStorage.getItem('sciencescope.token') },
          });
          const settings = await r.json();
          return (
            settings.semantic.downloadSource === 'custom' &&
            settings.semantic.customDownloadUrl === 'https://domestic.example'
          );
        });
      },
    );
  },
);
