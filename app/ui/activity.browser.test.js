// A person watches an answer go through the model's phases: a retried
// request, then thinking, then a partial answer that fails. The status line
// follows the phase, the timeline keeps the retry and the thinking, and the
// partial answer stays visible next to the reason it stopped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp, eventually } from './browser-testing.js';

let imageFolder = '';

/** A small bar chart for the scripted model to look at. */
async function figure() {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(480, 240);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 480, 240);
  context.fillStyle = '#3f7d5a';
  [120, 180, 90, 150, 200].forEach((height, index) =>
    context.fillRect(40 + index * 85, 220 - height, 50, height),
  );
  return canvas.encode('png');
}

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
        // Two commands in a row share one row; the second waits under it.
        await card.getByText('echo second').waitFor();
        assert.match(
          await answer.locator('[data-activity="group"]').textContent(),
          /正在运行命令|等待批准/,
        );
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
        const group = activity.locator('[data-activity="group"][data-count="2"]');
        assert.match(await group.textContent(), /运行了 2 条命令.*1 个已拒绝/);
        await group.click();
        const first = activity.locator('[data-tool-call]').first();
        assert.equal(await first.getAttribute('data-approval'), 'rejected');
        assert.match(await first.textContent(), /已拒绝/);
        // The decision is the step's status, not a row of its own.
        assert.equal(await activity.locator('[data-activity="approval"]').count(), 0);
        await shot('p1b-decided');

        await mode.click();
        await page.getByRole('menuitemradio', { name: '常规', exact: true }).click();
        await eventually(() =>
          page.evaluate(async (id) => {
            const response = await fetch(`/api/meetings/${id}`, {
              headers: { authorization: 'Bearer ui-token' },
            });
            return (await response.json()).policy.approval === 'auto';
          }, meeting.id),
        );
      },
    );
  },
);

test(
  'the compact activity view still shows a card waiting for approval',
  { skip: browserSkip },
  async () => {
    await withBrowserApp(
      'compact-approval',
      async function* ({ call }) {
        await call('shell', { command: 'echo compact' });
        yield '好了';
      },
      async ({ page, app }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              models: { default: { provider: 'scripted', model: 'scripted' } },
              appearance: { transcript: 'compact' },
            },
          },
        });
        const meeting = app.core.meetings.create({
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          policy: { mode: 'direct', respondent: 'agent_main' },
        });
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.getByRole('textbox', { name: '主输入框' }).fill('运行一条命令');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        const answer = page.locator('.ss-msg:not([data-user])').last();
        const card = answer.getByRole('group', { name: '需要你的批准' });
        await card.getByText('echo compact').waitFor();
        // Other rows stay folded away in the compact view.
        assert.equal(await answer.locator('[data-tool-call]').isVisible(), false);
        await card.getByRole('button', { name: '允许', exact: true }).click();
        await answer.getByText('好了').waitFor();
        assert.equal(await answer.locator('[data-turn-activity]').isVisible(), false);
      },
    );
  },
);

test(
  'a viewed image shows in its step, and a queued message can be inserted into the running answer',
  { skip: browserSkip },
  async () => {
    const queued = gate();
    let steered = [];
    await withBrowserApp(
      'view-image-steer',
      async function* ({ call, steered: inserted }) {
        await call('view_image', { path: path.join(imageFolder, 'figure.png') });
        yield '先看了图。';
        await queued.opened;
        steered = inserted.map((entry) => entry.input);
        yield '按新的要求继续。';
      },
      async ({ page, app, shot }) => {
        imageFolder = app.core.paths.root;
        await writeFile(path.join(imageFolder, 'figure.png'), await figure());
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        const meeting = app.core.meetings.create({
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          policy: { mode: 'direct', respondent: 'agent_main', approval: 'auto' },
        });
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        const box = page.getByRole('textbox', { name: '主输入框' });
        await box.fill('看看这张图');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        const answer = page.locator('.ss-msg:not([data-user])').last();
        await answer.getByText('先看了图。').waitFor();

        const row = answer.locator('[data-tool-call]').filter({ hasText: '查看图片' });
        assert.match(await row.textContent(), /查看图片.*figure\.png/);
        await row.click();
        const image = answer.locator('[data-viewed-image] img');
        await image.waitFor();
        await page.waitForFunction(
          (element) => element.naturalWidth > 0,
          await image.elementHandle(),
        );
        await shot('view-image');

        await box.fill('只看 2020 年以后的样本');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        const item = page.locator('[data-outbox-id]');
        await item.waitFor();
        await shot('steer-queued');
        await item.getByRole('button', { name: '现在插入' }).click();
        await item.waitFor({ state: 'detached' });
        queued.open();
        await answer.getByText('按新的要求继续。').waitFor();
        assert.deepEqual(steered.length, 1);
        assert.match(steered[0], /2020/);
        // The inserted message sits before the answer that read it.
        const users = page.locator('.ss-msg[data-user]');
        assert.match(await users.last().textContent(), /回答进行中插入.*只看 2020 年以后的样本/);
        const order = await page
          .locator('.ss-msg')
          .evaluateAll((messages) =>
            messages.map((entry) => (entry.hasAttribute('data-user') ? 'user' : 'ai')),
          );
        assert.deepEqual(order, ['user', 'user', 'ai']);
        await shot('steer-inserted');
      },
    );
  },
);
