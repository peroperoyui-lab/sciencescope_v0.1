// A person watches an answer go through the model's phases: a retried
// request, then thinking, then a partial answer that fails. The status line
// follows the phase, the timeline keeps the retry and the thinking, and the
// partial answer stays visible next to the reason it stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

/** A promise the test resolves to let the scripted model continue. */
function gate() {
  let open = () => {};
  const opened = new Promise((resolve) => {
    open = () => resolve(undefined);
  });
  return { open, opened };
}

test(
  'phases, thinking and retries show while answering and a failed answer keeps its text and reason',
  { skip: browserSkip },
  async () => {
    const afterRetry = gate();
    const afterThinking = gate();
    await withBrowserApp(
      'p1a-activity',
      async function* () {
        yield { type: 'phase', phase: 'retrying' };
        yield {
          type: 'retry',
          attempt: 2,
          maxAttempts: 3,
          error: '连不上 example.com，请检查网络或代理。',
          delayMs: 0,
        };
        await afterRetry.opened;
        yield { type: 'phase', phase: 'thinking' };
        yield { type: 'thinking-delta', delta: '先看看现有的计划。' };
        await afterThinking.opened;
        yield '先读了一半';
        yield { stop: 'failed', error: '服务暂时不可用（HTTP 502），已尝试 3 次。' };
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
        await page.getByRole('textbox', { name: '主输入框' }).fill('请看看计划');
        await page.getByRole('button', { name: '发送', exact: true }).click();

        const answer = page.locator('.ss-msg:not([data-user])').last();
        const status = answer.locator('.ss-status');
        await answer.locator('.ss-status--wait', { hasText: '正在重试（第 2/3 次）' }).waitFor();
        await answer
          .locator('[data-activity="retry"]', { hasText: '连不上 example.com' })
          .waitFor();
        afterRetry.open();
        await status.filter({ hasText: '正在思考' }).waitFor();
        await answer.locator('[data-activity="thinking"] .ss-spin').waitFor();
        await shot('p1a-thinking');
        afterThinking.open();

        await answer.locator('.ss-status--fail', { hasText: 'HTTP 502' }).waitFor();
        assert.equal((await answer.locator('.ss-msg__body').textContent()).trim(), '先读了一半');
        const activity = answer.locator('[data-turn-activity]');
        assert.match(
          await activity.locator('.ss-act__summary').textContent(),
          /已思考 · 重试 1 次/,
        );
        await activity.locator('.ss-act__summary').click();
        const thinking = activity.locator('[data-activity="thinking"]');
        assert.match(await thinking.textContent(), /思考了/);
        await thinking.click();
        assert.equal(
          await activity.locator('.ss-act__thinking').textContent(),
          '先看看现有的计划。',
        );
        await shot('p1a-failed');
      },
    );
  },
);

test(
  'in 请求批准 mode a command waits for the person, a rejection reaches the model and 常规 runs without asking',
  { skip: browserSkip },
  async () => {
    const results = [];
    await withBrowserApp(
      'p1b-approval',
      async function* ({ call }) {
        results.push(await call('shell', { command: 'echo first' }));
        results.push(await call('shell', { command: 'echo second' }));
        yield { type: 'compaction', beforeTokens: 123000, afterTokens: 18000 };
        yield '处理完了';
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
        const mode = page.getByRole('button', { name: '执行方式', exact: true });
        assert.match(await mode.textContent(), /请求批准/);
        await page.getByRole('textbox', { name: '主输入框' }).fill('运行两条命令');
        await page.getByRole('button', { name: '发送', exact: true }).click();

        const answer = page.locator('.ss-msg:not([data-user])').last();
        const card = answer.getByRole('group', { name: '需要你的批准' });
        await card.getByText('echo first').waitFor();
        await answer.locator('.ss-status--wait', { hasText: '等待你的批准' }).waitFor();
        await shot('p1b-approval');
        await card.getByRole('button', { name: '拒绝', exact: true }).click();
        await answer.locator('[data-activity="approval"][data-status="rejected"]').waitFor();
        await card.getByText('echo second').waitFor();
        await card.getByRole('button', { name: '允许', exact: true }).click();

        await answer.getByText('处理完了').waitFor();
        assert.equal(results[0].rejected, true);
        assert.match(results[1].output, /second/);
        const activity = answer.locator('[data-turn-activity]');
        await activity.locator('.ss-act__summary').click();
        assert.match(
          await activity.locator('[data-activity="compaction"]').textContent(),
          /上下文已自动压缩.*12 万 → 1\.8 万 token/,
        );
        assert.match(await activity.locator('[data-tool-call]').first().textContent(), /已拒绝/);
        await shot('p1b-decided');

        await mode.click();
        await page.getByRole('menuitemradio', { name: '常规', exact: true }).click();
        await page.waitForFunction(async (id) => {
          const response = await fetch(`/api/meetings/${id}`, {
            headers: { authorization: 'Bearer ui-token' },
          });
          return (await response.json()).policy.approval === 'auto';
        }, meeting.id);
      },
    );
  },
);
