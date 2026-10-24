// R4-4c: candidates come from the real two-stage consolidation service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'a person consolidates memories, edits and accepts evidence, rejects selected items, and reads the exact brief',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    let evidence = [];
    await withBrowserApp(
      'r4-4c-memory',
      async function* ({ instructions, input }) {
        if (instructions.includes('[ScienceScope memory extraction]')) {
          yield JSON.stringify({
            candidates: evidence.map((source, index) => ({
              subtype: index === 0 ? 'decision' : 'lesson',
              title: index === 0 ? 'External evidence decision' : 'Rejected lesson ' + index,
              body: source.text,
              evidence: [{ messageId: source.id, quote: source.text }],
            })),
          });
          return;
        }
        if (instructions.includes('[ScienceScope memory verification]')) {
          yield JSON.stringify({
            decisions: JSON.parse(input).candidates.map(({ candidateIndex }) => ({
              candidateIndex,
              supported: true,
              duplicateOf: null,
              rationale: 'The source supports this candidate.',
            })),
          });
          return;
        }
        yield '# Research decisions\n\nCompare external evidence and retain the research strategy.';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: {
            changes: {
              providers: [
                {
                  id: 'scripted',
                  name: 'Scripted',
                  models: [{ id: 'scripted', maxTokens: 1000, contextWindow: 100000 }],
                },
              ],
              models: { default: { provider: 'scripted', model: 'scripted' } },
              summary: {
                afterDiscussion: false,
                everyMessages: { enabled: false, n: 20 },
                everyTokens: { enabled: false, n: 30000 },
                onEnterProject: false,
                onLeaveProject: false,
                workbench: { map: 'off', plans: 'off', log: 'off' },
              },
              memory: { enabled: false, idleMinutes: 10, model: null, tokenLimit: 100000 },
            },
          },
        });
        const project = await app.core.projects.create({ name: 'Memory research' });
        const main = app.core.meetings.create({
          projectId: project.id,
          title: 'Evidence meeting',
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        evidence = [
          app.core.messages.post({
            meetingId: main.id,
            authorId: 'agent_main',
            text: 'An external report finds an association; it does not establish causation.',
            refs: { originTrust: 'external' },
          }),
          app.core.messages.post({
            meetingId: main.id,
            authorId: 'agent_main',
            text: 'One dataset alone cannot establish the conclusion.',
          }),
          app.core.messages.post({
            meetingId: main.id,
            authorId: 'agent_main',
            text: 'Replicate the analysis on a second sample.',
          }),
        ];
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
        await api('/api/meetings/' + main.id + '/minutes/refresh', {});
        const memoryTab = async (name) => {
          await page.locator('[data-rb-tab="memory"]').click();
          // The inbox entry ends with its count.
          await page.getByRole('menuitem', { name: new RegExp(`^${name}( \\d+)?$`) }).click();
        };
        await page.goto(new URL('/?token=ui-token#/meeting/' + main.id, page.url()).href);
        await page.getByRole('button', { name: '工作区菜单', exact: true }).click();
        await page.getByRole('menuitem', { name: '整理这段对话', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '整理这段对话', exact: true });
        await dialog.getByRole('button', { name: '开始整理', exact: true }).click();
        await dialog.getByText('候选已整理，请到收件箱确认。', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: '打开记忆收件箱', exact: true }).click();
        await page.locator('[data-memory-view="inbox"]').waitFor();
        await page.locator('[data-rb-proposal]').nth(2).waitFor();
        await page.locator('[data-rb-inbox-count]', { hasText: '3' }).waitFor();
        const external = page.locator('[data-rb-proposal]', {
          hasText: 'External evidence decision',
        });
        await external.locator('[data-rb-external]').waitFor();
        await shot('r4-4c-memory-inbox-zh');
        await external.getByRole('button', { name: '定位到消息', exact: true }).click();
        await page.locator('[data-message-id="' + evidence[0].id + '"][data-target]').waitFor();
        await page.locator('.ss-sidebar [data-route="database"]').click();
        await memoryTab('记忆收件箱');
        await external.getByRole('button', { name: '修改后接受', exact: true }).click();
        await external.getByLabel('标题', { exact: true }).fill('Confirmed external association');
        await external
          .getByLabel('内容', { exact: true })
          .fill('Use the external association as evidence; causation remains unproven.');
        await external.getByRole('button', { name: '修改后接受', exact: true }).click();
        await external.waitFor({ state: 'detached' });
        const pending = page.locator('[data-rb-proposal]');
        await pending.nth(1).waitFor();
        await pending.nth(0).getByRole('checkbox').check();
        await pending.nth(1).getByRole('checkbox').check();
        await page.getByRole('button', { name: '拒绝所选', exact: true }).click();
        await page.locator('[data-rb-proposal]').first().waitFor({ state: 'detached' });
        await memoryTab('项目简报');
        await page
          .locator('[data-rb-brief-text]', { hasText: 'Confirmed external association' })
          .waitFor();
        const brief = await api('/api/memory/brief?projectId=' + project.id);
        assert.equal(await page.locator('[data-rb-brief-text]').textContent(), brief.text);
        assert.doesNotMatch(brief.text, /Rejected lesson/u);
        await shot('r4-4c-memory-brief-zh');
        await memoryTab('记忆');
        const active = page.locator('[data-rb-item]', {
          hasText: 'Confirmed external association',
        });
        await active.locator('[data-rb-external]').waitFor();
        await active.getByRole('button', { name: '修订历史', exact: true }).click();
        const history = page.getByRole('dialog', { name: '修订历史', exact: true });
        await history.getByRole('button', { name: '撤销', exact: true }).first().click();
        await history.getByRole('button', { name: '已撤销', exact: true }).first().waitFor();
        await history.getByRole('button', { name: '关闭', exact: true }).click();
        await memoryTab('记忆收件箱');
        const restored = page.locator('[data-rb-proposal]', {
          hasText: 'External evidence decision',
        });
        await restored.waitFor();
        await restored.getByRole('button', { name: '接受', exact: true }).click();
        await restored.waitFor({ state: 'detached' });
        await memoryTab('项目简报');
        await page
          .locator('[data-rb-brief-text]', { hasText: 'External evidence decision' })
          .waitFor();
        await page.getByRole('button', { name: '视图', exact: true }).click();
        await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
        await page.locator('[data-rb-tab="memory"]', { hasText: 'Project brief' }).waitFor();
        const interfaceText = await page.locator('.research-base').evaluate((element) => {
          const copy = element.cloneNode(true);
          /** @type {Element} */ (copy).querySelector('[data-rb-brief-text]')?.remove();
          return copy.textContent;
        });
        assert.doesNotMatch(interfaceText, /[一-鿿]/u);
        await shot('r4-4c-memory-brief-en');
        await page.goto(new URL('/?token=ui-token#/workbench/' + project.id, page.url()).href);
        await page.locator('.wb-left [data-drop="version"]').waitFor();
        // Memory revisions remain in the item's own history; the workbench now
        // shows manuscript versions; editable-file history has its own buttons.
        assert.equal(
          await page.locator('.versionlist .listrow', { hasText: 'Added memory' }).count(),
          0,
        );
        assert.equal(
          await page.locator('.versionlist .listrow', { hasText: 'Updated memory' }).count(),
          0,
        );
        await page.goto(new URL('/?token=ui-token#/settings/secretary-settings', page.url()).href);
        const form = page.locator('[data-memory-consolidation-settings]');
        const choose = async (label, option) => {
          await form.getByRole('button', { name: label, exact: true }).click();
          await page.getByRole('menuitemradio', { name: option, exact: true }).click();
        };
        await form
          .getByRole('switch', { name: 'Consolidate memory candidates while idle', exact: true })
          .check();
        await choose('After idle for', '5 minutes');
        await choose('Limit per run', '100k tokens');
        await choose('Limit per run', 'Unlimited');
        const memory = async () =>
          (await app.core.workspace.read({ resource: 'settings', key: 'app' })).value.memory;
        for (let tries = 0; tries < 50; tries++) {
          const value = await memory();
          if (value.idleMinutes === 5 && value.tokenLimit === null) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal((await memory()).idleMinutes, 5);
        assert.equal((await memory()).tokenLimit, null);
        await page.reload();
        await form.getByRole('button', { name: 'After idle for', exact: true }).waitFor();
        assert.equal(
          await form.getByRole('button', { name: 'After idle for', exact: true }).innerText(),
          '5 minutes',
        );
        assert.equal(
          await form.getByRole('button', { name: 'Limit per run', exact: true }).innerText(),
          'Unlimited',
        );
        await form.scrollIntoViewIfNeeded();
        await shot('r4-4c-memory-settings-en');
      },
    );
  },
);
