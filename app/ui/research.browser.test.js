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
/** @param {any} page @param {any} app @param {'project'|'global'} [scope] */
async function openProject(page, app, scope = 'project') {
  const project = await app.core.projects.create({ name: '城市就业研究' });
  await page.locator('.ss-sidebar .ss-tree-row__open', { hasText: project.name }).waitFor();
  // The sidebar opens the global knowledge base first; the scope menu then
  // switches to the project's own database.
  await page.locator('.ss-sidebar [data-route="database"]').click();
  await page.locator('.research-base .ss-header__title', { hasText: '知识库' }).waitFor();
  if (scope === 'global') return project;
  await page.getByRole('button', { name: '范围', exact: true }).click();
  await page.getByRole('menuitemradio', { name: /项目数据库/ }).click();
  await page.locator('.research-base .ss-header__title', { hasText: '数据库' }).waitFor();
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
const run = (name, work) => withBrowserApp('r4-1b-' + name, silent, work);
/** Runs a row's ⋯ menu entry. */
async function rowMenu(page, row, name) {
  await row.hover();
  await row.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
/** Picks a value in the toolbar's filter popover. */
async function filter(page, label, option) {
  const dialog = page.getByRole('dialog', { name: '筛选' });
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: '筛选' }).click();
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
}
/** Selects an item row and runs one of the detail panel's actions. */
async function itemPanel(page, row, name) {
  await row.click();
  const panel = page.locator('.kb-panel');
  if (name === '编辑') await panel.getByRole('button', { name: '编辑', exact: true }).click();
  else {
    await panel.getByRole('button', { name: '节点菜单' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
}

test(
  'library sidebar imports PDF, searches text and locates a cited passage',
  { skip: browserSkip },
  () =>
    run('import-search', async ({ page, app, shot }) => {
      const project = await openProject(page, app);
      await importPdf(page);
      assert.equal(new URL(page.url()).hash, '#/database/' + project.id);
      await page.getByLabel('统一检索资料与条目').fill('regional innovation');
      await page.getByLabel('统一检索资料与条目').press('Enter');
      await page.locator('[data-rb-search-results] mark').first().waitFor();
      await page.locator('[data-hit-type="chunk"]').first().click();
      await page.locator('#modal .ss-passage[data-focused="true"]').waitFor();
      assert.match(await page.locator('#modal').innerText(), /第 1 页/);
      assert.match(
        await page.locator('#modal .ss-passage code').first().innerText(),
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
      await openProject(page, app, 'global');
      await page.locator('[data-rb-tab="knowledge"]').click();
      await page.getByRole('button', { name: '新建条目' }).click();
      await page.locator('#modal').getByLabel('标题').fill('城市就业韧性');
      await page
        .locator('#modal')
        .getByLabel('内容', { exact: true })
        .fill('**创新能力**促进就业恢复。');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      let card = page.locator('[data-rb-item]', { hasText: '城市就业韧性' });
      await card.click();
      const detail = page.locator('.kb-panel [data-rb-item-detail]');
      await detail.locator('strong', { hasText: '创新能力' }).waitFor();
      const id = await card.getAttribute('data-rb-item');
      await itemPanel(page, card, '编辑');
      await page
        .locator('#modal')
        .getByLabel('内容', { exact: true })
        .fill('交通连接促进就业恢复。');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      await detail.getByText('交通连接促进就业恢复。', { exact: true }).waitFor();
      await itemPanel(page, card, '修订历史');
      assert.match(await page.locator('[data-rb-history]').innerText(), /创新能力/);
      await page.locator('#modal').getByRole('button', { name: '关闭' }).click();
      await itemPanel(page, card, '取代');
      await page.locator('#modal').getByLabel('标题').fill('就业韧性新结论');
      await page.locator('#modal').getByLabel('内容', { exact: true }).fill('创新与交通共同作用。');
      await page.locator('#modal').getByRole('button', { name: '保存新版本' }).click();
      await page.locator('[data-rb-item]', { hasText: '就业韧性新结论' }).waitFor();
      await filter(page, '状态', '已取代');
      await page.keyboard.press('Escape');
      card = page.locator(`[data-rb-item="${id}"]`);
      await card.waitFor();
      await rowMenu(page, card, '修订历史');
      assert.match(await page.locator('[data-rb-history]').innerText(), /交通连接/);
      assert.match(await page.locator('[data-rb-history]').innerText(), /已取代/);
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
      await rowMenu(page, row, '编辑信息');
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
      await filter(page, '类型', '论文');
      await filter(page, '阅读状态', '已读');
      await page.getByLabel('按标签筛选').fill('cities');
      await page.getByLabel('按标签筛选').press('Tab');
      await row.waitFor();
      await filter(page, '阅读状态', '未读');
      await page.getByText('暂无记录', { exact: true }).waitFor();
      await filter(page, '阅读状态', '已读');
      await page.keyboard.press('Escape');
      await rowMenu(page, row, '重新解析');
      await row.filter({ hasText: '已解析' }).waitFor();
      const source = (await request(page, '/api/research/sources/' + id)).source;
      assert.equal(source.metadata.authors[0].literal, 'Lin');
      assert.equal(source.projectId, project.id);
      let opened = false;
      await page.route('**/api/research/sources/*/open', async (route) => {
        opened = true;
        await route.fulfill({ json: { opened: true } });
      });
      const opening = page.waitForResponse((response) => response.url().endsWith('/open'));
      await rowMenu(page, row, '打开原件');
      await opening;
      assert.equal(opened, true);
      await page.getByLabel('统一检索资料与条目').fill('韧性文献');
      await page.getByLabel('统一检索资料与条目').press('Enter');
      await page.locator('[data-hit-type="source"]').waitFor();
    }),
);

test(
  'personal library and external sites share navigation and English text',
  { skip: browserSkip },
  () =>
    run('scopes-sites', async ({ page, app, shot }) => {
      const project = await openProject(page, app);
      await importPdf(page, 'project.pdf');
      // The knowledge base shows global sources and project literature; a project shows its own.
      await page.getByRole('button', { name: '范围', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /^知识库/ }).click();
      await page.locator('[data-rb-tab="entities"]').waitFor();
      // A plain project file stays in the project; once it is literature it is shown.
      const [projectPdf] = await request(page, '/api/research/sources?projectId=' + project.id);
      assert.equal(projectPdf.kind, 'file');
      const listed = await request(page, '/api/research/sources?knowledge=1');
      assert.equal(
        listed.some((row) => row.id === projectPdf.id),
        false,
      );
      await fetch(new URL('/api/research/sources/' + projectPdf.id, page.url()), {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ kind: 'paper' }),
      });
      await page.locator('[data-rb-source]', { hasText: 'project.pdf' }).waitFor();
      await shot('scope-global');
      await importPdf(page, 'personal.pdf');
      const sources = await request(page, '/api/research/sources?projectId=');
      assert.equal(sources[0].projectId, null);
      await page.getByRole('button', { name: '范围', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /项目数据库/ }).click();
      // A project has a database, not a knowledge base: sources and memory only.
      await page.locator('.research-base .ss-header__title', { hasText: '数据库' }).waitFor();
      // project.pdf was listed before the switch too: wait for the list to refresh.
      await page
        .locator('[data-rb-source]', { hasText: 'personal.pdf' })
        .waitFor({ state: 'detached' });
      await page.locator('[data-rb-source]', { hasText: 'project.pdf' }).waitFor();
      await shot('scope-database');
      await page.getByRole('button', { name: '范围', exact: true }).click();
      await page.waitForTimeout(300);
      await shot('scope-menu');
      await page.keyboard.press('Escape');
      for (const key of ['entities', 'knowledge', 'claim'])
        assert.equal(await page.locator(`[data-rb-tab="${key}"]`).count(), 0);
      // The sidebar entry reopens the last scope.
      await page.waitForFunction(async () => {
        const response = await fetch('/api/settings', {
          headers: { authorization: 'Bearer ui-token' },
        });
        return (await response.json()).appearance.knowledgeScope === 'project';
      });
      await page.evaluate(() => (location.hash = '#/'));
      await page.locator('[data-route="database"]').click();
      await page.locator('.research-base .ss-header__title', { hasText: '数据库' }).waitFor();
      await page.getByRole('button', { name: '范围', exact: true }).click();
      await page.getByRole('menuitemradio', { name: '外部资源', exact: true }).click();
      await page.getByRole('button', { name: '添加站点' }).click();
      let siteDialog = page.getByRole('dialog', { name: '添加站点' });
      await siteDialog.getByLabel('名称').fill('Open science');
      await siteDialog.getByLabel('网址').fill('https://example.org');
      await siteDialog.getByRole('button', { name: '添加', exact: true }).click();
      await page.locator('[data-site]', { hasText: 'Open science' }).waitFor();
      await page.locator('[data-site]', { hasText: 'Open science' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: '编辑站点' }).click();
      // A settings reload while the form is open replaces the site objects.
      const reloaded = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/settings') && response.request().method() === 'GET',
      );
      app.core.events.record('resource.changed', { resource: 'settings', key: 'app' });
      await reloaded;
      siteDialog = page.getByRole('dialog', { name: '编辑站点' });
      await siteDialog.getByLabel('名称').fill('Research tools');
      await siteDialog.getByRole('button', { name: '保存', exact: true }).click();
      await page.locator('[data-site]', { hasText: 'Research tools' }).waitFor();
      await page.evaluate(async () => {
        await fetch('/api/settings', {
          method: 'PATCH',
          headers: { authorization: 'Bearer ui-token', 'content-type': 'application/json' },
          body: JSON.stringify({ appearance: { language: 'en' } }),
        });
      });
      await page.getByRole('button', { name: 'Back to knowledge base', exact: true }).click();
      await page
        .locator('.research-base .ss-header__title')
        .filter({ hasText: 'Database' })
        .waitFor();
      await page.getByRole('tab', { name: /Literature and materials/ }).waitFor();
      assert.equal(await page.getByRole('tab', { name: '记忆', exact: true }).count(), 0);
    }),
);

test(
  'the sidebar reopens a just-chosen scope while the setting is still saving',
  { skip: browserSkip },
  () =>
    run('scope-race', async ({ page, app }) => {
      const project = await app.core.projects.create({ name: '城市就业研究' });
      await page.locator('.ss-sidebar .ss-tree-row__open', { hasText: project.name }).waitFor();
      // Hold every settings save until the sidebar has been clicked.
      /** @type {(value?: unknown) => void} */
      let release = () => {};
      const held = new Promise((resolve) => (release = resolve));
      await page.route('**/api/settings', async (route) => {
        if (route.request().method() === 'PATCH') await held;
        await route.continue();
      });
      await page.evaluate((id) => (location.hash = '#/database/' + id), project.id);
      await page.locator('.research-base .ss-header__title', { hasText: '数据库' }).waitFor();
      await page.evaluate(() => (location.hash = '#/'));
      await page.locator('.ss-sidebar [data-route="database"]').click();
      await page.locator('.research-base .ss-header__title', { hasText: '数据库' }).waitFor();
      release();
      await page.waitForFunction(async () => {
        const response = await fetch('/api/settings', {
          headers: { authorization: 'Bearer ui-token' },
        });
        return (await response.json()).appearance.knowledgeScope === 'project';
      });
    }),
);

test('pin and archive filters preserve item history', { skip: browserSkip }, () =>
  run('item-status', async ({ page, app }) => {
    const project = await openProject(page, app, 'global');
    await request(page, '/api/research/items', {
      projectId: project.id,
      type: 'knowledge',
      title: '可追溯结论',
      body: '保留旧修订。',
    });
    await page.locator('[data-rb-tab="knowledge"]').click();
    const card = page.locator('[data-rb-item]', { hasText: '可追溯结论' });
    await rowMenu(page, card, '置顶');
    await card
      .locator('.ss-list-row__meta [data-tip="已置顶"], .ss-list-row__meta[data-tip="已置顶"]')
      .waitFor();
    await filter(page, '置顶', '仅置顶');
    await page.keyboard.press('Escape');
    await card.waitFor();
    await rowMenu(page, card, '归档');
    await page.getByText('暂无记录', { exact: true }).waitFor();
    await filter(page, '状态', '已归档');
    await page.keyboard.press('Escape');
    await card.waitFor();
    await rowMenu(page, card, '修订历史');
    assert.match(await page.locator('[data-rb-history]').innerText(), /已归档/);
  }),
);

test('models render LaTeX and variables while claims show their state', { skip: browserSkip }, () =>
  run('structured-items', async ({ page, app }) => {
    await openProject(page, app, 'global');
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
    await page.locator('[data-rb-item]', { hasText: '就业恢复模型' }).click();
    await page.locator('.kb-panel .ss-formula .katex').waitFor();
    assert.match(await page.locator('.kb-panel .ss-table').innerText(), /创新投入/);
    await page.locator('[data-rb-tab="claim"]').click();
    await page.getByRole('button', { name: '新建条目' }).click();
    await page.locator('#modal').getByLabel('标题').fill('创新假说');
    await page
      .locator('#modal')
      .getByLabel('结构化内容（JSON）')
      .fill('{"claimStatus":"supported"}');
    await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('[data-rb-item]', { hasText: '创新假说' }).click();
    await page.locator('.kb-panel').getByText('有证据支持', { exact: true }).waitFor();
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
      await page.getByRole('button', { name: '排序', exact: true }).click();
      await page.getByRole('menuitemradio', { name: '标题', exact: true }).click();
      await page.getByRole('button', { name: '排序', exact: true }).click();
      await page.getByRole('menuitemradio', { name: '升序', exact: true }).click();
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
      await page.getByLabel('统一检索资料与条目').press('Enter');
      await page.locator('[data-hit-type="chunk"]').click();
      await page
        .locator('.ss-passage[data-focused="true"]', { hasText: 'unique regional discovery' })
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
      await rowMenu(
        page,
        page.locator('[data-rb-source]', { hasText: 'unsupported.xyz' }),
        '查看段落',
      );
      await page.locator('#modal [role="alert"]').waitFor();
      await page.locator('#modal').getByText('暂无可读取的段落', { exact: true }).waitFor();
    }),
);

test(
  'semantic settings enable search, download explicitly and refresh pushed progress',
  { skip: browserSkip },
  () =>
    run('semantic-settings', async ({ page, app, shot }) => {
      // This scenario supplies both HTTP samples and pushed progress itself.
      // The real service's delayed hardware probe would otherwise publish a
      // second state stream after enabling settings and overwrite fake ready.
      await app.semantic.close();
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
      let releaseReads = () => {};
      let staleReadStarted = () => {};
      const staleRead = new Promise((resolve) => {
        staleReadStarted = () => resolve(undefined);
      });
      const release = new Promise((resolve) => {
        releaseReads = () => resolve(undefined);
      });
      await page.route('**/api/research/semantic/status', async (route) => {
        reads++;
        const sampled = structuredClone(status);
        // Force the ordering seen under full-suite load: an old HTTP sample
        // returns after a newer event, without relying on a timing delay.
        if (reads > 1 && sampled.state === 'disabled') {
          staleReadStarted();
          await release;
        }
        await route.fulfill({ json: sampled });
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
        location.hash = '#/settings/knowledge';
      });
      await page.getByRole('heading', { name: '本地混合检索' }).waitFor();
      assert.equal(downloads, 0);
      await page.getByRole('switch', { name: '语义检索', exact: true }).check();
      await staleRead;
      status = { ...status, enabled: true, state: 'model-missing' };
      app.core.events.transient('research.semantic.changed', status);
      await page.getByText('还没有下载模型', { exact: true }).waitFor();
      releaseReads();
      await page.waitForFunction(
        () =>
          /** @type {HTMLButtonElement} */ (
            document.querySelector('[data-semantic-settings] [role="switch"]')
          )?.disabled === false,
      );
      assert.equal((await request(page, '/api/settings')).semantic.enabled, true);
      await page.getByText('还没有下载模型', { exact: true }).waitFor();
      await page.getByRole('button', { name: '下载或修复模型' }).click();
      await page.getByText('正在下载模型', { exact: true }).waitFor();
      assert.equal(downloads, 1);
      status = { ...status, state: 'ready', indexed: 3, download: null };
      app.core.events.transient('research.semantic.changed', status);
      await page.getByText('混合检索就绪', { exact: true }).waitFor();
      await page.getByRole('button', { name: '重新建立索引' }).click();
      await page.getByText('正在建立索引', { exact: true }).waitFor();
      assert.equal(rebuilds, 1);
      const before = reads;
      await page.waitForTimeout(1100);
      assert.equal(reads, before);
      await shot('semantic-settings');
    }),
);
