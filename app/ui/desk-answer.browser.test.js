import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

const NOTES = '# 研究札记\n\n城市韧性的测度仍有争议。\n\n本文采用熵权法合成指数。\n';
const ANSWER = '样本覆盖 2010–2022 年。';

test(
  'an answer in the desk chat goes into the text at the cursor or onto a sentence as a comment, under the running head',
  { skip: browserSkip, timeout: 60000 },
  () =>
    withBrowserApp('desk-answer', silent, async ({ page, app }) => {
      const { core } = app;
      const project = await core.projects.create({ name: '城市韧性研究' });
      await writeFile(path.join(core.paths.projects, project.dirName, 'notes.md'), NOTES);
      const meeting = core.meetings.create({
        projectId: project.id,
        title: '样本口径',
        members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
      });
      core.messages.post({ meetingId: meeting.id, authorId: 'person_user', text: '样本怎么写？' });
      core.messages.post({ meetingId: meeting.id, authorId: 'agent_main', text: ANSWER });
      const desk = await page.context().newPage();
      const errors = [];
      desk.on('pageerror', (error) => errors.push(error.message));
      const base = page.url().split('?')[0];
      await desk.goto(`${base}?token=ui-token&surface=desk&projectId=${project.id}&path=notes.md`);
      const sheet = desk.locator('.ss-page--md.ss-page--edit');
      await sheet.locator('p', { hasText: '熵权法' }).waitFor();

      // 书眉: the project on the left, the document and its version on the right.
      await desk.waitForFunction(() =>
        document.querySelector('.ss-page--md.ss-page--edit[data-running-left]'),
      );
      assert.equal(await sheet.getAttribute('data-running-left'), '城市韧性研究');
      assert.match(await sheet.getAttribute('data-running-right'), /^notes\.md/u);

      await desk.getByRole('tab', { name: '对话' }).click();
      await desk.getByRole('button', { name: '接续最近的对话' }).click();
      const chat = desk.locator('.ss-desk-chat');
      const answer = chat.locator('.ss-msg', { hasText: ANSWER });
      await answer.waitFor();
      const menu = async (item) => {
        await answer.hover();
        await answer.getByRole('button', { name: '消息菜单' }).click();
        await desk.getByRole('menuitem', { name: item }).click();
      };

      // 插入到正文光标处: the answer goes in where the cursor was.
      await sheet.locator('p', { hasText: '熵权法' }).click();
      await desk.keyboard.press('End');
      await menu('插入到正文光标处');
      await sheet.locator('p', { hasText: `合成指数。${ANSWER}` }).waitFor();

      // 贴到选中的句子上当批注: a comment on the selection, signed with the expert's name.
      await sheet.locator('p', { hasText: '有争议' }).click();
      await desk.keyboard.press('End');
      for (let index = 0; index < 3; index++) await desk.keyboard.press('Shift+ArrowLeft');
      await menu('贴到选中的句子上当批注');
      await desk.getByText('已贴到「争议。」上').waitFor();
      await desk.getByRole('tab', { name: '批注与索引' }).click();
      await desk.getByText(`主专家：${ANSWER}`).waitFor();

      if (errors.length) throw new Error(`Desk page errors: ${errors.join('; ')}`);
    }),
);
