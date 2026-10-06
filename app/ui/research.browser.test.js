import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createResearchStore } from '../services/research/store.js';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}
const headers = { authorization: 'Bearer ui-token', 'content-type': 'application/json' };
async function request(page, route, body) {
  const response = await fetch(new URL(route, page.url()), {
    method: body ? 'POST' : 'GET',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.ok, true, await response.clone().text());
  return response.json();
}
async function openProject(page, app) {
  const project = await app.core.projects.create({ name: '城市就业研究' });
  await page.locator('.tree-name', { hasText: project.name }).waitFor();
  await page.locator('.sidebar [data-route="database"]').click();
  await page.locator('.research-base').waitFor();
  return project;
}
async function pdfBytes() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([600, 800]);
  page.drawText('Employment resilience improves through regional innovation.', {
    x: 40,
    y: 740,
    size: 13,
    font,
  });
  return Buffer.from(await document.save());
}
async function importPdf(page, name = 'employment.pdf') {
  await page
    .locator('.research-base input[type="file"]')
    .setInputFiles({ name, mimeType: 'application/pdf', buffer: await pdfBytes() });
  await page.locator('[data-rb-source]', { hasText: name }).filter({ hasText: '已解析' }).waitFor();
}
const run = (name, work) => withBrowserApp('r4-1b/' + name, silent, work);

test(
  'library sidebar imports PDF, searches text and locates a cited passage',
  { skip: browserSkip },
  () =>
    run('import-search', async ({ page, app, shot }) => {
      const project = await openProject(page, app);
      await importPdf(page);
      assert.equal(new URL(page.url()).hash, '#/database/' + project.id);
      await page.getByLabel('统一检索资料与条目').fill('regional innovation');
      await page.locator('.rb-search').getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('[data-rb-search-results] mark').first().waitFor();
      await page.locator('[data-hit-type="chunk"]').first().click();
      await page.locator('#modal .rb-passage[data-focused="true"]').waitFor();
      assert.match(await page.locator('#modal').innerText(), /第 1 页/);
      assert.match(
        await page.locator('#modal .rb-passage code').first().innerText(),
        /\[S1 p\.1\]/,
      );
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.locator('#modal').getByRole('button', { name: '复制引用' }).click();
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /\[S1 p\.1\]/);
      await page.locator('#modal').getByRole('button', { name: '关闭' }).click();
      await page.getByRole('button', { name: '清除搜索' }).click();
      await shot('research-library');
    }),
);

test(
  'research items are created, edited, replaced and retain revisions',
  { skip: browserSkip },
  () =>
    run('item-revisions', async ({ page, app }) => {
      await openProject(page, app);
      await page.locator('[data-rb-tab="knowledge"]').click();
      await page.getByRole('button', { name: '新建条目' }).click();
      await page.locator('#modal').getByLabel('标题').fill('城市就业韧性');
      await page
        .locator('#modal')
        .getByLabel('内容', { exact: true })
        .fill('**创新能力**促进就业恢复。');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      let card = page.locator('[data-rb-item]', { hasText: '城市就业韧性' });
      await card.locator('strong', { hasText: '创新能力' }).waitFor();
      const id = await card.getAttribute('data-rb-item');
      await card.getByRole('button', { name: '编辑', exact: true }).click();
      await page
        .locator('#modal')
        .getByLabel('内容', { exact: true })
        .fill('交通连接促进就业恢复。');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      await card.getByText('交通连接促进就业恢复。', { exact: true }).waitFor();
      await card.getByRole('button', { name: '修订历史' }).click();
      assert.match(await page.locator('[data-rb-history]').innerText(), /创新能力/);
      await page.locator('#modal').getByRole('button', { name: '关闭' }).click();
      await card.getByRole('button', { name: '取代', exact: true }).click();
      await page.locator('#modal').getByLabel('标题').fill('就业韧性新结论');
      await page.locator('#modal').getByLabel('内容', { exact: true }).fill('创新与交通共同作用。');
      await page.locator('#modal').getByRole('button', { name: '保存新版本' }).click();
      await page.locator('[data-rb-item]', { hasText: '就业韧性新结论' }).waitFor();
      await page.getByLabel('状态', { exact: true }).selectOption('superseded');
      await page.getByText('已取代的记录', { exact: true }).click();
      card = page.locator(`[data-rb-item="${id}"]`);
      await card.waitFor();
      await card.getByRole('button', { name: '修订历史' }).click();
      assert.match(await page.locator('[data-rb-history]').innerText(), /交通连接/);
      assert.match(await page.locator('[data-rb-history]').innerText(), /superseded/);
    }),
);

