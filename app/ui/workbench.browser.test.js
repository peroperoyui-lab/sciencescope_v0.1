// The workbench path in a real browser: create a project on its page, add a
// plan and a log entry, edit the research map in the editor (with undo),
// make a folder in the project folder and export the project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test('a person organises a project on the workbench', { skip: browserSkip }, () =>
  withBrowserApp('ui-workbench', silent, async ({ page, app, shot }) => {
    await page.locator('.navsection').getByRole('button', { name: '新建项目' }).click();
    await page.getByLabel('项目名称').fill('城市就业韧性');
    await page.getByLabel('研究目标（可选）').fill('解释城市就业的恢复差异');
    await page.getByRole('button', { name: '创建项目' }).click();
    await page.getByText('本项目日志').waitFor();
    const [project] = app.core.projects.list();
    assert.equal(project.description, '解释城市就业的恢复差异');

    await page.locator('.wb-top').first().getByRole('button', { name: '+ 添加计划' }).click();
    await page.locator('#modal input').fill('审查全文');
    await page.locator('#modal').getByRole('button', { name: '添加' }).click();
    await page.locator('.plancard', { hasText: '审查全文' }).waitFor();
    await page.locator('.wb-top').nth(1).getByRole('button', { name: '+ 添加日志' }).click();
    await page.locator('#modal input').fill('确定研究思路');
    await page.locator('#modal textarea').fill('先核查方法。');
    await page.locator('#modal').getByRole('button', { name: '添加' }).click();
    await page.locator('.journalcard', { hasText: '确定研究思路' }).waitFor();
    await page.locator('.wb-top').nth(1).getByRole('button', { name: '查看全部' }).click();
    await page.locator('.card', { hasText: '先核查方法。' }).waitFor();
    await page.goBack();

    await page.getByRole('button', { name: '打开研究导图编辑窗口' }).click();
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
