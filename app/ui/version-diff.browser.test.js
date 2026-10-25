import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';
import { parseLog } from '../shared/journal.js';

test(
  'compare word changes, jump, copy old version and link/open log files in both languages',
  { skip: browserSkip, timeout: 120000 },
  async () => {
    await withBrowserApp(
      'version-diff-ui',
      async function* () {
        yield '完成。';
      },
      async ({ page, app, shot }) => {
        const project = await app.core.projects.create({ name: '稿件比较与日志' });
        app.versionNotes.configure(project.id, false);
        const imported = await app.versions.importFiles({
          projectId: project.id,
          files: [
            {
              name: '初稿.md',
              base64: Buffer.from('研究使用社会刺激。\n\n用户画像分析。').toString('base64'),
            },
            {
              name: '修订稿.md',
              base64: Buffer.from('研究使用环境刺激。\n\n用户聚类情况。').toString('base64'),
            },
          ],
        });
        const [old, current] = imported.versions;
        await page.goto(
          new URL(`/?token=ui-token#/version-diff/${project.id}/${current.id}`, page.url()).href,
        );
        await page.locator('[data-compare="ready"] .ss-cmp__col').first().waitFor();
        assert.match(
          await page
            .locator('.ss-cmp__col')
            .first()
            .locator('.ss-diff-del')
            .allTextContents()
            .then((values) => values.join('')),
          /社会|画像/u,
        );
        assert.match(
          await page
            .locator('.ss-cmp__col')
            .last()
            .locator('.ss-rev-ins')
            .allTextContents()
            .then((values) => values.join('')),
          /环境|聚类/u,
        );
        const position = page.locator('.ss-cmp__pos');
        await page.getByRole('button', { name: '下一处', exact: true }).click();
        assert.match(await position.textContent(), /^1 \/ \d+$/u);
        assert.equal((await page.locator('.ss-diff-cur').count()) > 0, true);
        await page.getByRole('button', { name: '上一处', exact: true }).click();
        assert.doesNotMatch(await position.textContent(), /^1 \//u);
        const lock = page.locator('.ss-cmp__lock');
        assert.equal(await lock.getAttribute('aria-pressed'), 'true');
        await lock.click();
        assert.equal(await lock.getAttribute('aria-pressed'), 'false');
        await shot('version-diff');
        await page.getByRole('button', { name: '另存为新版本', exact: true }).click();
        await page.getByRole('button', { name: '确认另存', exact: true }).click();
        await page.waitForFunction(
          () =>
            location.hash.includes('version-diff') && !document.querySelector('[role="dialog"]'),
        );
        const copy = app.versions.list(project.id)[0].versions[0];
        assert.equal(copy.number, 3);
        assert.equal((await app.versions.compare(copy.id, old.id)).status, 'unchanged');
        const opens = [];
        await page.route(`**/api/projects/${project.id}/log-file/open`, async (route) => {
          opens.push(route.request().postDataJSON());
          await route.fulfill({ json: { opened: true } });
        });
        await app.core.workspace.edit({
          resource: 'log',
          key: project.id,
          op: 'write',
          args: { text: '## 2026-10-12 完成稿件核查\n正文保留。' },
        });
        await page.goto(new URL(`/#/workbench/${project.id}`, page.url()).href);
        await page
          .locator('.journalcard')
          .getByRole('button', { name: '文件列表', exact: false })
          .click();
        await page.getByLabel('关联稿件版本').selectOption(current.id);
        await page.getByRole('button', { name: '关联版本', exact: true }).click();
        await page.getByLabel('项目文件路径').fill('分析/中文脚本.py');
        await page.getByRole('button', { name: '关联项目文件', exact: true }).click();
        const entryPage = page.locator('[data-journal-entry]');
        await entryPage.getByRole('button', { name: '保存', exact: true }).click();
        await entryPage.locator('.journal-savebar').waitFor({ state: 'detached' });
        const log = await app.core.workspace.read({ resource: 'log', key: project.id });
        assert.equal(parseLog(log.text)[0].references.length, 2);
        assert.match(parseLog(log.text)[0].body, /正文保留/u);
        // The details turn into plain text where they are shown, and back after saving.
        await entryPage.getByRole('button', { name: '日志详情', exact: true }).click();
        await entryPage.locator('.journal-details').click();
        const editor = entryPage.getByRole('textbox', { name: '编辑日志详情' });
        assert.equal(await editor.inputValue(), '正文保留。');
        await editor.fill('正文保留。\n\n**补充**：核查完成。');
        await entryPage.getByRole('button', { name: '保存', exact: true }).click();
        await entryPage.locator('.journal-savebar').waitFor({ state: 'detached' });
        await entryPage.locator('.journal-details strong', { hasText: '补充' }).waitFor();
        assert.match(
          parseLog((await app.core.workspace.read({ resource: 'log', key: project.id })).text)[0]
            .body,
          /\*\*补充\*\*：核查完成/u,
        );
        await entryPage.getByRole('button', { name: '文件列表', exact: true }).click();
        await page
          .locator('[data-journal-entry]')
          .getByRole('button', { name: '修订稿.md', exact: true })
          .click();
        await page
          .locator('[data-journal-entry]')
          .getByRole('button', { name: '分析/中文脚本.py', exact: true })
          .click();
        // Clicks return before the routed open request arrives.
        for (let tries = 0; opens.length < 2 && tries < 50; tries++) await page.waitForTimeout(100);
        assert.equal(opens.length, 2);
        assert.equal(opens[0].reference.id, current.id);
        assert.equal(opens[1].reference.path, '分析/中文脚本.py');
        await shot('journal-linked-files');
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await page
          .locator('[data-journal-entry]')
          .getByRole('button', { name: 'File list', exact: true })
          .waitFor();
        await page.locator('[data-journal-entry]').getByLabel('Remove link').first().click();
        await page
          .locator('[data-journal-entry]')
          .getByRole('button', { name: 'Save', exact: true })
          .click();
        await page.locator('.journal-savebar').waitFor({ state: 'detached' });
        assert.equal(
          parseLog((await app.core.workspace.read({ resource: 'log', key: project.id })).text)[0]
            .references.length,
          1,
        );
        await page.goto(new URL(`/#/version-diff/${project.id}/${current.id}`, page.url()).href);
        await page.getByRole('button', { name: 'Next change', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Swap sides', exact: true }).waitFor();
        await shot('version-diff-english');
      },
    );
  },
);
