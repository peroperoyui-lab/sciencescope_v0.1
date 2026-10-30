import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test(
  'the home shows where the project stands, fills the composer from a starter and offers the latest draft',
  { skip: browserSkip, timeout: 60000 },
  () =>
    withBrowserApp('home-next', silent, async ({ page, app }) => {
      const { core } = app;
      const project = await core.projects.create({ name: '城市韧性研究' });
      await writeFile(
        path.join(core.paths.projects, project.dirName, 'notes.md'),
        '# 研究札记\n\n城市韧性的测度仍有争议。\n',
      );
      await app.desk.registerDocument({ projectId: project.id, path: 'notes.md' });
      await core.workspace.edit({
        resource: 'plans',
        key: project.id,
        op: 'append',
        args: { text: '- [ ] 补齐 2015 年数据\n- [x] 确定指标\n' },
      });
      const meeting = core.meetings.create({ projectId: project.id, title: '样本口径' });
      await page.evaluate(() =>
        fetch('/api/settings', {
          method: 'PATCH',
          headers: { authorization: 'Bearer ui-token', 'content-type': 'application/json' },
          body: JSON.stringify({ sites: [{ name: 'arXiv', url: 'https://arxiv.org' }] }),
        }),
      );
      await page.reload();
      await page.evaluate((id) => (location.hash = `#/new/${id}`), project.id);

      const progress = page.locator('[data-home-progress]');
      await progress.getByText(/计划里还有 1 件事没做完/u).waitFor();
      assert.match(await progress.textContent(), /城市韧性研究：《notes\.md》改到第 1 版/u);
      await progress.getByRole('button', { name: '继续：样本口径' }).click();
      await page.waitForFunction((id) => location.hash === `#/meeting/${id}`, meeting.id);
      await page.goBack();

      // A starter goes into the composer, caret at the end, and is not sent.
      const starters = page.locator('[data-starter]');
      assert.equal(await starters.count(), 4);
      await starters.filter({ hasText: '接着做：补齐 2015 年数据' }).click();
      const box = page.locator('.ss-composer textarea');
      await page.waitForFunction(() =>
        /** @type {HTMLTextAreaElement} */ (document.activeElement)?.value?.includes('补齐'),
      );
      assert.match(await box.inputValue(), /接着做计划里的这一件：补齐 2015 年数据/u);
      assert.equal(
        await box.evaluate((node) => /** @type {HTMLTextAreaElement} */ (node).selectionStart),
        (await box.inputValue()).length,
      );
      assert.equal(core.meetings.list({ projectId: project.id }).length, 1);

      // The latest draft and the sites; no chats listed by time.
      const drafts = page.locator('[data-home-drafts]');
      await drafts.getByText('notes.md').waitFor();
      await drafts.getByRole('button', { name: '继续写作' }).waitFor();
      await page.locator('[data-site]', { hasText: 'arXiv' }).waitFor();
      assert.equal(await page.getByText('最近工作').count(), 0);

      // Without a project only the two starters that need none are offered.
      await page.evaluate(() => (location.hash = '#/'));
      await page.locator('[data-home-progress]').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('[data-starter]').length === 2);
    }),
);
