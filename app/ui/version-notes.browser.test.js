import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'version notes render, retain edits and history, reorganize a selected baseline and quote into a chat',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let count = 0;
    await withBrowserApp(
      'version-notes-ui',
      async function* ({ input }) {
        const packet = JSON.parse(input);
        yield JSON.stringify({
          markdown: `# 版本说明\n## 实际文件变化\n整理第${++count}次，基线${packet.baseline?.number ?? '无'}。\n## 秘书的解释\n保持证据。\n## 待用户决定的建议\n建议尚未实施。`,
          references: [],
        });
      },
      async ({ page, app, shot }) => {
        const project = await app.core.projects.create({ name: '版本说明验收' });
        const main = app.core.meetings.create({ projectId: project.id, title: '论文讨论' });
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
        const saved = await app.versions.importFiles({
          projectId: project.id,
          files: [
            { name: '第一版.md', base64: Buffer.from('第一版正文。').toString('base64') },
            { name: '第二版.md', base64: Buffer.from('第二版新增正文。').toString('base64') },
          ],
        });
        await app.versionNotes.idle();
        const version = saved.versions[1];
        await page.goto(new URL(`/#/version-notes/${project.id}/${version.id}`, page.url()).href);
        await page
          .locator('[data-version-notes] .markdown')
          .getByText('待用户决定的建议', { exact: true })
          .waitFor();
        await page.getByLabel('补充说明', { exact: true }).fill('我的补充，先核查方法。');
        await page.getByRole('button', { name: '保存补充', exact: true }).click();
        await page
          .locator('.markdown')
          .getByText('我的补充，先核查方法。', { exact: false })
          .waitFor();
        await page.getByRole('button', { name: '编辑说明', exact: true }).click();
        const editor = page.getByLabel('编辑版本说明', { exact: true });
        await editor.fill((await editor.inputValue()) + '\n全文编辑已保留。');
        await page.getByRole('button', { name: '保存说明', exact: true }).click();
        await page.locator('.markdown').getByText('全文编辑已保留。', { exact: false }).waitFor();
        assert.ok(
          app.core.workspace
            .snapshots({ resource: 'versions', key: `${project.id}/${version.id}` })
            .some((entry) => entry.actorId === 'person_user'),
        );
        await page.getByLabel('比较基线').selectOption('');
        await page.getByRole('button', { name: '重新整理', exact: true }).click();
        await page
          .locator('.markdown')
          .getByText('整理第3次，基线无。', { exact: false })
          .waitFor();
        await shot('version-notes-chinese');
        await page.getByLabel('引用到对话').selectOption(main.id);
        await page.getByRole('button', { name: '引用说明到对话', exact: true }).click();
        await page.waitForURL(`**/#/meeting/${main.id}`);
        assert.equal(app.researchInput.draft(main.id).materials[0].type, 'version-notes');
        assert.equal(app.core.messages.since(main.id, 0).length, 0);
        await page.goto(new URL(`/#/version-notes/${project.id}/${version.id}`, page.url()).href);
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await page.getByRole('button', { name: 'Save additional notes', exact: true }).waitFor();
        await shot('version-notes-english');
        await page.goto(new URL('/#/settings/secretary-settings', page.url()).href);
        await page.getByLabel('Version notes template').fill('# Edited template');
        await page.getByRole('button', { name: 'Save template', exact: true }).click();
        await page.getByText('Notes template saved.', { exact: true }).waitFor();
        assert.equal(
          (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value.versionNotes
            .template,
          '# Edited template',
        );
      },
    );
  },
);
