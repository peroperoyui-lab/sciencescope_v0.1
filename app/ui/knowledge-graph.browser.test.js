// KB-10: the knowledge base as a graph. The canvas draws the stored layout,
// centres on a node, connects two nodes by dragging, merges entities, pins a
// dragged node, filters by kind and unconnected nodes, and undoes page edits with Ctrl+Z.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore } from '../services/research/store.js';
import { createKnowledgeStore } from '../services/knowledge/store.js';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}
const headers = { authorization: 'Bearer ui-token', 'content-type': 'application/json' };
async function request(page, route) {
  const response = await fetch(new URL(route, page.url()), { headers });
  assert.equal(response.ok, true, await response.clone().text());
  return response.json();
}

function seed(app, project) {
  const research = createResearchStore({ db: app.core.db, events: app.core.events });
  const knowledge = createKnowledgeStore(app.core);
  const user = { actorId: 'person_user', origin: 'user' };
  const paper = research.createSource({
    projectId: project.id,
    title: '组态视角下城市韧性的提升路径',
    kind: 'paper',
  });
  const ragin = research.createSource({ title: 'Redesigning Social Inquiry', kind: 'book' });
  const entity = (name, kind) => knowledge.createEntity({ name, kind }, user);
  const fsqca = entity('fsQCA', 'method');
  const alias = entity('模糊集 QCA', 'method');
  const panel = entity('地级市面板', 'dataset');
  const consistency = entity('一致性阈值', 'concept');
  const edge = (from, relation, to, layer) =>
    knowledge.createEdge({ fromRef: from, relation, toRef: to, ...(layer ? { layer } : {}) }, user);
  edge('source:' + paper.id, 'uses', 'entity:' + fsqca.id);
  edge('source:' + paper.id, 'uses', 'entity:' + panel.id);
  edge('source:' + paper.id, 'cites', 'source:' + ragin.id, 'derived');
  edge('entity:' + consistency.id, 'part-of', 'entity:' + alias.id);
  edge('source:' + ragin.id, 'proposes', 'entity:' + alias.id);
  return { paper, ragin, fsqca, alias, panel, consistency };
}

/** @param {any} page @param {string} script @param {any} [arg] */
const onMap = (page, script, arg) =>
  page.evaluate(
    ([body, value]) => {
      const host = document.querySelector('[data-kb-map]');
      const map = /** @type {any} */ (host).knowledgeMap;
      return new Function('map', 'host', 'value', body)(map, host, value);
    },
    [script, arg],
  );
// Positions are read once the camera has stopped moving.
const settled = (page) =>
  page.waitForFunction(
    () =>
      !(/** @type {any} */ (document.querySelector('[data-kb-map]')).knowledgeMap.cy.animated()),
  );
const at = async (page, ref) =>
  (await settled(page)) &&
  onMap(
    page,
    `const p = map.cy.getElementById(value).renderedPosition();
     const box = host.getBoundingClientRect();
     return { x: box.left + p.x, y: box.top + p.y };`,
    ref,
  );
const hasClass = (page, ref, name) =>
  onMap(page, `return map.cy.getElementById(value[0]).hasClass(value[1]);`, [ref, name]);

