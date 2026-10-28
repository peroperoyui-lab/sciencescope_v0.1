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
        await page.locator('.ss-composer textarea').waitFor();
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
          .locator('#modal .ss-dialog')
          .evaluate((element) =>
            Promise.all(
              element.getAnimations().map((animation) => animation.finished.catch(() => {})),
            ),
          );
        await shot('r4-4a-minutes-zh');
        await dialog.locator('[data-minutes-close]').click();

        await page.goto(new URL('/?token=ui-token#/settings/secretary-settings', page.url()).href);
        const form = page.locator('[data-summary-settings]');
        const choose = async (label, option) => {
          await form.getByRole('button', { name: label, exact: true }).click();
          await page.getByRole('menuitemradio', { name: option, exact: true }).click();
        };
        await form.getByRole('switch', { name: '有序讨论结束后', exact: true }).check();
        await form.getByRole('switch', { name: '按消息数整理', exact: true }).check();
        await choose('消息间隔', '10 条消息');
        await form.getByRole('switch', { name: '按长度整理', exact: true }).check();
        await choose('长度间隔', '约 1 万字');
        await form.getByRole('switch', { name: '进入项目时', exact: true }).check();
        await form.getByRole('switch', { name: '离开项目时', exact: true }).check();
        const updates = page.locator('section', { hasText: '整理纪要时顺便更新' });
        for (const name of ['研究导图', '计划', '日志'])
          await updates
            .getByRole('group', { name: `${name}自动更新`, exact: true })
            .getByRole('button', { name: '直接更新', exact: true })
            .click();
        const expected = {
          afterDiscussion: true,
          everyMessages: { enabled: true, n: 10 },
          everyTokens: { enabled: true, n: 10000 },
          onEnterProject: true,
          onLeaveProject: true,
          workbench: { map: 'apply', plans: 'apply', log: 'apply', versions: 'off' },
        };
        const rules = async () =>
          (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value.summary;
        for (let tries = 0; tries < 50; tries++) {
          if (JSON.stringify(await rules()) === JSON.stringify(expected)) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.deepEqual(await rules(), expected);
        await page.reload();
        await form.getByRole('button', { name: '消息间隔', exact: true }).waitFor();
        assert.equal(
          await form.getByRole('button', { name: '消息间隔', exact: true }).innerText(),
          '10 条消息',
        );
        assert.equal(
          await updates
            .getByRole('group', { name: '研究导图自动更新', exact: true })
            .getByRole('button', { name: '直接更新', exact: true })
            .getAttribute('aria-pressed'),
          'true',
        );
        await form.scrollIntoViewIfNeeded();
        await shot('r4-4a-secretary-rules-zh');
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await form.locator('h3', { hasText: 'When to write minutes' }).waitFor();
        assert.doesNotMatch(await form.innerText(), /[一-鿿]/u);
        await shot('r4-4a-secretary-rules-en');
        await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
        await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Conversation minutes', exact: true }).click();
        await page.locator('[data-minutes-meta]', { hasText: 'Covers messages' }).waitFor();
        await page.locator('[data-minutes-next]', { hasText: '10 more messages' }).waitFor();
        assert.doesNotMatch(await page.locator('.minutes-dialog').innerText(), /[一-鿿]/u);
        await page
          .locator('#modal .ss-dialog')
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
          const composer = page.locator('.ss-composer');
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
              const button = document.querySelector('.ss-composer .ss-send[data-state="running"]');
              return !button;
            });
            assert.equal(await composer.locator('.ss-send[data-state="running"]').count(), 0);
            await composer
              .locator('textarea')
              .fill('Keep Main working while the secretary summarizes.');
            await composer.getByRole('button', { name: '发送', exact: true }).click();
            await page.getByText('Main is working concurrently.', { exact: true }).waitFor();
            await composer.getByRole('button', { name: '停止', exact: true }).click();
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
