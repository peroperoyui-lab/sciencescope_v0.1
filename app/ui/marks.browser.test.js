import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function selectText(page, selector, text) {
  await page.locator(selector).evaluate((root, needle) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.indexOf(needle);
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error('Selection text absent');
  }, text);
}

test(
  'three marks edit, locate, quote to secretary/assistant and send without losing later drafts',
  { skip: browserSkip },
  async () => {
    const inputs = [];
    await withBrowserApp(
      'marks',
      async function* ({ input }) {
        inputs.push(input);
        yield 'Marks received.';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
        });
        const meeting = app.core.meetings.create({
          title: '标记验收',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        const source = app.core.messages.post({
          meetingId: meeting.id,
          authorId: 'agent_main',
          text: 'First original paragraph.\n\nSecond original paragraph.\n\nThird original paragraph.',
        });
        await page.evaluate((id) => {
          location.hash = '#/meeting/' + id;
        }, meeting.id);
        const selector = `[data-message-id="${source.id}"] .message-text`;
        await page.locator(selector).waitFor();
        for (const [index, text] of [
          'First original',
          'Second original',
          'Third original',
        ].entries()) {
          await selectText(page, selector, text);
          await page.getByLabel('标记备注').fill('Note ' + index);
          await page.getByLabel('标记备注').press('Enter');
          await page.getByRole('button', { name: `标记 ${index + 1}`, exact: true }).waitFor();
          await page.locator('.mark-selection-popover').waitFor({ state: 'detached' });
        }
        await page.getByRole('button', { name: '标记 3', exact: true }).click();
        const pop = page.locator('.marks-popover');
        await pop.getByRole('button', { name: '修改备注', exact: true }).first().click();
        await page.getByLabel('修改标记备注').fill('Edited exact note');
        await pop.getByRole('button', { name: '保存', exact: true }).click();
        await pop.getByText('Edited exact note', { exact: true }).waitFor();
        await shot('marks-list-zh');
        await pop.getByRole('button', { name: '定位', exact: true }).first().click();
        assert.ok(
          await page
            .locator(`[data-message-id="${source.id}"]`)
            .evaluate((node) => node.hasAttribute('data-target')),
        );
        await selectText(page, selector, 'Second original');
        await page.getByRole('button', { name: '引用至任务秘书', exact: true }).click();
        await page.locator('.mark-selection-popover').waitFor({ state: 'detached' });
        const secretary = app.secretary.ensure(meeting.id);
        assert.equal(app.researchInput.draft(secretary.id).marks.length, 1);
        await selectText(page, selector, 'Third original');
        await page.getByRole('button', { name: '引用至全局助手', exact: true }).click();
        await page.locator('.mark-selection-popover').waitFor({ state: 'detached' });
        assert.equal(app.researchInput.draft(app.assistant.ensure().id).marks.length, 1);
        await page.getByLabel('主输入框').fill('Explain these three selections');
        await page
          .locator('[data-composer="main"]')
          .getByRole('button', { name: '发送', exact: true })
          .click();
        await page.getByText('Marks received.', { exact: true }).waitFor();
        await page.locator('.marks-toggle').waitFor({ state: 'detached' });
        assert.equal((inputs[0].match(/<quote /gu) ?? []).length, 3);
        assert.ok(inputs[0].includes('Edited exact note'));
        assert.match(
          await page.locator('.ss-msg--user [data-input-receipt]').innerText(),
          /标记 3 条/u,
        );
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await page.getByLabel('Add material').waitFor();
        await selectText(page, selector, 'First original');
        await page.getByLabel('Mark note').waitFor();
        await shot('mark-selection-en');
        await page.getByLabel('Mark note').press('Escape');
        await page.locator('.mark-selection-popover').waitFor({ state: 'detached' });
      },
    );
  },
);
