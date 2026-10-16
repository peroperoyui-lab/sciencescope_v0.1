import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

function gate() {
  let resolve = () => {};
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

test(
  'automation menu starts a goal, pauses/resumes, shows background activity and completion in both languages',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    const first = gate();
    const releaseFirst = gate();
    const second = gate();
    const releaseSecond = gate();
    try {
      await withBrowserApp(
        'automation-ui',
        async function* ({ inputs, call }) {
          if (inputs.length === 1) {
            first.resolve();
            await releaseFirst.promise;
          } else {
            second.resolve();
            await releaseSecond.promise;
            await call('goal_update', {
              status: 'complete',
              summary: '目标已经完成，统计图已保存。',
            });
          }
          yield '本轮进展已记录。';
        },
        async ({ page, app, shot }) => {
          await app.core.workspace.edit({
            resource: 'settings',
            key: 'app',
            op: 'patch',
            args: {
              changes: {
                providers: [{ id: 'test', name: 'Test', models: [{ id: 'test' }] }],
                models: { default: { provider: 'test', model: 'test' } },
                summary: {
                  everyMessages: { enabled: false },
                  everyTokens: { enabled: false },
                  onEnterProject: false,
                  onLeaveProject: false,
                },
                memory: { enabled: false },
              },
            },
          });
          const project = await app.core.projects.create({ name: '自动化界面测试' });
          const createMeeting = (title) =>
            app.core.meetings.create({
              projectId: project.id,
              title,
              members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
            });
          const meeting = createMeeting('目标会议');
          const other = createMeeting('另一个会议');
          await page.goto(new URL(`/?token=ui-token#/meeting/${meeting.id}`, page.url()).href);
          await page.getByRole('button', { name: '执行方式', exact: true }).click();
          await page.getByRole('menuitemradio', { name: '自动化', exact: true }).click();
          await page.getByLabel('发送目标最多轮数').fill('4');
          await page.getByLabel('主输入框').fill('读取 CSV 并保存统计图');
          await page.getByRole('button', { name: '发送', exact: true }).click();
          await first.promise;
          await page.locator('#execution-state[data-goal-status="running"]').waitFor();
          assert.match(await page.locator('[data-goal-rounds]').innerText(), /1 \/ 4/);
          await page.getByRole('button', { name: '暂停', exact: true }).click();
          await page.locator('#execution-state[data-goal-status="paused"]').waitFor();
          releaseFirst.resolve();
          await app.conductor.idle();
          assert.equal(app.core.goals.get(meeting.id).rounds, 1);
          await shot('goal-paused');
          await page.locator(`[data-object-id="${other.id}"] .tree-name`).click();
          await page
            .locator(`[data-object-id="${meeting.id}"] .chat-activity-badge[data-state="paused"]`)
            .waitFor();
          await page.locator('.background-activity-summary').click();
          await page.getByRole('menuitem', { name: '目标会议 · 已暂停', exact: true }).click();
          await page.getByLabel('目标最多轮数').fill('5');
          await page
            .locator('#execution-state')
            .getByRole('button', { name: '保存', exact: true })
            .click();
          await page.waitForFunction(() =>
            document.querySelector('[data-goal-rounds]')?.textContent.includes('/ 5'),
          );
          await page
            .locator('#execution-state')
            .getByRole('button', { name: '继续', exact: true })
            .click();
          await second.promise;
          await page.locator(`[data-object-id="${other.id}"] .tree-name`).click();
          // The running badge also shows on the open meeting, so wait for the
          // switch itself before the goal is allowed to complete.
          await page.locator(`.tree-row.active[data-object-id="${other.id}"]`).waitFor();
          await page
            .locator(`[data-object-id="${meeting.id}"] .chat-activity-badge[data-state="running"]`)
            .waitFor();
          await shot('goal-background');
          releaseSecond.resolve();
          await app.conductor.idle();
          await page
            .locator(
              `[data-object-id="${meeting.id}"] .chat-activity-badge[data-state="completed"]`,
            )
            .waitFor();
          await page.locator(`[data-object-id="${meeting.id}"] .tree-name`).click();
          await page.locator('#execution-state[data-goal-status="completed"]').waitFor();
          await page
            .locator(`[data-object-id="${meeting.id}"] .chat-activity-badge`)
            .waitFor({ state: 'detached' });
          assert.match(await page.locator('[data-goal-reason]').innerText(), /统计图已保存/);
          await page.locator('#execution-state summary').click();
          assert.match(await page.locator('#execution-state').innerText(), /读取 CSV/);
          await shot('goal-completed');
          await app.core.workspace.edit({
            resource: 'settings',
            key: 'app',
            op: 'patch',
            args: { changes: { appearance: { language: 'en' } } },
          });
          await page.getByRole('button', { name: 'Execution mode', exact: true }).waitFor();
          assert.match(
            await page.locator('#execution-state').innerText(),
            /Automation.*Completed/s,
          );
          await page.getByRole('button', { name: 'Execution mode', exact: true }).click();
          await page.getByRole('menuitemradio', { name: 'Normal', exact: true }).click();
          await shot('goal-english');
          // Ordered discussion disables automation with an explanation in its i tip.
          app.core.meetings.update(other.id, { policy: { mode: 'round' } });
          await page.locator(`[data-object-id="${other.id}"] .tree-name`).click();
          await page.getByRole('button', { name: 'Execution mode', exact: true }).click();
          assert.equal(
            await page.getByRole('menuitemradio', { name: 'Automation', exact: true }).isDisabled(),
            true,
          );
        },
      );
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
    }
  },
);
