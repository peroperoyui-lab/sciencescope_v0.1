import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

const NOTES = '# 研究札记\n\n城市韧性的测度仍有争议。\n\n本文采用熵权法合成指数。\n';

const shoot = async (page, name) => {
  const folder = process.env.SCIENCESCOPE_SCREENSHOTS;
  if (folder) await page.screenshot({ path: path.join(folder, `${name}.png`) });
};

test(
  'an expert suggests the desk: entering on a branch binds the desk chat, quotes land there and the secretary opens',
  { skip: browserSkip, timeout: 90000 },
  () =>
    withBrowserApp('u8-desk-entry', silent, async ({ page, app }) => {
      const { core } = app;
      const project = await core.projects.create({ name: '城市韧性研究' });
      await writeFile(path.join(core.paths.projects, project.dirName, 'notes.md'), NOTES);
      await core.workspace.edit({
        resource: 'settings',
        key: 'app',
        op: 'patch',
        args: {
          changes: {
            models: { default: { provider: 'test', model: 'test' } },
          },
        },
      });
      const meeting = core.meetings.create({
        projectId: project.id,
        title: '研究设计讨论',
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      });
      core.messages.post({
        meetingId: meeting.id,
        authorId: 'person_user',
        text: '帮我起草札记。',
      });
      core.messages.post({ meetingId: meeting.id, authorId: 'agent_main', text: '初稿写好了。' });
      await page.evaluate((id) => {
        location.hash = '#/meeting/' + id;
      }, meeting.id);
      await page.getByText('初稿写好了。').waitFor();

      // desk_suggest records the suggestion; the bar comes up above the input.
      core.db.transaction(() =>
        core.events.record(
          'desk.suggested',
          { meetingId: meeting.id, reason: '初稿已经成形', key: `${project.id}/path:notes.md` },
          { meetingId: meeting.id, projectId: project.id, actorId: 'agent_main' },
        ),
      );
      const bar = page.locator('.ss-desk-entry');
      await bar.getByText('要进入编辑台继续改吗？').waitFor();
      assert.match(await bar.textContent(), /notes\.md · 初稿已经成形/u);
      await shoot(page, 'u8-entry-bar');

      // 开新分支进入: the desk opens on the document, bound to a new branch.
      const before = core.messages.list(meeting.id).messages.length;
      const popup = page.waitForEvent('popup');
      await bar.getByRole('button', { name: '开新分支进入' }).click();
      const desk = await popup;
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      await desk.locator('.ss-page--md p', { hasText: '熵权法' }).waitFor();
      await bar.waitFor({ state: 'detached' });
      const branch = core.meetings.list({ projectId: project.id }).find((m) => m.parentMeetingId);
      assert.equal(branch.parentMeetingId, meeting.id);
      assert.equal(core.messages.list(meeting.id).messages.length, before);

      const status = desk.locator('.ss-statusbar');
      await status.getByRole('button', { name: branch.title }).click();
      const chat = desk.locator('.ss-desk-chat');
      await chat.locator('.ss-tag', { hasText: '分支' }).waitFor();
      await chat.getByText(/从「研究设计讨论」分出/u).waitFor();
      await chat.getByText('初稿写好了。').waitFor();

      // 引用到对话 puts the sentence into this tab's input.
      await desk.getByRole('tab', { name: '批注与索引' }).click();
      const line = desk.locator('.ss-page--md p', { hasText: '熵权法' });
      await line.click();
      // The chat tab's input can still hold focus until the page takes it.
      await desk.waitForFunction(() => document.activeElement?.closest('.ss-page--md'));
      await desk.keyboard.press('End');
      for (let index = 0; index < 4; index++) await desk.keyboard.press('Shift+ArrowLeft');
      await desk.keyboard.press('Control+Shift+L');
      await chat.locator('[data-desk-quote]', { hasText: '指数。' }).waitFor();
      assert.equal(
        await desk.getByRole('tab', { name: '对话' }).getAttribute('aria-selected'),
        'true',
      );
      const draft = await app.researchInput.draft(branch.id);
      assert.equal(draft.marks.length, 1);
      await chat.getByRole('textbox').fill('这里的依据够不够？');
      await shoot(desk, 'u8-desk-chat');
      await chat.getByRole('button', { name: '发送' }).click();
      await chat.locator('.ss-msg--user', { hasText: '这里的依据够不够？' }).waitFor();
      assert.ok(
        core.messages.list(branch.id).messages.some((m) => m.text === '这里的依据够不够？'),
      );
      assert.equal(core.messages.list(meeting.id).messages.length, before);

      // The orb opens the bound chat's secretary in the side panel; the arrow goes back.
      await desk.getByRole('button', { name: '任务秘书' }).click();
      const secretary = desk.locator('.side-panel', { hasText: '任务秘书' });
      await secretary.getByRole('textbox', { name: '任务秘书输入' }).waitFor();
      // The head names the chat the secretary follows.
      assert.equal(
        await secretary.locator('.ss-panel__title').textContent(),
        `任务秘书 · ${branch.title}`,
      );
      await shoot(desk, 'u8-desk-secretary');
      await secretary.getByRole('button', { name: '回到对话' }).click();
      await chat.waitFor();

      // 换成别的对话 rebinds the desk to the original chat.
      await chat.getByRole('button', { name: '更多' }).click();
      await desk.getByRole('menuitem', { name: '换成别的对话…' }).click();
      await desk.getByRole('menuitemcheckbox', { name: '研究设计讨论', exact: true }).click();
      await chat.locator('.ss-tag', { hasText: '分支' }).waitFor({ state: 'detached' });
      await status.getByRole('button', { name: '研究设计讨论', exact: true }).waitFor();
      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);

test(
  'the desk without a bound chat offers to continue the latest one, and the orb waits for it',
  { skip: browserSkip },
  () =>
    withBrowserApp('u8-desk-unbound', silent, async ({ page, app }) => {
      const { core } = app;
      const project = await core.projects.create({ name: '城市韧性研究' });
      await writeFile(path.join(core.paths.projects, project.dirName, 'notes.md'), NOTES);
      core.meetings.create({
        projectId: project.id,
        title: '样本口径',
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      });
      const desk = await page.context().newPage();
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=notes.md`);
      await desk.locator('.ss-page--md p', { hasText: '熵权法' }).waitFor();
      const orb = desk.getByRole('button', { name: '任务秘书' });
      assert.equal(await orb.getAttribute('aria-disabled'), 'true');
      await desk.getByRole('tab', { name: '对话' }).click();
      await desk.getByText('还没有绑定对话').waitFor();
      await shoot(desk, 'u8-desk-unbound');
      await desk.getByRole('button', { name: '接续最近的对话' }).click();
      await desk.locator('.ss-desk-chat__title', { hasText: '样本口径' }).waitFor();
      assert.equal(await orb.getAttribute('aria-disabled'), null);
    }),
);
