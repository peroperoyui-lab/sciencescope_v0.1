import assert from 'node:assert/strict';
import path from 'node:path';

export async function waitComparison(page) {
  await page.locator('[data-compare="ready"] .ss-cmp__col').first().waitFor();
  await page.waitForFunction(() => {
    const pages = document.querySelectorAll('[data-compare="ready"] article.ss-page');
    return (
      pages.length === 2 && [...pages].every((article) => article.textContent.trim().length > 0)
    );
  });
  return { columns: await page.locator('[data-compare="ready"] .ss-cmp__col').count() };
}

/** New page actions use the installed WebView UI and wait for durable responses. */
export async function p4bActions({ page, manifest, operation, output, index }) {
  const nav = (route) =>
    page.evaluate((route) => {
      location.hash = route;
    }, route);
  const shot = (name) => page.screenshot({ path: path.join(output, `run-${index}-${name}.png`) });
  const resourceResponse = (name) =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/resources/${name}` &&
        response.request().method() === 'POST',
    );
  await operation('workbench-open', page, async () => {
    await nav('/workbench/' + manifest.projectId);
    await page
      .getByRole('region', { name: '全局计划', exact: true })
      .locator('.ss-note-card')
      .first()
      .waitFor();
    await page
      .getByRole('region', { name: '本项目日志', exact: true })
      .locator('.ss-note-card')
      .first()
      .waitFor();
    await page.getByRole('button', { name: '版本树', exact: true }).click();
    const tree = page.getByRole('tree', { name: '版本', exact: true });
    await page.waitForFunction(
      (count) => document.querySelectorAll('.ss-vtree [role="treeitem"]').length === count,
      manifest.p4b.versions,
    );
    await tree.getByRole('treeitem', { name: /^v1\b/u }).click();
    await page.locator('[data-version-notes] .ss-prose').filter({ hasText: '合成说明' }).waitFor();
    return {
      versions: await tree.getByRole('treeitem').count(),
      planCards: await page
        .getByRole('region', { name: '全局计划', exact: true })
        .locator('.ss-note-card')
        .count(),
      logCards: await page
        .getByRole('region', { name: '本项目日志', exact: true })
        .locator('.ss-note-card')
        .count(),
    };
  });
  await shot('workbench');
  await operation('workbench-version-diff', page, async () => {
    const tree = page.getByRole('tree', { name: '版本', exact: true });
    await tree.getByRole('treeitem', { name: /^v2\b/u }).click();
    await page.getByRole('button', { name: '和上一版 v1 比较', exact: true }).click();
    return waitComparison(page);
  });
  await page.getByRole('button', { name: '退出比较', exact: true }).click();
  await page.getByRole('button', { name: '关闭版本树', exact: true }).click();
  await operation('map-open', page, async () => {
    await nav('/map/' + manifest.projectId);
    await page.waitForFunction(
      (count) => document.querySelectorAll('.map-page .ss-mnode').length === count,
      manifest.p4b.mapNodes,
    );
    return { nodes: await page.locator('.map-page .ss-mnode').count() };
  });
  await operation('map-drag-save', page, async () => {
    const node = page.locator(`.map-page [data-node="${manifest.p4b.dragNodeId}"]`);
    const box = await node.boundingBox();
    assert.ok(box);
    const saved = resourceResponse('map');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 65, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    const response = await saved;
    assert.ok(response.ok());
    return { nodeId: manifest.p4b.dragNodeId, saved: true };
  });
  await shot('map');
  const restoredMap = page.waitForResponse(
    (response) =>
      /\/api\/revisions\/[^/]+\/undo$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.ok((await restoredMap).ok());
  await operation('journal-open', page, async () => {
    await nav('/journal/' + manifest.projectId);
    await page.waitForFunction(
      (count) => document.querySelectorAll('.ss-journal-list__entry').length === count,
      manifest.p4b.logCount,
    );
    return { entries: await page.locator('.ss-journal-list__entry').count() };
  });
  await page.locator('.ss-journal-list__title').first().click();
  await page.getByRole('button', { name: '编辑日志详情', exact: true }).waitFor();
  let originalLog;
  await operation('journal-edit-save', page, async () => {
    await page.getByRole('button', { name: '编辑日志详情', exact: true }).click();
    const input = page.getByRole('textbox', { name: '编辑日志详情', exact: true });
    originalLog = await input.inputValue();
    await input.fill(originalLog + `\nP4b 第 ${index} 次合成补充。`);
    const saved = resourceResponse('log');
    await input.blur();
    assert.ok((await saved).ok());
    await page
      .locator('.journal-details')
      .filter({ hasText: `P4b 第 ${index} 次合成补充。` })
      .waitFor();
    return { saved: true };
  });
  await shot('journal');
  await page.getByRole('button', { name: '编辑日志详情', exact: true }).click();
  const logInput = page.getByRole('textbox', { name: '编辑日志详情', exact: true });
  await logInput.fill(originalLog);
  const restoredLog = resourceResponse('log');
  await logInput.blur();
  assert.ok((await restoredLog).ok());
  await page.waitForFunction((marker) => {
    const body = document.querySelector('.journal-details');
    return body && !body.textContent.includes(marker);
  }, `P4b 第 ${index} 次合成补充。`);
  await operation('project-files-open', page, async () => {
    await nav('/files/' + manifest.projectId);
    const corpus = page
      .getByRole('tree', { name: '项目文件夹', exact: true })
      .locator('[data-path="corpus"]');
    await corpus.click();
    await page.waitForFunction(
      (count) =>
        document.querySelectorAll('.ss-folder-page [role="treeitem"][data-path^="corpus/"]')
          .length === count,
      manifest.counts.projectFiles,
    );
    return {
      files: await page.locator('.ss-folder-page [role="treeitem"][data-path^="corpus/"]').count(),
    };
  });
  await operation('project-file-preview', page, async () => {
    await page.locator(`.ss-folder-page [data-path="${manifest.files[0].path}"]`).click();
    await page.locator('.ss-folder__detail .ss-props').filter({ hasText: '引用编号' }).waitFor();
    await page.locator('.ss-folder-detail__text p').first().waitFor();
    return { paragraphs: await page.locator('.ss-folder-detail__text p').count() };
  });
  await shot('project-files');
  await operation('chat-knowledge-blocks', page, async () => {
    await nav('/meeting/' + manifest.p4b.evidenceMeetingId);
    const message = page.locator(`[data-message-id="${manifest.p4b.evidenceMessageId}"]`);
    await message.locator('[data-used-sources]').waitFor();
    await message.locator('[data-knowledge-change]').waitFor();
    await message.locator('[data-used-sources] .ss-files__head').click();
    await message.locator('[data-knowledge-change] .ss-files__head').click();
    await message.locator('[data-used-sources] .ss-files__row').first().waitFor();
    await message.locator('[data-knowledge-change] .ss-rel__row').first().waitFor();
    return {
      sources: await message.locator('[data-used-sources] .ss-files__row').count(),
      knowledgeChanges: await message.locator('[data-knowledge-change] .ss-rel__row').count(),
    };
  });
  await shot('chat-knowledge');
  await nav('/settings/general');
  const bio = page.getByRole('textbox', { name: '一句话介绍', exact: true });
  await bio.waitFor();
  const originalBio = await bio.inputValue();
  const settingsResponse = () =>
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/settings' &&
        response.request().method() === 'PATCH',
    );
  await operation('settings-auto-save', page, async () => {
    const saved = settingsResponse();
    await bio.fill(`P4b 合成性能验收 ${index}`);
    await bio.blur();
    assert.ok((await saved).ok());
    return { saved: true, trigger: 'blur' };
  });
  const restoredSettings = settingsResponse();
  await bio.fill(originalBio);
  await bio.blur();
  assert.ok((await restoredSettings).ok());
  await page
    .getByRole('dialog', { name: '设置', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await nav('/');
}
