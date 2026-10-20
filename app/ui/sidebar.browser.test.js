// The sidebar as a person uses it: a running chat shows a spinner (on its
// collapsed project too), a long project folds into 还有 N 个, a standalone
// chat is dragged into a project and the move is undone, then moved by menu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

/** A promise the test resolves to let the scripted model continue. */
function gate() {
  let open = () => {};
  const opened = new Promise((resolve) => {
    open = () => resolve(undefined);
  });
  return { open, opened };
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

test(
  'sidebar: row status, 还有 N 个, drag a chat into a project, undo, and move it by menu',
  { skip: browserSkip },
  async () => {
    const answer = gate();
    await withBrowserApp(
      'sidebar',
      async function* () {
        await answer.opened;
        yield '好了';
      },
      async ({ page, app, shot }) => {
        try {
          await steps(page, app, shot);
        } finally {
          answer.open();
        }
      },
    );
    /** @param {any} page @param {any} app @param {(name: string) => Promise<void>} shot */
    async function steps(page, app, shot) {
      const { core } = app;
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
      });
      const project = await core.projects.create({ name: '城市韧性研究' });
      const other = await core.projects.create({ name: '劳动保障政策演化' });
      const members = [{ participantId: 'person_user' }, { participantId: 'agent_main' }];
      const policy = { mode: 'direct', respondent: 'agent_main', approval: 'auto' };
      const titles = [
        '访谈提纲',
        '问卷题项对照',
        '面板数据清洗',
        '指标体系初稿',
        '研究设计',
        '文献综述框架讨论',
        '变量定义',
      ];
      const chats = titles.map((title) =>
        core.meetings.create({ projectId: project.id, title, members, policy }),
      );
      // The first chat is the oldest.
      chats.forEach((chat, index) =>
        core.db
          .prepare('UPDATE meetings SET updated_at = ? WHERE id = ?')
          .run(`2026-10-0${index + 1}T08:00:00.000Z`, chat.id),
      );
      const scratch = path.join(core.paths.root, 'workspaces', 'scratch');
      await mkdir(scratch, { recursive: true });
      const loose = core.meetings.create({
        title: '参考文献格式整理',
        members,
        policy,
        workFolder: scratch,
      });
      const minutes = path.join(core.paths.root, 'minutes', `${loose.id}.md`);
      await mkdir(path.dirname(minutes), { recursive: true });
      await writeFile(minutes, '# 纪要');

      await page.goto(new URL('/?token=ui-token#/meeting/' + chats[0].id, page.url()).href);
      const sidebar = page.locator('.ss-sidebar');
      const projectRow = sidebar.locator(`[data-object="project"][data-object-id="${project.id}"]`);
      await projectRow.waitFor();
      // Seven chats: five show, and the open one stays visible.
      const more = sidebar.getByRole('button', { name: '还有 1 个' });
      await more.waitFor();
      await sidebar.locator(`[data-object-id="${chats[0].id}"][aria-selected="true"]`).waitFor();
      await more.click();
      await sidebar.getByRole('button', { name: '收起', exact: true }).waitFor();

      // A running chat spins; collapsed, its project spins instead.
      await page.getByRole('textbox', { name: '主输入框' }).fill('整理一下变量');
      await page.getByRole('button', { name: '发送', exact: true }).click();
      const running = sidebar.locator(`[data-object-id="${chats[0].id}"]`);
      await running.locator('.ss-spin').waitFor();
      await running.click({ button: 'right' });
      const archive = page.getByRole('menuitem', { name: '归档（运行中不能归档）' });
      assert.equal(await archive.getAttribute('aria-disabled'), 'true');
      await page.keyboard.press('Escape');
      await projectRow.getByRole('button', { name: '收起 城市韧性研究' }).click();
      // A hovered row shows its buttons in place of the status.
      await page.mouse.move(900, 500);
      await projectRow.locator('.ss-spin').waitFor();
      await shot('sidebar-running');
      answer.open();
      await projectRow.locator('.ss-spin').waitFor({ state: 'detached' });
      await projectRow.getByRole('button', { name: '展开 城市韧性研究' }).click();

      // Drag the standalone chat onto the project; its minutes and default
      // work folder follow it, and 撤销 puts it back.
      const looseRow = sidebar.locator(`[data-object-id="${loose.id}"]`);
      await looseRow.dragTo(projectRow);
      await page.getByText('已把「参考文献格式整理」移到「城市韧性研究」').waitFor();
      await shot('sidebar-moved');
      let moved = core.meetings.get(loose.id);
      assert.equal(moved.projectId, project.id);
      assert.equal(moved.workFolder, core.workspace.locate.projectDir(project.id));
      const projectMinutes = path.join(
        core.workspace.locate.projectDir(project.id),
        'minutes',
        `${loose.id}.md`,
      );
      assert.ok(await exists(projectMinutes));
      assert.equal(await exists(minutes), false);
      await page.locator('.ss-toast').getByRole('button', { name: '撤销' }).click();
      await sidebar
        .locator('.ss-side-section', { hasText: '独立对话' })
        .locator(`[data-object-id="${loose.id}"]`)
        .waitFor();
      assert.equal(core.meetings.get(loose.id).projectId, null);
      assert.ok(await exists(minutes));

      // The menu moves it too.
      await looseRow.hover();
      await looseRow.getByRole('button', { name: '对话菜单' }).click();
      await page.getByRole('menuitem', { name: '移到项目…' }).click();
      await page.getByRole('menuitem', { name: '劳动保障政策演化' }).click();
      // The project row already exists; the notice means the move has finished.
      await page.getByText('已把「参考文献格式整理」移到「劳动保障政策演化」').waitFor();
      moved = core.meetings.get(loose.id);
      assert.equal(moved.projectId, other.id);
      await shot('sidebar');
    }
  },
);