test(
  'source metadata, table filtering and reparsing update real records',
  { skip: browserSkip },
  () =>
    run('source-metadata', async ({ page, app }) => {
      const project = await openProject(page, app);
      await importPdf(page);
      let row = page.locator('[data-rb-source]');
      const id = await row.getAttribute('data-rb-source');
      await row.getByRole('button', { name: '编辑元数据' }).click();
      await page.locator('#modal').getByLabel('标题').fill('韧性文献');
      await page.locator('#modal').getByLabel('作者').fill('Lin; Chen');
      await page.locator('#modal').getByLabel('年份').fill('2026');
      await page.locator('#modal').getByLabel('期刊或来源').fill('Regional Studies');
      await page.locator('#modal').getByLabel('类型', { exact: true }).selectOption('paper');
      await page.locator('#modal').getByLabel('阅读状态').selectOption('read');
      await page.locator('#modal').getByLabel('标签').fill('resilience, cities');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      row = page.locator('[data-rb-source]', { hasText: '韧性文献' });
      await row.getByText('Lin; Chen').waitFor();
      assert.match(await row.innerText(), /2026.*Regional Studies/s);
      await page.getByLabel('类型', { exact: true }).selectOption('paper');
      await page.getByLabel('阅读状态').selectOption('read');
      await page.getByLabel('按标签筛选').fill('cities');
      await page.getByLabel('按标签筛选').press('Tab');
      await row.waitFor();
      await page.getByLabel('阅读状态').selectOption('unread');
      await page.getByText('暂无记录', { exact: true }).waitFor();
      await page.getByLabel('阅读状态').selectOption('read');
      await row.getByRole('button', { name: '重新解析' }).click();
      await row.filter({ hasText: '已解析' }).waitFor();
      const source = (await request(page, '/api/research/sources/' + id)).source;
      assert.equal(source.metadata.authors[0].literal, 'Lin');
      assert.equal(source.projectId, project.id);
      let opened = false;
      await page.route('**/api/research/sources/*/open', async (route) => {
        opened = true;
        await route.fulfill({ json: { opened: true } });
      });
      await row.getByRole('button', { name: '打开原件' }).click();
      await page.waitForResponse((response) => response.url().endsWith('/open'));
      assert.equal(opened, true);
      await page.getByLabel('统一检索资料与条目').fill('韧性文献');
      await page.locator('.rb-search').getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('[data-hit-type="source"]').waitFor();
    }),
);

test(
  'personal library and external sites share navigation and English text',
  { skip: browserSkip },
  () =>
    run('scopes-sites', async ({ page, app }) => {
      await openProject(page, app);
      await importPdf(page, 'project.pdf');
      await page.getByRole('button', { name: '我的资料', exact: true }).click();
      await page.getByText('暂无记录', { exact: true }).waitFor();
      await importPdf(page, 'personal.pdf');
      const sources = await request(page, '/api/research/sources?projectId=');
      assert.equal(sources[0].projectId, null);
      await page.getByRole('button', { name: '当前项目材料', exact: true }).click();
      await page.locator('[data-rb-source]', { hasText: 'project.pdf' }).waitFor();
      assert.equal(await page.locator('[data-rb-source]', { hasText: 'personal.pdf' }).count(), 0);
      await page.getByRole('button', { name: '外部资源', exact: true }).click();
      await page.getByRole('button', { name: '新增站点' }).click();
      await page.locator('#modal input').nth(0).fill('Open science');
      await page.locator('#modal input').nth(1).fill('https://example.org');
      await page.locator('#modal').getByRole('button', { name: '添加', exact: true }).click();
      await page.locator('.site', { hasText: 'Open science' }).waitFor();
      await page.locator('.site', { hasText: 'Open science' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '编辑站点' }).click();
      await page.locator('#modal input').nth(0).fill('Research tools');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      await page.locator('.site', { hasText: 'Research tools' }).waitFor();
      await page.evaluate(async () => {
        await fetch('/api/settings', {
          method: 'PATCH',
          headers: { authorization: 'Bearer ui-token', 'content-type': 'application/json' },
          body: JSON.stringify({ appearance: { language: 'en' } }),
        });
      });
      await page.getByRole('button', { name: 'My library', exact: true }).click();
      await page.locator('.research-base h1').filter({ hasText: 'Research library' }).waitFor();
      await page.getByRole('button', { name: 'Literature and materials' }).waitFor();
      assert.equal(await page.getByRole('button', { name: '记忆', exact: true }).count(), 0);
    }),
);

