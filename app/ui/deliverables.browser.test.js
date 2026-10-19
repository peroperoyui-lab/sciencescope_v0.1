import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { browserSkip, withBrowserApp } from './browser-testing.js';

const image = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#eef1e9"/><path d="M20 95L220 95M20 95L20 15" stroke="#777e76"/><path d="M20 85L80 70L140 45L210 20" stroke="#354e3c" stroke-width="4" fill="none"/></svg>',
);

test(
  'presented files fold into one line, show inline where the answer names them, survive reload and open through host',
  { skip: browserSkip },
  () =>
    withBrowserApp(
      'r4-11b-deliverables',
      async function* ({ call }) {
        await call('workspace_present', {
          files: [
            { path: '图.svg', description: '效应图' },
            { path: '报告.txt', description: '方法报告' },
          ],
        });
        yield '结果文件已保存。\n\n![效应图](图.svg)\n\n方法见[报告](./报告.txt)。';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        const project = await app.core.projects.create({ name: '交付物测试' });
        const folder = app.core.workspace.locate.projectDir(project.id);
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, '图.svg'), image);
        await writeFile(path.join(folder, '报告.txt'), '方法报告原件');
        const meeting = app.core.meetings.create({
          title: '交付物验收',
          projectId: project.id,
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        await page.goto(new URL(`/?token=ui-token#/meeting/${meeting.id}`, page.url()).href);
        app.core.messages.post({
          meetingId: meeting.id,
          authorId: 'person_user',
          text: '展示文件',
        });
        await app.conductor.idle();
        const files = page.locator('[data-deliverables]');
        await files.locator('.ss-files__head', { hasText: '交付了 2 个文件' }).waitFor();
        assert.match(await files.locator('.ss-files__names').textContent(), /图\.svg、报告\.txt/);
        // The answer shows the figure it named, from ScienceScope's copy.
        const figure = page.locator('.message-text img.ss-inline-figure');
        await page.waitForFunction(() => {
          const img = /** @type {HTMLImageElement} */ (document.querySelector('.ss-inline-figure'));
          return img?.complete && img.naturalWidth > 0;
        });
        assert.match(await figure.getAttribute('src'), /\/api\/deliverables\/file_.+\/content/);
        assert.equal(await page.locator('.message-text .ss-inline-file').textContent(), '报告');
        await files.locator('.ss-files__head').click();
        assert.equal(await files.locator('.ss-files__row').count(), 2);
        assert.equal(
          await files.locator('[data-kind="document"]').innerText(),
          '报告.txt\n方法报告',
        );
        await rm(path.join(folder, '图.svg'));
        await rm(path.join(folder, '报告.txt'));
        await page.reload();
        await page.locator('[data-deliverables] .ss-files__head').click();
        await page.waitForFunction(
          () =>
            /** @type {HTMLImageElement} */ (document.querySelector('.ss-files__thumb img'))
              ?.naturalWidth > 0,
        );
        let opened;
        await page.route('**/api/deliverables/*/open', async (route) => {
          opened = route.request().url();
          await route.fulfill({ json: { opened: true } });
        });
        const didOpen = page.waitForResponse(
          (response) =>
            response.url().includes('/api/deliverables/') && response.url().endsWith('/open'),
        );
        await page.locator('[data-deliverables] [data-kind="document"]').click();
        await didOpen;
        assert.match(opened, /\/api\/deliverables\/file_.+\/open$/);
        await shot('deliverables');
      },
    ),
);
