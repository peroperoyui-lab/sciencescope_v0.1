import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'messages queue while Main answers, remain editable, and stopping sends the remaining queue',
  { skip: browserSkip },
  async () => {
    let began = () => {};
    let release = () => {};
    const started = new Promise((resolve) => {
      began = () => resolve(undefined);
    });
    const held = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    let requests = 0;
    await withBrowserApp(
      'r411-outbox',
      async function* () {
        requests++;
        if (requests === 1) {
          yield '第一轮正在回答';
          began();
          await held;
        } else yield '处理了剩余排队消息';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        const meeting = app.core.meetings.create({
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          policy: { mode: 'direct', respondent: 'agent_main' },
        });
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        const input = page.getByRole('textbox', { name: '主输入框' });
        const send = async (text) => {
          await input.fill(text);
          await page.getByRole('button', { name: '发送', exact: true }).click();
        };
        try {
          await send('第一条问题');
          await started;
          await page.getByRole('button', { name: '停止', exact: true }).waitFor();
          await send('第二条问题');
          await page.locator('.outbox__item', { hasText: '第二条问题' }).waitFor();
          await send('第三条问题');
          const second = page.locator('.outbox__item', { hasText: '第二条问题' });
          await second.getByRole('button', { name: '编辑', exact: true }).click();
          await page.locator('#modal input').fill('第二条问题修订');
          await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
          await page.locator('.outbox__item', { hasText: '第二条问题修订' }).waitFor();
          await page
            .locator('.outbox__item', { hasText: '第三条问题' })
            .getByRole('button', { name: '取消待发消息' })
            .click();
          await page
            .locator('.outbox__item', { hasText: '第三条问题' })
            .waitFor({ state: 'detached' });
          assert.equal(
            app.core.messages
              .since(meeting.id, 0)
              .filter((message) => message.authorId === 'person_user').length,
            1,
          );
          await shot('r4-11b-outbox');
          await page.getByRole('button', { name: '停止', exact: true }).click();
          release();
          await page.getByText('处理了剩余排队消息', { exact: true }).waitFor();
          assert.deepEqual(
            app.core.messages
              .since(meeting.id, 0)
              .filter((message) => message.authorId === 'person_user')
              .map((message) => message.text),
            ['第一条问题', '第二条问题修订'],
          );
          assert.equal(app.core.outbox.list(meeting.id).items.length, 0);
          assert.equal(requests, 2);
        } finally {
          release();
        }
      },
    );
  },
);
