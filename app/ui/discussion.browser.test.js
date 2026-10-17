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

async function prepare(page, app) {
  await app.core.workspace.edit({
    resource: 'settings',
    key: 'app',
    op: 'patch',
    args: {
      changes: {
        providers: [
          { id: 'scripted', name: 'Scripted', models: [{ id: 'scripted', contextWindow: 100000 }] },
        ],
        models: { default: { provider: 'scripted', model: 'scripted' } },
      },
    },
  });
  await app.core.participants.updateDefinition('agent_reviewer', { enabled: true });
  const meeting = app.core.meetings.create({
    title: '有序讨论验收',
    members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
  });
  await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
  await page.locator('.ss-composer textarea').waitFor();
  return meeting;
}

async function chooseRound(page) {
  await page.locator('[data-v="mode-menu"]').click();
  await page.getByRole('menuitemradio', { name: '有序讨论', exact: true }).click();
  await page.locator('[data-discussion-strip]').waitFor();
  const redTeam = page.locator('[data-panel-toggle="agent_red_team"]');
  if ((await redTeam.getAttribute('aria-pressed')) === 'true') await redTeam.click();
  await page.getByRole('button', { name: '审核专家', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '独立审核人', exact: true }).click();
}

async function workMode(page) {
  await page.locator('[data-v="mode-menu"]').click();
  await page.getByRole('menuitemradio', { name: '工作', exact: true }).click();
  await page.locator('[data-discussion-strip]').waitFor({ state: 'detached' });
}

