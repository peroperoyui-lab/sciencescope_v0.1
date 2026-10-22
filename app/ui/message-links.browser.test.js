// Links into a long conversation: a search hit or an evidence link names one
// message, possibly older than the first loaded page, and a second link into
// the same conversation moves the view to the new message.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'message links: search hit and old-message links load earlier pages and re-target',
  { skip: browserSkip },
  async () => {
    await withBrowserApp(
      'message-links',
      async function* () {
        yield '';
      },
      async ({ page, app, shot }) => {
        const meeting = app.core.meetings.create({
          title: '长对话',
          members: [{ participantId: 'person_user' }],
        });
        const posted = [];
        for (let index = 1; index <= 150; index++)
          posted.push(
            app.core.messages.post({
              meetingId: meeting.id,
              authorId: 'person_user',
              text: index === 5 ? '第 5 条：样本量是 1284 家企业' : `第 ${index} 条记录`,
            }),
          );
        const target = (message) => page.locator(`[data-message-id="${message.id}"][data-target]`);
        await page.goto(new URL(`/?token=ui-token#/meeting/${meeting.id}`, page.url()).href);
        await page.getByText('第 150 条记录').waitFor();

        // The hit is far older than the loaded page; the link carries its id.
        await page.locator('.ss-search-trigger').click();
        await page.getByRole('textbox', { name: '搜索与命令' }).fill('1284 家企业');
        await page.locator('#command-palette').getByText('样本量是 1284').click();
        assert.match(page.url(), new RegExp(`#/meeting/${meeting.id}/${posted[4].id}$`, 'u'));
        await target(posted[4]).waitFor();
        await shot('message-link-search');

        // A second link into the same conversation moves the target.
        await page.evaluate(
          (hash) => (location.hash = hash),
          `#/meeting/${meeting.id}/${posted[39].id}`,
        );
        await target(posted[39]).waitFor();
        assert.equal(await target(posted[4]).count(), 0);
      },
    );
  },
);