test('pin and archive filters preserve item history', { skip: browserSkip }, () =>
  run('item-status', async ({ page, app }) => {
    const project = await openProject(page, app);
    await request(page, '/api/research/items', {
      projectId: project.id,
      type: 'knowledge',
      title: '可追溯结论',
      body: '保留旧修订。',
    });
    await page.locator('[data-rb-tab="knowledge"]').click();
    const card = page.locator('[data-rb-item]', { hasText: '可追溯结论' });
    await card.getByRole('button', { name: '置顶', exact: true }).click();
    await card.getByRole('button', { name: '取消置顶' }).waitFor();
    await page.getByLabel('置顶', { exact: true }).selectOption('true');
    await card.waitFor();
    await card.getByRole('button', { name: '归档', exact: true }).click();
    await page.getByText('暂无记录', { exact: true }).waitFor();
    await page.getByLabel('状态', { exact: true }).selectOption('archived');
    await card.waitFor();
    await card.getByRole('button', { name: '修订历史' }).click();
    assert.match(await page.locator('[data-rb-history]').innerText(), /archived/);
  }),
);

test('models render LaTeX and variables while claims show their state', { skip: browserSkip }, () =>
  run('structured-items', async ({ page, app }) => {
    await openProject(page, app);
    await page.locator('[data-rb-tab="model"]').click();
    await page.getByRole('button', { name: '新建条目' }).click();
    await page.locator('#modal').getByLabel('标题').fill('就业恢复模型');
    await page.locator('#modal').getByLabel('内容', { exact: true }).fill('恢复率模型。');
    await page
      .locator('#modal')
      .getByLabel('结构化内容（JSON）')
      .fill(
        JSON.stringify({
          latex: 'y = \\alpha x',
          variables: [{ symbol: 'x', meaning: '创新投入', unit: '元' }],
        }),
      );
    await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.rb-latex .katex').waitFor();
    assert.match(await page.locator('[data-rb-item] .table').innerText(), /创新投入/);
    await page.locator('[data-rb-tab="claim"]').click();
    await page.getByRole('button', { name: '新建条目' }).click();
    await page.locator('#modal').getByLabel('标题').fill('创新假说');
    await page
      .locator('#modal')
      .getByLabel('结构化内容（JSON）')
      .fill('{"claimStatus":"supported"}');
    await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
    await page.getByText('有证据支持', { exact: true }).waitFor();
  }),
);

test(
  'library pagination and search hits navigate to later source passages',
  { skip: browserSkip },
  () =>
    run('pagination', async ({ page, app }) => {
      const project = await openProject(page, app);
      const store = createResearchStore({ db: app.core.db, events: app.core.events });
      for (let index = 0; index < 51; index++)
        store.createSource({
          projectId: project.id,
          title: 'Source ' + String(index).padStart(2, '0'),
          kind: 'note',
        });
      await page.getByLabel('排序', { exact: true }).selectOption('title');
      await page.getByLabel('排序方向').selectOption('asc');
      await page.locator('[data-rb-source]', { hasText: 'Source 00' }).waitFor();
      await page.getByRole('button', { name: '下一页' }).click();
      await page.locator('[data-rb-source]', { hasText: 'Source 50' }).waitFor();
      const source = store
        .listSources({ projectId: project.id, sort: 'title', direction: 'asc' })
        .at(-1);
      store.addChunks(
        source.id,
        Array.from({ length: 25 }, (_, ordinal) => ({
          text: ordinal === 24 ? 'unique regional discovery' : 'ordinary paragraph ' + ordinal,
          page: ordinal + 1,
        })),
        { contentStatus: 'parsed' },
      );
      await page.getByLabel('统一检索资料与条目').fill('unique regional discovery');
      await page.locator('.rb-search').getByRole('button', { name: '搜索', exact: true }).click();
      await page.locator('[data-hit-type="chunk"]').click();
      await page
        .locator('.rb-passage[data-focused="true"]', { hasText: 'unique regional discovery' })
        .waitFor();
      assert.match(await page.locator('#modal').innerText(), /第 25 页/);
      await page.locator('#modal').getByRole('button', { name: '上一页' }).click();
      await page.locator('#modal').getByText('第 1 页', { exact: true }).waitFor();
    }),
);