test(
  'ordered discussion UI preserves panel choices, streams expert states, adopts review and invites through keyboard without sending',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    const releaseAnswers = gate();
    const twoStarted = gate();
    const waitingStarted = gate();
    const releaseWaiting = gate();
    const toolStarted = gate();
    const releaseTool = gate();
    let expertStarts = 0;
    try {
      await withBrowserApp(
        'r4-3b-discussion',
        async function* ({ instructions, call, input }) {
          if (instructions.includes('你是本轮审核专家')) {
            yield '审核结论：两个方案均需补充识别依据。';
            return;
          }
          if (input.includes('完整讨论问题')) {
            expertStarts++;
            if (expertStarts === 2) twoStarted.resolve();
            await releaseAnswers.promise;
            if (instructions.includes('你是：方法学家')) {
              yield '先查看项目与会议。';
              await call('workspace_read', { target: 'plans', key: 'global' });
              yield '方法学结论：采用自然实验。';
            } else yield '统计结论：报告置信区间。';
          } else yield '邀请专家回答完成。';
        },
        async ({ page, app, shot }) => {
          try {
            const meeting = await prepare(page, app);
            const originalStart = app.runtime.startSession;
            let starts = 0;
            app.runtime.startSession = async (options) => {
              starts++;
              if (starts === 2) {
                waitingStarted.resolve();
                await releaseWaiting.promise;
              }
              return originalStart(options);
            };
            // Hold one real tool response so its running card is observable.
            const originalRead = app.core.workspace.read;
            app.core.workspace.read = async (target) => {
              if (target.resource === 'plans' && target.key === 'global') {
                toolStarted.resolve();
                await releaseTool.promise;
              }
              return originalRead(target);
            };
            await chooseRound(page);
            await page.reload();
            await page.locator('[data-discussion-strip]').waitFor();
            assert.equal(
              await page
                .locator('[data-panel-toggle="agent_methodologist"]')
                .getAttribute('aria-pressed'),
              'true',
            );
            assert.equal(
              await page
                .locator('[data-panel-toggle="agent_red_team"]')
                .getAttribute('aria-pressed'),
              'false',
            );
            assert.equal(app.core.meetings.get(meeting.id).policy.reviewer, 'agent_reviewer');
            const textarea = page.locator('.ss-composer textarea');
            await textarea.fill('完整讨论问题');
            await page.getByRole('button', { name: '发送', exact: true }).click();
            await waitingStarted.promise;
            await page.locator('.expert-state[data-state="waiting"]').waitFor();
            releaseWaiting.resolve();
            await twoStarted.promise;
            await page.locator('.expert-state[data-state="running"]').first().waitFor();
            assert.equal(await page.locator('[data-expert]').count(), 2);
            assert.equal(await page.locator('[data-review]').count(), 0);
            const authors = await page.locator('[data-expert] .ss-msg__head').allTextContents();
            assert.match(authors[0], /方法学家[\s\S]*研究设计/u);
            assert.match(authors[1], /统计审稿人[\s\S]*统计与数据/u);
            releaseAnswers.resolve();
            await toolStarted.promise;
            await page.locator('.expert-state[data-state="tool"]').waitFor();
            // While the answer runs its tool activity stays open.
            const activity = page.locator('[data-expert] [data-turn-activity]').first();
            await activity.locator('.ss-act__row .ss-spin').waitFor();
            assert.equal(await activity.locator('.ss-act__summary').count(), 0);
            releaseTool.resolve();
            await page.locator('[data-review] .expert-state[data-state="done"]').waitFor();
            // When it ends the card folds into one line.
            await page
              .locator('[data-expert] [data-turn-activity]:not([data-running])')
              .first()
              .waitFor();
            assert.match(await activity.locator('.ss-act__summary').textContent(), /1 个步骤/);
            assert.equal(await activity.locator('.ss-act__list').count(), 0);
            await page.locator('[data-review-adopt]').click();
            await page.locator('[data-review-adopt][aria-pressed="true"]').waitFor();
            await page.locator('[data-usage="main"]').click();
            await page.locator('[data-usage-pop]').waitFor();
            assert.match(await page.locator('[data-usage-pop]').innerText(), /方法学家/u);
            assert.match(await page.locator('[data-usage-pop]').innerText(), /统计审稿人/u);
            await page.keyboard.press('Escape');
            await workMode(page);
            const before = app.core.messages.since(meeting.id, 0).length;
            await textarea.fill('@');
            await page.locator('[role="listbox"]').waitFor();
            assert.doesNotMatch(await page.locator('[role="listbox"]').innerText(), /独立审核人/u);
            await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
            assert.equal(app.core.messages.since(meeting.id, 0).length, before);
            assert.match(await textarea.inputValue(), /^@[^\s]+ /u);
            await textarea.fill('@');
            await page.keyboard.press('Tab');
            assert.equal(app.core.messages.since(meeting.id, 0).length, before);
            await textarea.fill('@');
            await page.locator('[role="listbox"]').waitFor();
            await page.keyboard.press('Escape');
            await page.locator('[role="listbox"]').waitFor({ state: 'detached' });
            assert.equal(await textarea.inputValue(), '@');
            await textarea.fill('前文 @后文');
            await textarea.evaluate((element) => {
              element.setSelectionRange(4, 4);
              element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            await page.locator('[data-mention="agent_methodologist"]').click();
            await page.waitForFunction(
              () =>
                /** @type {HTMLTextAreaElement} */ (document.querySelector('.ss-composer textarea'))
                  .value === '前文 @方法学家 后文',
            );
            assert.equal(await textarea.inputValue(), '前文 @方法学家 后文');
            assert.equal(app.core.messages.since(meeting.id, 0).length, before);
            await textarea.fill('输入法内容');
            await textarea.dispatchEvent('keydown', {
              key: 'Enter',
              isComposing: true,
              bubbles: true,
            });
            assert.equal(app.core.messages.since(meeting.id, 0).length, before);
            await textarea.fill('@方法');
            await page.locator('[role="option"]').first().click();
            await textarea.press('End');
            await textarea.pressSequentially('请检查识别条件');
            await page.getByRole('button', { name: '发送', exact: true }).click();
            await app.conductor.idle();
            await page.locator('[data-expert]').last().getByText('邀请专家回答完成。').waitFor();
            assert.equal(
              app.core.messages.since(meeting.id, 0).at(-1).authorId,
              'agent_methodologist',
            );
            await textarea.fill('主专家继续推进');
            await page.getByRole('button', { name: '发送', exact: true }).click();
            await app.conductor.idle();
            await page.locator('[data-review-adopt]:disabled').waitFor();
            await page.getByRole('button', { name: '视图', exact: true }).click();
            await page.getByRole('menuitemcheckbox', { name: 'English' }).click();
            await page.locator('.expert-state', { hasText: 'Completed' }).first().waitFor();
            assert.doesNotMatch(
              await page.locator('.review-adopt').innerText(),
              /审核|后续上下文/u,
            );
            await shot('ordered-discussion-en');
          } finally {
            releaseWaiting.resolve();
            releaseAnswers.resolve();
            releaseTool.resolve();
          }
        },
      );
    } finally {
      releaseWaiting.resolve();
      releaseAnswers.resolve();
      releaseTool.resolve();
    }
  },
);

test(
  'expert answer continuation remains targeted and stop cancels the whole panel before review',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let invocations = 0;
    await withBrowserApp(
      'r4-3b-continue-stop',
      async function* ({ instructions, signal, input }) {
        invocations++;
        if (input.includes('停止这轮')) {
          yield '正在分析';
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
          return;
        }
        if (instructions.includes('你是：方法学家')) {
          yield '方法学未完成片段';
          yield { stop: 'max_tokens' };
        } else yield '统计专家完整回答';
      },
      async ({ page, app }) => {
        const meeting = await prepare(page, app);
        await chooseRound(page);
        const textarea = page.locator('.ss-composer textarea');
        await textarea.fill('让两位专家回答');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page
          .locator('[data-expert]')
          .getByRole('button', { name: '继续', exact: true })
          .waitFor();
        await app.conductor.idle();
        const before = invocations;
        await page
          .locator('[data-expert]')
          .getByRole('button', { name: '继续', exact: true })
          .click();
        await page.locator('[data-expert]').nth(3).waitFor();
        await app.conductor.idle();
        assert.equal(invocations, before + 1);
        assert.equal(app.core.messages.since(meeting.id, 0).at(-1).authorId, 'agent_methodologist');
        assert.equal(
          app.core.messages
            .since(meeting.id, 0)
            .filter((message) => message.authorId === 'person_user').length,
          1,
        );
        await textarea.fill('停止这轮');
        await page.getByRole('button', { name: '发送', exact: true }).click();
        await page
          .locator('[data-expert][data-streaming="true"]')
          .first()
          .getByText('正在分析')
          .waitFor();
        await page.getByRole('button', { name: '停止', exact: true }).click();
        await app.conductor.idle();
        await page.locator('.expert-state[data-state="failed"]').last().waitFor();
        assert.equal(app.core.turns.running().length, 0);
        assert.equal(
          app.core.messages
            .since(meeting.id, 0)
            .filter((message) => message.refs?.discussion?.kind === 'review').length,
          1,
        );
        assert.equal(
          app.core.messages
            .since(meeting.id, 0)
            .slice(-2)
            .every((message) => message.status === 'cancelled'),
          true,
        );
      },
    );
  },
);

