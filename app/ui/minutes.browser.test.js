// R4-4a: real host, scripted secretary, minutes editing and persisted rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'minutes can be edited and refreshed, and secretary rules persist in both languages',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    const inputs = [];
    await withBrowserApp(
      'r4-4a-minutes',
      async function* ({ input }) {
        inputs.push(input);
        yield '# Research goal\n\nPreserve the user edit.\n\n## Next steps\n\nCompare the new evidence.';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              providers: [{ id: 'scripted', name: 'Scripted', models: [{ id: 'scripted' }] }],
              models: { default: { provider: 'scripted', model: 'scripted' } },
              summary: {
                afterDiscussion: false,
                everyMessages: { enabled: false, n: 20 },
                everyTokens: { enabled: false, n: 30000 },
                onEnterProject: false,
                onLeaveProject: false,
                saveMarkdown: false,
                workbench: { map: 'off', plans: 'off', log: 'off' },
              },
            },
          },
        });
        const project = await app.core.projects.create({ name: 'Minutes project' });
        const meeting = await app.core.meetings.create({
          projectId: project.id,
          title: 'Minutes meeting',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          policy: { mode: 'direct' },
        });
        const first = app.core.messages.post({
          meetingId: meeting.id,
          authorId: 'agent_main',
          text: 'First research evidence.',
        });
        const api = async (route, body) => {
          const response = await fetch(new URL(route, page.url()), {
            method: body === undefined ? 'GET' : 'POST',
            headers: { authorization: 'Bearer ui-token', 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          const value = await response.json();
          assert.equal(response.ok, true, JSON.stringify(value));
          return value;
        };
        await api('/api/meetings/' + meeting.id + '/minutes/refresh', {});
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.locator('.composer textarea').waitFor();
        await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
        await page.getByRole('menuitem', { name: '对话纪要', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '对话纪要', exact: true });
        await dialog.getByRole('heading', { name: 'Research goal', exact: true }).waitFor();
        await dialog.getByRole('button', { name: '编辑', exact: true }).click();
        await dialog
          .getByLabel('纪要内容')
          .fill('# User edit\n\nKeep the agreed identification strategy.');
        await dialog.getByRole('button', { name: '保存纪要', exact: true }).click();
        await dialog.getByRole('heading', { name: 'User edit', exact: true }).waitFor();
        const edited = await api('/api/meetings/' + meeting.id + '/minutes');
        assert.match(edited.text, /Keep the agreed identification strategy/u);
        assert.equal(edited.throughSeq, first.seq);
        assert.match(await dialog.locator('[data-minutes-meta]').innerText(), /由你编辑/u);
        app.core.messages.post({
          meetingId: meeting.id,
          authorId: 'agent_main',
          text: 'New evidence after the edit.',
        });
        await dialog.getByRole('button', { name: '让秘书更新', exact: true }).click();
        await dialog.getByRole('heading', { name: 'Research goal', exact: true }).waitFor();
        assert.match(inputs.at(-1), /Keep the agreed identification strategy/u);
        assert.match(inputs.at(-1), /New evidence after the edit/u);
        const refreshed = await api('/api/meetings/' + meeting.id + '/minutes');
        assert.notEqual(refreshed.revision, edited.revision);
        assert.ok(refreshed.throughSeq > edited.throughSeq);
        await page
          .locator('.modal')
          .evaluate((element) =>
            Promise.all(
              element.getAnimations().map((animation) => animation.finished.catch(() => {})),
            ),
          );
        await shot('r4-4a-minutes-zh');
        await dialog.locator('[data-minutes-close]').click();

        await page.goto(new URL('/?token=ui-token#/settings/secretary-settings', page.url()).href);
        const form = page.locator('[data-summary-settings]');
        await form.getByLabel('有序讨论结束后', { exact: true }).check();
        await form.getByLabel('按消息数自动总结').check();
        await form.getByLabel('主对话消息间隔').fill('7');
        await form.getByLabel('主对话消息间隔').press('Tab');
        await form.getByLabel('按 token 数自动总结').check();
        await form.getByLabel('新 token 间隔').fill('8000');
        await form.getByLabel('新 token 间隔').press('Tab');
        await form.getByLabel('进入项目时', { exact: true }).check();
        await form.getByLabel('离开项目时', { exact: true }).check();
        await form.getByLabel('同时保存为工作文件夹中的 Markdown 文件', { exact: false }).check();
        await form.getByLabel('导图自动更新').selectOption('apply');
        await form.getByLabel('计划自动更新').selectOption('apply');
        await form.getByLabel('日志自动更新').selectOption('apply');
        await form.getByText('自动总结设置已保存。', { exact: true }).waitFor();
        const rules = (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value
          .summary;
        assert.deepEqual(rules, {
          afterDiscussion: true,
          everyMessages: { enabled: true, n: 7 },
          everyTokens: { enabled: true, n: 8000 },
          onEnterProject: true,
          onLeaveProject: true,
          saveMarkdown: true,
          workbench: { map: 'apply', plans: 'apply', log: 'apply', versions: 'off' },
        });
        await page.reload();
        await form.getByLabel('主对话消息间隔').waitFor();
        assert.equal(await form.getByLabel('主对话消息间隔').inputValue(), '7');
        assert.equal(await form.getByLabel('导图自动更新').inputValue(), 'apply');
        assert.equal(await form.locator('option[value="propose"]').count(), 0);
        await form.scrollIntoViewIfNeeded();
        await shot('r4-4a-secretary-rules-zh');
        await page.getByRole('button', { name: '视图', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
        await form.locator('h2', { hasText: 'Automatic summary' }).waitFor();
        assert.doesNotMatch(await form.innerText(), /[一-鿿]/u);
        await shot('r4-4a-secretary-rules-en');
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Conversation minutes', exact: true }).click();
        await page.locator('[data-minutes-meta]', { hasText: 'Covers messages' }).waitFor();
        await page.locator('[data-minutes-next]', { hasText: '7 more messages' }).waitFor();
        assert.doesNotMatch(await page.locator('.minutes-dialog').innerText(), /[一-鿿]/u);
        await page
          .locator('.modal')
          .evaluate((element) =>
            Promise.all(
              element.getAnimations().map((animation) => animation.finished.catch(() => {})),
            ),
          );
        await shot('r4-4a-minutes-en');
      },
    );
  },
);

test(
  'background minutes keep the Main composer available and foreground stop leaves the secretary running',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let releaseSummary = () => {};
    const summaryGate = new Promise((resolve) => {
      releaseSummary = () => resolve(undefined);
    });
    let summaryStarted = () => {};
    const started = new Promise((resolve) => {
      summaryStarted = () => resolve(undefined);
    });
    try {
      await withBrowserApp(
        'r4-4a-concurrent-summary',
        async function* ({ signal, instructions }) {
          if (instructions.includes('You maintain the complete research meeting minutes')) {
            summaryStarted();
            await summaryGate;
            yield '# Concurrent summary\n\nResearch evidence preserved.';
            return;
          }
          yield 'Main is working concurrently.';
          await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        },
        async ({ page, app }) => {
          await app.core.workspace.edit({
            resource: 'settings',
            key: 'app',
            op: 'patch',
            args: {
              changes: {
                providers: [{ id: 'scripted', name: 'Scripted', models: [{ id: 'scripted' }] }],
                models: { default: { provider: 'scripted', model: 'scripted' } },
                summary: {
                  afterDiscussion: false,
                  everyMessages: { enabled: false, n: 20 },
                  everyTokens: { enabled: false, n: 30000 },
                  onEnterProject: false,
                  onLeaveProject: false,
                  saveMarkdown: false,
                  workbench: { map: 'off', plans: 'off', log: 'off' },
                },
              },
            },
          });
          const meeting = app.core.meetings.create({
            title: 'Concurrent secretary',
            members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
          });
          app.core.messages.post({
            meetingId: meeting.id,
            authorId: 'agent_main',
            text: 'Research evidence for summary.',
          });
          await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
          const composer = page.locator('.composer');
          await composer.locator('textarea').waitFor();
          const response = page.evaluate(async (meetingId) => {
            const token = sessionStorage.getItem('sciencescope.token');
            const result = await fetch('/api/meetings/' + meetingId + '/minutes/refresh', {
              method: 'POST',
              headers: { authorization: 'Bearer ' + token },
            });
            return result.json();
          }, meeting.id);
          try {
            await started;
            await page.waitForFunction(() => {
              const button = document.querySelector('.composer [data-main-stop]');
              return !button;
            });
            assert.equal(await composer.locator('[data-main-stop]').count(), 0);
            await composer
              .locator('textarea')
              .fill('Keep Main working while the secretary summarizes.');
            await composer.getByRole('button', { name: '发送', exact: true }).click();
            await page.getByText('Main is working concurrently.', { exact: true }).waitFor();
            await composer.getByRole('button', { name: '停止当前回复', exact: true }).click();
            await app.conductor.idle();
            await composer.getByRole('button', { name: '发送', exact: true }).waitFor();
            const active = app.core.turns.running();
            assert.equal(
              active.some((turn) => turn.participantId === 'agent_main'),
              false,
            );
            assert.equal(
              active.some((turn) => turn.participantId === 'agent_secretary'),
              true,
            );
          } finally {
            releaseSummary();
            await response;
          }
        },
      );
    } finally {
      releaseSummary();
    }
  },
);
