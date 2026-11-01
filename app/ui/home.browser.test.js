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
      // 继续写作 offers three ways to open the draft.
      await drafts.getByRole('button', { name: '继续写作' }).click();
      for (const item of ['在编辑台打开', '在资源管理器中显示', '用默认程序打开'])
        await page.getByRole('menuitem', { name: item }).waitFor();
      await page.keyboard.press('Escape');
      await page.locator('[data-site]', { hasText: 'arXiv' }).waitFor();
      assert.equal(await page.getByText('最近工作').count(), 0);

      // Without a project only the two starters that need none are offered.
      await page.evaluate(() => (location.hash = '#/'));
      await page.locator('[data-home-progress]').waitFor({ state: 'detached' });
      await page.waitForFunction(() => document.querySelectorAll('[data-starter]').length === 2);
    }),
);

test(
  'the home shows the secretary’s progress and cards for the project last left, and a card starts a chat there',
  { skip: browserSkip, timeout: 60000 },
  () =>
    withBrowserApp('home-slot', silent, async ({ page, app, shot }) => {
      const { core } = app;
      const project = await core.projects.create({ name: '城市韧性研究' });
      const other = await core.projects.create({ name: '劳动保障政策演化' });
      const cards = [
        [
          'scale',
          '挑一挑开题报告',
          '找出最容易被追问的三处',
          '请读开题报告，找出三处。',
          'agent_red_team',
        ],
        ['list-checks', '补齐 2015 年数据', '计划里还没做完', '接着补齐 2015 年数据。', null],
        [
          'file-pen',
          '按审稿标准读',
          '标出必须修改的地方',
          '按审稿标准读第 3 版。',
          'agent_reviewer',
        ],
        ['lightbulb', '定义城市韧性', '边界和维度', '帮我定义城市韧性。', 'agent_methodologist'],
      ].map(([icon, title, sub, text, expertId]) => ({ icon, title, sub, text, expertId }));
      core.db
        .prepare(
          `UPDATE home_starters_state SET slot_project_id=?, slot_result_json=?, slot_written_at=? WHERE id=1`,
        )
        .run(
          project.id,
          JSON.stringify({ progress: '指标体系定稿，等补 2015 年数据。', cards }),
          '2026-11-01T00:00:00Z',
        );
      core.events.record(
        'home.starters.updated',
        { projectId: project.id },
        { projectId: project.id },
      );
      await page.reload();

      const progress = page.locator('[data-home-progress]');
      await progress.getByText('指标体系定稿，等补 2015 年数据。').waitFor();
      assert.match(await progress.textContent(), /^城市韧性研究：/u);
      const starters = page.locator('[data-starter]');
      assert.equal(await starters.count(), 4);
      await starters.filter({ hasText: '@魔鬼代言人 · 找出最容易被追问的三处' }).waitFor();
      await page.getByText('点一下在「城市韧性研究」里开新对话，改几个字再发').waitFor();
      await shot('home-secretary-slot');

      // A card on the home without a project opens a new chat in that project.
      await starters.filter({ hasText: '定义城市韧性' }).click();
      await page.waitForFunction((id) => location.hash === `#/new/${id}`, project.id);
      await page.waitForFunction(
        () =>
          /** @type {HTMLTextAreaElement} */ (document.activeElement)?.value ===
          '@方法学家 帮我定义城市韧性。',
      );

      // Another project's home keeps the template.
      await page.evaluate((id) => (location.hash = `#/new/${id}`), other.id);
      await page.locator('[data-starter]', { hasText: '让魔鬼代言人先唱唱反调' }).waitFor();
      assert.equal(await page.getByText('指标体系定稿').count(), 0);
    }),
);