test(
  'the discussion roster supports more than eight experts and context rows fall back to the catalog window',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    await withBrowserApp(
      'r4-3b-roster-context',
      async function* () {
        yield 'Expert answer';
      },
      async ({ page, app }) => {
        const meeting = await prepare(page, app);
        for (let index = 0; index < 6; index++)
          await app.core.participants.create({
            id: 'agent_extra_' + index,
            kind: 'ai',
            name: '附加专家' + index,
            definition: {
              panel: 'expert',
              enabled: true,
              position: index + 10,
              role: '附加研究职责',
              prompt: 'Academic expert',
            },
          });
        await page.reload();
        await page.locator('[data-v="mode-menu"]').click();
        await page.getByRole('menuitemradio', { name: '有序讨论', exact: true }).click();
        await page.locator('[data-panel-toggle="agent_extra_5"]').waitFor();
        assert.equal(await page.locator('[data-panel-toggle]').count(), 9);
        assert.equal(await page.locator('[data-panel-toggle][aria-pressed="true"]').count(), 9);
        for (const participant of ['agent_main', 'agent_extra_5']) {
          const turn = app.core.turns.start({ meetingId: meeting.id, participantId: participant });
          app.core.messages.post({
            meetingId: meeting.id,
            authorId: participant,
            turnId: turn.id,
            text: 'Context measurement fixture',
          });
          app.core.turns.end(turn.id, {
            status: 'done',
            usage: { context: { usedTokens: 4321, contextWindow: null, estimated: true } },
          });
        }
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              providers: [{ id: 'scripted', name: 'Scripted', models: [{ id: 'scripted' }] }],
            },
          },
        });
        await page.locator('[data-usage="main"]').click();
        const row = page.locator('[data-context-participant="agent_extra_5"]');
        await row.waitFor();
        // The turn reported no window; the catalog's default (131,072) is what compaction uses.
        await row.getByText('4321 / 13 万 token', { exact: true }).waitFor();
        assert.doesNotMatch(await row.innerText(), /NaN|Infinity|100%/u);
        assert.equal(
          await page.locator('[data-usage="main"]').getAttribute('data-context-known'),
          'true',
        );
        await page.reload();
        await page.locator('[data-panel-toggle="agent_extra_5"][aria-pressed="true"]').waitFor();
        await page.goto(new URL('/?token=ui-token#/settings/experts', page.url()).href);
        await page.getByRole('button', { name: '添加专家', exact: true }).waitFor();
        await page.getByRole('button', { name: '添加专家', exact: true }).click();
        await page
          .locator('.expert-card')
          .filter({ hasText: '新专家' })
          .locator('input:not([type="checkbox"])')
          .first()
          .fill('第十位专家');
        await page.getByRole('button', { name: '保存名册', exact: true }).click();
        await page.getByText('名册已保存。', { exact: true }).waitFor();
        await page.reload();
        await page.locator('.expert-card', { hasText: '第十位专家' }).waitFor();
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.locator('[data-panel-toggle]').nth(9).waitFor();
        assert.equal(await page.locator('[data-panel-toggle]').count(), 10);
      },
    );
  },
);
