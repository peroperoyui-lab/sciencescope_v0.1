// A person picks 总是允许 on an approval card, later steps of that kind run
// without asking, and the saved rule can be removed in Settings → 运行环境.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  '总是允许 saves a project rule, the next command runs without a card, and Settings can remove the rule',
  { skip: browserSkip },
  async () => {
    const results = [];
    await withBrowserApp(
      'always-allow',
      async function* ({ call }) {
        results.push(await call('shell', { command: 'echo first' }));
        results.push(await call('shell', { command: 'echo second' }));
        yield '两条都跑完了';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        const project = await app.core.projects.create({ name: '识别策略' });
        const meeting = app.core.meetings.create({
          projectId: project.id,
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          policy: { mode: 'direct', respondent: 'agent_main' },
        });
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.getByRole('textbox', { name: '主输入框' }).fill('运行两条命令');
        await page.getByRole('button', { name: '发送', exact: true }).click();

        const answer = page.locator('.ss-msg:not([data-user])').last();
        const card = answer.getByRole('group', { name: '需要你的批准' });
        await card.getByText('echo first').waitFor();
        await card.getByRole('button', { name: '总是允许' }).click();
        await shot('always-allow-menu');
        await page.getByRole('menuitem', { name: '以 echo 开头的命令' }).click();

        // The second command matches the rule: no card, it just runs.
        await answer.getByText('两条都跑完了').waitFor();
        assert.match(results[1].output, /second/);
        const activity = answer.locator('[data-turn-activity]');
        await activity.locator('.ss-act__summary').click();
        await activity.locator('[data-activity="group"]').click();
        const rows = activity.locator('[data-tool-call]');
        await rows.nth(0).click();
        await activity.getByText(/总是允许了这类操作/).waitFor();
        await rows.nth(1).click();
        await activity.getByText('按规则自动允许').waitFor();

        await page.goto(new URL('/?token=ui-token#/settings/approvals', page.url()).href);
        const section = page.locator('[data-settings="approval-rules"]');
        const rule = section.locator('[data-rule]');
        await rule.waitFor();
        assert.match(await section.textContent(), /识别策略.*运行命令 · 以 echo 开头的命令/);
        await shot('always-allow-settings');
        await rule.hover();
        await rule.getByRole('button', { name: '删除这条规则' }).click();
        await section.getByText('还没有规则。').waitFor();
        const saved = await app.core.workspace.read({ resource: 'settings', key: 'app' });
        assert.deepEqual(saved.value.approvals.rules, []);
      },
    );
  },
);
