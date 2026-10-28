// The workbench path in a real browser: create a project on its page, add a
// plan and a log entry, edit the research map in the editor (with undo),
// make a folder in the project folder and export the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test('a person organises a project on the workbench', { skip: browserSkip }, () =>
  withBrowserApp('ui-workbench', silent, async ({ page, app, shot }) => {
    await page.locator('.ss-sidebar').getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('城市就业韧性');
    await page.getByLabel('研究目标（可选）').fill('解释城市就业的恢复差异');
    await page.getByRole('button', { name: '创建项目' }).click();
    await page.getByText('本项目日志').waitFor();
    const [project] = app.core.projects.list();
    assert.equal(project.description, '解释城市就业的恢复差异');

    const plans = page.getByRole('region', { name: '全局计划' });
    await plans.getByRole('button', { name: '添加计划' }).click();
    let dialog = page.getByRole('dialog', { name: '添加计划' });
    await dialog.getByLabel('计划内容').fill('审查全文');
    await dialog.getByLabel('说明（可选）').fill('先看第三章。');
    await dialog.getByLabel('期限（可选）').fill('2026-11-02');
    await dialog.getByRole('button', { name: '添加' }).click();
    const plan = plans.locator('.ss-note-card', { hasText: '审查全文' });
    await plan.getByText('11-02 前').waitFor();
    const planText = async () =>
      (await app.core.workspace.read({ resource: 'plans', key: project.id })).text;
    assert.equal(await planText(), '- [ ] 审查全文\n  先看第三章。\n  due: 2026-11-02\n');
    // The box ticks it off; editing keeps the note and the deadline.
    await plan.getByRole('checkbox', { name: '切换完成状态' }).check();
    await plans.locator('.ss-note-card--done', { hasText: '审查全文' }).waitFor();
    await plan.click();
    dialog = page.getByRole('dialog', { name: '编辑计划' });
    await dialog.getByLabel('计划内容').fill('审查全文和附录');
    await dialog.getByRole('button', { name: '保存' }).click();
    await plans.locator('.ss-note-card--done', { hasText: '审查全文和附录' }).waitFor();
    assert.equal(await planText(), '- [x] 审查全文和附录\n  先看第三章。\n  due: 2026-11-02\n');

    const log = page.getByRole('region', { name: '本项目日志' });
    await log.getByRole('button', { name: '添加日志' }).click();
    dialog = page.getByRole('dialog', { name: '添加日志' });
    await dialog.getByLabel('标题').fill('确定研究思路');
    await dialog.getByLabel('日志详情').fill('先核查方法。');
    await dialog.getByRole('button', { name: '添加' }).click();
    await log.locator('.ss-note-card', { hasText: '先核查方法。' }).waitFor();
    await log.getByRole('button', { name: '查看全部' }).click();
    await page.locator('.card', { hasText: '先核查方法。' }).waitFor();
    await page.goBack();

    await page.getByRole('button', { name: '打开研究导图' }).click();
    await page.getByRole('button', { name: '+ 添加第一个节点' }).first().click();
    const editor = page.locator('.editorinspector textarea');
    await editor.fill('城市就业韧性');
    await page.getByRole('button', { name: '二级分支' }).click();
    await page.locator('.mapnode.secondary').waitFor();
    await shot('map-editor');
    const map = async () =>
      (await app.core.workspace.read({ resource: 'map', key: project.id })).value.nodes;
    assert.deepEqual(
      (await map()).map((node) => node.text),
      ['城市就业韧性', '新的内容'],
    );
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.mapnode.secondary'));
    assert.equal((await map()).length, 1);
    await page.getByRole('button', { name: '重做' }).click();
    await page.locator('.mapnode.secondary').waitFor();
    await page.getByRole('button', { name: '返回工作站' }).click();

    await page.getByRole('button', { name: '展开文件视图' }).click();
    await page.getByRole('button', { name: '新建文件夹' }).click();
    await page.locator('#modal input').fill('data');
    await page.locator('#modal').getByRole('button', { name: '创建' }).click();
    await page.locator('.wb-file-row', { hasText: 'data' }).waitFor();
    const folder = path.join(app.core.paths.projects, project.dirName, 'data');
    assert.ok((await stat(folder)).isDirectory());

    const download = page.waitForEvent('download');
    await page.locator('.foot').getByRole('button', { name: '导出' }).click();
    await page.getByRole('menuitem', { name: '导出项目快照' }).click();
    // The zip holds the project's own folder (the name comes from the response header).
    const saved = await readFile(await (await download).path());
    assert.equal(saved.subarray(0, 2).toString(), 'PK');
    const response = await fetch(
      `${new URL(page.url()).origin}/api/projects/${project.id}/export`,
      {
        headers: { authorization: 'Bearer ui-token' },
      },
    );
    assert.match(response.headers.get('content-disposition'), /%E5%9F%8E.*\.zip/);
  }),
);

test(
  "the workbench's version tree shows a project's manuscripts and opens a version in the desk",
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-workbench-versions', silent, async ({ page, app }) => {
      const { core } = app;
      const project = await core.projects.create({ name: '城市韧性研究' });
      const root = path.join(core.paths.projects, project.dirName);
      await writeFile(path.join(root, 'notes.md'), '# 札记\n\n第一稿。\n');
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { features: { editingDesk: true } } },
      });
      await app.desk.registerDocument({ projectId: project.id, path: 'notes.md' });
      await writeFile(path.join(root, 'notes.md'), '# 札记\n\n第二稿。\n');
      await app.desk.registerDocument({ projectId: project.id, path: 'notes.md' });
      await page.evaluate((id) => {
        location.hash = '#/workbench/' + id;
      }, project.id);
      const toggle = page.getByRole('button', { name: '版本树', exact: true });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
      const tree = page.getByRole('tree', { name: '版本' });
      await tree.getByRole('treeitem').first().waitFor();
      await page.getByRole('button', { name: '文稿' }).getByText('notes.md').waitFor();
      const first = tree.getByRole('treeitem', { name: /^v1\b/u });
      await first.click();
      const popup = page.waitForEvent('popup');
      await page.getByRole('button', { name: '在编辑台打开这一版' }).click();
      const desk = await popup;
      await desk.locator('.ss-page--md p', { hasText: '第一稿。' }).waitFor();
      await page.getByRole('button', { name: '关闭版本树' }).click();
      assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
    }),
);