test(
  'the knowledge graph centres, connects, merges, pins, filters and undoes',
  { skip: browserSkip, timeout: 120000 },
  () =>
    withBrowserApp('kb-10-graph', silent, async ({ page, app, shot }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const nodes = seed(app, project);
      await app.knowledge.layout.idle();
      const ref = {
        paper: 'source:' + nodes.paper.id,
        ragin: 'source:' + nodes.ragin.id,
        fsqca: 'entity:' + nodes.fsqca.id,
        alias: 'entity:' + nodes.alias.id,
        panel: 'entity:' + nodes.panel.id,
        consistency: 'entity:' + nodes.consistency.id,
      };
      await page.locator('.ss-sidebar .ss-tree-row__open', { hasText: project.name }).waitFor();
      await page.locator('.ss-sidebar [data-route="database"]').click();
      await page.locator('.research-base .ss-header__title', { hasText: '知识库' }).waitFor();
      await page.locator('[data-kb-view="graph"]').click();
      await page.waitForFunction(
        () =>
          /** @type {any} */ (document.querySelector('[data-kb-map]'))?.knowledgeMap?.cy.nodes()
            .length === 6,
      );
      await page.locator('.kb-status', { hasText: '6 个节点 · 5 条关系' }).waitFor();
      assert.equal(await page.locator('.research-base .ss-tabs').isHidden(), true);
      assert.equal(await onMap(page, 'return map.cy.edges().length;'), 5);
      assert.equal(
        await onMap(page, 'return map.cy.edges(".derived").length;'),
        1,
        'the citation is an automatic hint',
      );
      const settings = await request(page, '/api/settings');
      assert.equal(settings.appearance.knowledgeView, 'graph');
      await shot('kb-10-graph');

      // Hovering an edge names both ends and where it came from.
      const [paperAt, panelAt] = [await at(page, ref.paper), await at(page, ref.panel)];
      await page.mouse.move((paperAt.x + panelAt.x) / 2, (paperAt.y + panelAt.y) / 2);
      const hover = page.locator('.kb-graph__hover');
      await hover.waitFor();
      assert.match(await hover.innerText(), /地级市面板/);
      assert.match(await hover.innerText(), /手动添加/);
      await page.mouse.move(5, 5);

      // Double-click centres on a node; depth 2 reaches one step further.
      let point = await at(page, ref.paper);
      await page.mouse.dblclick(point.x, point.y);
      const center = page.locator('[data-kb-center]');
      await center.filter({ hasText: '组态视角' }).waitFor();
      await center.filter({ hasText: '3 个相连' }).waitFor();
      assert.equal(await hasClass(page, ref.alias, 'faded'), true);
      assert.equal(await hasClass(page, ref.fsqca, 'faded'), false);
      await page.getByRole('group', { name: '深度' }).getByRole('button', { name: '2' }).click();
      await center.filter({ hasText: '4 个相连' }).waitFor();
      await shot('kb-10-center');
      await center.getByRole('button', { name: '不再以它为中心' }).click();
      await center.waitFor({ state: 'detached' });
      assert.equal(await hasClass(page, ref.alias, 'faded'), false);

      // Clicking selects (detail panel); the handle drags a new relation.
      // A panel opening or closing can move the canvas under a click on a busy
      // machine; click again once the view is still.
      const panel = page.locator('.kb-panel');
      const fsqcaTitle = panel.locator('.ss-panel__title', { hasText: 'fsQCA' });
      for (let tries = 0; tries < 3 && !(await fsqcaTitle.isVisible()); tries++) {
        point = await at(page, ref.fsqca);
        await page.mouse.click(point.x, point.y);
        await fsqcaTitle.waitFor({ timeout: 3000 }).catch(() => {});
      }
      await fsqcaTitle.waitFor();
      const target = await at(page, ref.consistency);
      // The handle sits at the selected node's right edge once the view is still.
      const start = await (
        await page.waitForFunction(() => {
          const host = document.querySelector('[data-kb-map]');
          const map = /** @type {any} */ (host).knowledgeMap;
          const handle = document.querySelector('.kb-map__handle');
          const expected = map.handlePoint(map.selected()[0]);
          if (!handle || !expected) return null;
          const box = host.getBoundingClientRect();
          const rect = handle.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return Math.hypot(x - box.left - expected.x, y - box.top - expected.y) < 1 && { x, y };
        })
      ).jsonValue();
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 8 });
      await page.mouse.up();
      const picker = page.locator('.kb-picker');
      await picker.waitFor();
      assert.match(await picker.innerText(), /fsQCA → 一致性阈值/);
      await shot('kb-10-connect');
      await picker.getByRole('menuitem', { name: /反向/ }).click();
      assert.match(await picker.innerText(), /一致性阈值 → fsQCA/);
      await picker.getByRole('menuitem', { name: '属于', exact: true }).click();
      await page.locator('.ss-toast', { hasText: '已添加关系「属于」' }).waitFor();
      const added = () =>
        request(page, `/api/knowledge/edges?ref=${ref.fsqca}&limit=50`).then((result) =>
          result.rows.some((row) => row.relation === 'part-of' && row.fromRef === ref.consistency),
        );
      assert.equal(await added(), true);
      await page.waitForFunction(
        () =>
          /** @type {any} */ (document.querySelector('[data-kb-map]')).knowledgeMap.cy.edges()
            .length === 6,
      );

      // Ctrl+Z withdraws it, Ctrl+Shift+Z brings it back.
      await page.locator('[data-kb-graph]').focus();
      await page.keyboard.press('Control+z');
      await page.getByRole('button', { name: '重做' }).and(page.locator(':enabled')).waitFor();
      assert.equal(await added(), false);
      await page.keyboard.press('Control+Shift+z');
      await page.getByRole('button', { name: '重做' }).and(page.locator(':disabled')).waitFor();
      assert.equal(await added(), true);

      // Shift-click a second entity, then merge it into the first.
      point = await at(page, ref.alias);
      await page.keyboard.down('Shift');
      await page.mouse.click(point.x, point.y);
      await page.keyboard.up('Shift');
      await page.waitForFunction(
        (chosen) =>
          /** @type {any} */ (document.querySelector('[data-kb-map]')).knowledgeMap.cy
            .getElementById(chosen)
            .hasClass('chosen'),
        ref.alias,
      );
      point = await at(page, ref.fsqca);
      await page.mouse.click(point.x, point.y, { button: 'right' });
      await page.getByRole('menuitem', { name: '把「模糊集 QCA」合并到这里' }).click();
      const dialog = page.getByRole('dialog', { name: '把「模糊集 QCA」合并到「fsQCA」？' });
      assert.match(await dialog.innerText(), /2 条关系会改挂到「fsQCA」/);
      await shot('kb-10-merge');
      await dialog.getByRole('button', { name: '合并', exact: true }).click();
      await page.locator('.ss-toast', { hasText: '已合并到「fsQCA」' }).waitFor();
      const merged = await request(page, `/api/knowledge/entities/${nodes.alias.id}`);
      assert.equal(merged.entity.status, 'merged');
      await page.waitForFunction(
        (gone) =>
          /** @type {any} */ (document.querySelector('[data-kb-map]')).knowledgeMap.cy
            .getElementById(gone)
            .empty(),
        ref.alias,
      );

      // Dragging a node pins it where it was dropped.
      point = await at(page, ref.ragin);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await page.mouse.move(point.x + 60, point.y + 40, { steps: 6 });
      await page.mouse.up();
      const pinned = () =>
        app.core.db.prepare('SELECT pinned FROM kb_positions WHERE ref=?').get(ref.ragin);
      for (let tries = 0; tries < 50 && !pinned()?.pinned; tries++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(Number(pinned().pinned), 1);

      // Filters hide a kind at once; clearing brings it back.
      await page.locator('[data-kb-graph]').getByRole('button', { name: '筛选' }).click();
      // Only unconnected nodes: every node here has a relation.
      await page.getByRole('dialog', { name: '筛选' }).getByLabel('只看未连接的').check();
      assert.equal(
        await onMap(
          page,
          'const node = map.cy.getElementById(value); return node.empty() || node.hasClass("hidden");',
          ref.paper,
        ),
        true,
      );
      await page.getByRole('dialog', { name: '筛选' }).getByLabel('只看未连接的').uncheck();
      await page.getByRole('dialog', { name: '筛选' }).getByLabel('文献').uncheck();
      // A filtered kind is hidden, then unloaded on the next viewport load.
      assert.equal(
        await onMap(
          page,
          'const node = map.cy.getElementById(value); return node.empty() || node.hasClass("hidden");',
          ref.paper,
        ),
        true,
      );
      await page
        .getByRole('dialog', { name: '筛选' })
        .getByRole('button', { name: '清除' })
        .click();
      await page.waitForFunction((paper) => {
        const node = /** @type {any} */ (
          document.querySelector('[data-kb-map]')
        ).knowledgeMap.cy.getElementById(paper);
        return node.nonempty() && !node.hasClass('hidden');
      }, ref.paper);
      await page.keyboard.press('Escape');

      // Back to the table; the choice is kept.
      await page.locator('[data-kb-view="table"]').click();
      await page.locator('[data-rb-source]', { hasText: '组态视角' }).waitFor();
      assert.equal(await page.locator('[data-kb-graph]').count(), 0);
    }),
);
