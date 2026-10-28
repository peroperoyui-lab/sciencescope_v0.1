// Functional map path: explicit floating nodes/links coexist with the tree,
// clipboard/file text remains Markdown, and every edit uses workspace history.
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}

test(
  'a person moves floating nodes and adds directed or undirected links',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-map-links', silent, async ({ page, app, shot }) => {
      const project = await app.core.projects.create({ name: 'Connected research' });
      await app.core.workspace.edit({
        resource: 'map',
        key: project.id,
        op: 'addNode',
        args: { node: { id: 'question', text: 'Research question' } },
      });
      await page.goto(new URL(`/?token=ui-token#/map/${project.id}`, page.url()).href);
      const question = page.locator('.ss-mnode[data-node="question"]');
      await question.waitFor();
      await page.getByRole('button', { name: '游离节点', exact: true }).click();
      const floating = page.locator('.ss-mnode[data-floating="true"]');
      await floating.waitFor();
      // The new node's text is selected in the panel; leaving the box saves it.
      const input = page.locator('.ss-map-panel textarea');
      await input.fill('Alternative method');
      await input.evaluate((element) => /** @type {HTMLElement} */ (element).blur());
      await floating.filter({ hasText: 'Alternative method' }).waitFor();
      const read = async () =>
        (await app.core.workspace.read({ resource: 'map', key: project.id })).value;
      const initial = (await read()).nodes.find((node) => node.floating);
      assert.equal(initial.text, 'Alternative method');
      const box = await floating.boundingBox();
      const response = page.waitForResponse(
        (result) =>
          result.url().endsWith('/api/resources/map') &&
          result.request().postDataJSON()?.args?.changes?.x != null,
      );
      await page.mouse.move(box.x + 40, box.y + 20);
      await page.mouse.down();
      await page.mouse.move(box.x + 125, box.y + 70, { steps: 5 });
      await page.mouse.up();
      await response;
      const moved = (await read()).nodes.find((node) => node.floating);
      assert.ok(moved.x > initial.x + 70);
      assert.ok(moved.y > initial.y + 35);
      const leftIs = (left) =>
        page.waitForFunction(
          ({ id, x }) =>
            Math.abs(
              parseFloat(
                /** @type {HTMLElement} */ (document.querySelector(`[data-node="${id}"]`)).style
                  .left,
              ) - x,
            ) < 1,
          { id: initial.id, x: left },
        );
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await leftIs(initial.x);
      await page.getByRole('button', { name: '重做', exact: true }).click();
      await leftIs(moved.x);

      // 连线 from the node panel: an arrow by default, or a plain line.
      const panel = page.locator('.ss-map-panel');
      const link = async (from, to, directed) => {
        await from.click();
        await panel.getByRole('button', { name: '添加连线', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '连到另一个节点', exact: true });
        await dialog.getByRole('button', { name: '终点' }).click();
        await page.getByRole('menuitemradio', { name: to, exact: true }).click();
        if (!directed) await dialog.getByLabel('有向连线（带箭头）').uncheck();
        await dialog.getByRole('button', { name: '添加连线', exact: true }).click();
      };
      await link(question, 'Alternative method', true);
      await page.locator('.ss-map [data-edge]').waitFor();
      let map = await read();
      assert.equal(map.edges[0].from, 'question');
      assert.equal(map.edges[0].directed, true);
      assert.match(
        await page.locator(`[data-edge="${map.edges[0].id}"]`).getAttribute('marker-end'),
        /url/,
      );
      await link(floating, 'Research question', false);
      await page.waitForFunction(
        () => document.querySelectorAll('.ss-map [data-edge]').length === 2,
      );
      map = await read();
      assert.equal(map.edges[1].directed, false);
      assert.equal(
        await page.locator(`[data-edge="${map.edges[1].id}"]`).getAttribute('marker-end'),
        null,
      );
      await shot('r4-11b-map-links');
      assert.equal(await panel.locator('[data-link-row]').count(), 2);
      await panel.getByRole('button', { name: '移除连线' }).first().click();
      await page.waitForFunction(
        () => document.querySelectorAll('.ss-map [data-edge]').length === 1,
      );
      assert.equal((await read()).edges.length, 1);
      await page.getByRole('button', { name: '返回工作站' }).click();
      await page.locator('.ss-wb__map [data-edge]').waitFor();
      await page.getByRole('button', { name: '打开研究导图' }).click();
      await page
        .locator('.map-page > .ss-header')
        .getByRole('button', { name: '历史版本', exact: true })
        .click();
      await page
        .getByRole('dialog', { name: '历史版本', exact: true })
        .locator('[data-snapshot-group="map"] [data-snapshot-id]')
        .first()
        .waitFor();
      const saved = app.core.workspace.snapshots({ resource: 'map', key: project.id });
      assert.equal(app.core.workspace.getSnapshot(saved[0].id).value.edges.length, 1);
    }),
);

test(
  'Markdown paste and text drops become node content without creating image attachments',
  { skip: browserSkip },
  () =>
    withBrowserApp('ui-map-markdown', silent, async ({ page, app, shot }) => {
      const project = await app.core.projects.create({ name: 'Markdown research' });
      await app.core.workspace.edit({
        resource: 'map',
        key: project.id,
        op: 'addNode',
        args: { node: { id: 'content', text: 'Original note' } },
      });
      await page.goto(new URL(`/?token=ui-token#/map/${project.id}`, page.url()).href);
      const node = page.locator('.ss-mnode[data-node="content"]');
      const input = page.locator('.ss-map-panel textarea');
      const holds = (text) =>
        page.waitForFunction(
          (wanted) =>
            /** @type {HTMLTextAreaElement} */ (
              document.querySelector('.ss-map-panel textarea')
            )?.value.includes(wanted),
          text,
        );
      await node.waitFor();
      await node.evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', '## Pasted evidence\n\n**Important** observation.');
        element.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }),
        );
      });
      await holds('## Pasted evidence');
      await node.evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(['### Dropped Markdown\n\nSource detail.'], 'evidence.md', {
            type: 'text/markdown',
          }),
        );
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      });
      await holds('### Dropped Markdown');
      await input.evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(['Text file evidence.'], 'evidence.txt', { type: 'text/plain' }),
        );
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      });
      await holds('Text file evidence.');
      const map = (await app.core.workspace.read({ resource: 'map', key: project.id })).value;
      assert.equal(
        map.nodes[0].text,
        'Original note\n\n## Pasted evidence\n\n**Important** observation.\n\n### Dropped Markdown\n\nSource detail.\n\nText file evidence.',
      );
      assert.equal(map.nodes[0].attachments, undefined);
      await node.evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['image'], 'figure.png', { type: 'image/png' }));
        element.dispatchEvent(
          new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      });
      assert.equal(
        (await app.core.workspace.read({ resource: 'map', key: project.id })).value.nodes[0].text,
        map.nodes[0].text,
      );
      assert.match(await page.locator('.ss-map-panel').innerText(), /Enter 新建同级/);
      await shot('r4-11b-map-markdown');
      await page.getByRole('button', { name: '返回工作站' }).click();
      await page.getByRole('button', { name: '视图', exact: true }).click();
      await page.getByRole('menuitemcheckbox', { name: 'English', exact: true }).click();
      await page.getByRole('button', { name: 'Open the research map', exact: true }).click();
      await page.getByRole('button', { name: 'Floating node', exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Markdown outline', exact: true }).waitFor();
    }),
);
