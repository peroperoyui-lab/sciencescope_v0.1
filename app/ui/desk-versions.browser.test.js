import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

const FIRST = '# 研究札记\n\n城市韧性的测度仍有争议。\n';
const SECOND = '# 研究札记\n\n城市韧性的测度仍有争议，本文采用熵权法。\n';

const shoot = async (desk, name) => {
  const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
  if (folder) await desk.screenshot({ path: path.join(folder, `${name}.png`) });
};

test(
  'the version tree opens, renames, tiers, compares, branches from an older version and deletes',
  { skip: browserSkip },
  () =>
    withBrowserApp('u7-versions', silent, async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const root = path.join(app.core.paths.projects, project.dirName);
      await writeFile(path.join(root, 'notes.md'), FIRST);
      const group = await app.desk.registerDocument({ projectId: project.id, path: 'notes.md' });
      // Changed outside the app: opening the desk keeps it as v2.
      await writeFile(path.join(root, 'notes.md'), SECOND);
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=notes.md`);
      const status = desk.locator('.ss-statusbar');
      await desk.locator('.ss-page--md p', { hasText: '熵权法' }).waitFor();
      await status.getByText('已写回项目文件').waitFor();

      // The status bar button opens the tree in the side panel; v2 is being edited.
      await status.getByRole('button', { name: '版本树' }).click();
      const tree = desk.getByRole('tree', { name: '版本' });
      const node = (number) =>
        tree.getByRole('treeitem', { name: new RegExp(`^v${number}\\b`, 'u') });
      await node(2).waitFor();
      assert.equal(await tree.getByRole('treeitem').count(), 2);
      assert.equal(await node(2).getAttribute('data-current'), '');
      assert.match(await node(2).textContent(), /正在编辑/u);

      // v1: renamed in the details, given a tier.
      await node(1).click();
      const name = desk.getByRole('textbox', { name: '版本名称' });
      await name.fill('初稿');
      await name.press('Enter');
      await node(1).filter({ hasText: '初稿' }).waitFor();
      await desk.getByRole('button', { name: '层级' }).click();
      await desk.getByRole('menuitemradio', { name: '投稿' }).click();
      await desk.waitForFunction(() =>
        [...document.querySelectorAll('.ss-vnode')].some(
          (entry) =>
            entry.textContent.includes('初稿') && entry.getAttribute('data-tier') === 'submit',
        ),
      );
      // 标记 shows on the node and is found by the filter; 设为重点 accents it.
      const markBox = desk.getByRole('textbox', { name: '标记' });
      await markBox.fill('导师看过的版本');
      await markBox.press('Tab');
      await node(1).filter({ hasText: '导师看过的版本' }).waitFor();
      await node(1).click({ button: 'right' });
      await desk
        .getByRole('menu', { name: '版本' })
        .getByRole('menuitem', { name: '设为重点' })
        .click();
      await desk.waitForFunction(() =>
        document.querySelector('.ss-vnode[data-key]')?.textContent.includes('初稿'),
      );
      await shoot(desk, 'u7-tree');

      // The filter dims versions that do not match.
      const filter = desk.getByRole('searchbox', { name: '筛选版本' });
      for (const words of ['初稿', '导师']) {
        await filter.fill(words);
        assert.equal(await node(2).getAttribute('data-dim'), '');
        assert.equal(await node(1).getAttribute('data-dim'), null);
      }
      await filter.fill('');

      // 和 v2 比较 opens the side-by-side comparison.
      await desk.getByRole('button', { name: '和 v2 比较' }).click();
      await status.getByText('正在比较两个版本').waitFor();
      // The key version heads the version choices.
      await desk.getByRole('button', { name: '右边的版本' }).click();
      const first = desk.getByRole('menuitemradio').first();
      assert.match(await first.textContent(), /^v1\b.*重点/su);
      await desk.keyboard.press('Escape');
      await desk.getByRole('button', { name: '退出比较' }).click();
      await status.getByText('正在比较两个版本').waitFor({ state: 'detached' });

      // Right-click v1 → 从这一版开始编辑: the page reopens at v1.
      await node(1).click({ button: 'right' });
      const menu = desk.getByRole('menu', { name: '版本' });
      await menu.getByRole('menuitem', { name: /删除这一版/u }).waitFor();
      if (process.env.SCIENCESCOPE_SCREENSHOTS) await desk.waitForTimeout(300);
      await shoot(desk, 'u7-menu');
      await menu.getByRole('menuitem', { name: '从这一版开始编辑' }).click();
      await desk.locator('.ss-page--md p', { hasText: '仍有争议。' }).waitFor();
      await status.getByText('v1 · 主线 · 投稿').waitFor();
      // Typed changes kept as a version grow a branch from v1.
      await desk.locator('.ss-page--md p', { hasText: '仍有争议。' }).click();
      await desk.keyboard.press('End');
      await desk.keyboard.type('另起一稿。');
      await status.getByText('有修改未写回').waitFor();
      const session = app.core.db
        .prepare(`SELECT id FROM desk_sessions WHERE status='open' AND group_id=?`)
        .get(group.id);
      await desk.waitForTimeout(1200);
      await app.desk.save(String(session.id), { to: 'version' });
      await node(3).waitFor();
      const branch = tree.locator('.ss-vbranch');
      await branch.waitFor();
      await shoot(desk, 'u7-branch');
      // A branch folds into one chip and opens again.
      await branch.click();
      await tree.locator('.ss-vfold', { hasText: '1 版' }).click();
      await node(3).waitFor();

      // v2 has no later versions: it can be deleted after asking.
      await node(2).click({ button: 'right' });
      await menu.getByRole('menuitem', { name: '删除这一版' }).click();
      await desk.getByRole('dialog').getByRole('button', { name: '删除' }).click();
      await node(2).waitFor({ state: 'detached' });
      // v1 has a child now, so it cannot be deleted.
      await node(1).click({ button: 'right' });
      assert.match(
        await menu.getByRole('menuitem', { name: /删除这一版/u }).textContent(),
        /有后续版本/u,
      );
      await desk.keyboard.press('Escape');
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