test(
  'multi-file import keeps parse failures visible without stopping successful files',
  { skip: browserSkip },
  () =>
    run('import-failure', async ({ page, app }) => {
      await openProject(page, app);
      await page.locator('.research-base input[type="file"]').setInputFiles([
        {
          name: 'unsupported.xyz',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('not supported'),
        },
        { name: 'successful.pdf', mimeType: 'application/pdf', buffer: await pdfBytes() },
      ]);
      await page
        .locator('[data-rb-source]', { hasText: 'successful.pdf' })
        .filter({ hasText: '已解析' })
        .waitFor();
      await page.locator('[data-rb-import-progress] [role="alert"]').waitFor();
      await page
        .locator('[data-rb-source]', { hasText: 'unsupported.xyz' })
        .getByRole('button', { name: '详情', exact: true })
        .click();
      await page.locator('#modal [role="alert"]').waitFor();
      await page.locator('#modal').getByText('暂无可读取的段落', { exact: true }).waitFor();
    }),
);

test(
  'semantic settings enable search, download explicitly and refresh pushed progress',
  { skip: browserSkip },
  () =>
    run('semantic-settings', async ({ page, app, shot }) => {
      let status = {
        state: 'disabled',
        enabled: false,
        model: 'multilingual-e5-small · int8 · 384',
        hardware: { supported: true },
        indexed: 0,
        total: 3,
        error: null,
        download: null,
      };
      let reads = 0,
        downloads = 0,
        rebuilds = 0;
      await page.route('**/api/research/semantic/status', async (route) => {
        reads++;
        await route.fulfill({ json: status });
      });
      await page.route('**/api/research/semantic/download', async (route) => {
        downloads++;
        status = {
          ...status,
          state: 'downloading',
          download: { completed: 1, files: 3, bytes: 1048576 },
        };
        await route.fulfill({ json: status });
      });
      await page.route('**/api/research/semantic/rebuild', async (route) => {
        rebuilds++;
        status = { ...status, state: 'indexing', indexed: 1 };
        await route.fulfill({ json: status });
      });
      await page.evaluate(() => {
        location.hash = '#/settings/environment';
      });
      await page.getByRole('heading', { name: '本地混合检索' }).waitFor();
      assert.equal(downloads, 0);
      await page.getByRole('button', { name: '开启语义检索' }).click();
      await page.waitForFunction(
        () =>
          /** @type {HTMLButtonElement} */ (
            document.querySelector('[data-semantic-settings] button')
          )?.disabled === false,
      );
      assert.equal((await request(page, '/api/settings')).semantic.enabled, true);
      status = { ...status, enabled: true, state: 'model-missing' };
      app.core.events.transient('research.semantic.changed', status);
      await page.getByText('模型未下载', { exact: true }).waitFor();
      await page.getByRole('button', { name: '下载或修复本地模型' }).click();
      await page.getByText('正在下载模型', { exact: true }).waitFor();
      assert.equal(downloads, 1);
      status = { ...status, state: 'ready', indexed: 3, download: null };
      app.core.events.transient('research.semantic.changed', status);
      await page.getByText('混合检索就绪', { exact: true }).waitFor();
      await page.getByRole('button', { name: '重新检查索引' }).click();
      await page.getByText('正在建立索引', { exact: true }).waitFor();
      assert.equal(rebuilds, 1);
      const before = reads;
      await page.waitForTimeout(1100);
      assert.equal(reads, before);
      await shot('semantic-settings');
    }),
);
