// KB-9: the knowledge page lists sources, items and entities and shows the
// selected node's properties, connections, evidence and history beside them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore } from '../services/research/store.js';
import { createKnowledgeStore } from '../services/knowledge/store.js';
import { browserSkip, withBrowserApp } from './browser-testing.js';

async function* silent() {}
const headers = { authorization: 'Bearer ui-token', 'content-type': 'application/json' };
async function request(page, route, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(new URL(route, page.url()), {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.ok, true, await response.clone().text());
  return response.json();
}

/** A small project: two papers (one parsed), three entities, edges with evidence. */
function seed(app, project) {
  const research = createResearchStore({ db: app.core.db, events: app.core.events });
  const knowledge = createKnowledgeStore(app.core);
  const paper = research.createSource({
    projectId: project.id,
    title: '组态视角下城市韧性的提升路径：基于 fsQCA 的分析',
    kind: 'paper',
    metadata: { authors: ['王晓', '陈立'], year: 2023, venue: '城市问题' },
  });
  research.addChunks(
    paper.id,
    [
      { text: '本文采用模糊集定性比较分析（fsQCA）识别城市韧性的组态路径。', page: 6 },
      { text: '数据来自 2010–2020 年 108 个地级市的面板。', page: 5 },
    ],
    { contentStatus: 'parsed' },
  );
  const ragin = research.createSource({
    projectId: project.id,
    title: 'Redesigning Social Inquiry: Fuzzy Sets and Beyond',
    kind: 'book',
    metadata: { authors: ['Ragin'], year: 2008 },
  });
  const [method, passage] = research.chunks(paper.id);
  const meeting = app.core.meetings.create({
    projectId: project.id,
    title: 'QCA 文献整理',
    members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
  });
  const user = { actorId: 'person_user', origin: 'user' };
  const ai = {
    actorId: 'agent_main',
    origin: 'ai',
    meetingId: meeting.id,
    turnId: 'turn_kb9_seed',
  };
  const fsqca = knowledge.createEntity(
    {
      name: 'fsQCA',
      kind: 'method',
      nameEn: 'fuzzy-set QCA',
      aliases: ['模糊集定性比较分析'],
      description: '用模糊集识别导致结果的条件组合。',
    },
    user,
  );
  const panel = knowledge.createEntity({ name: '地级市面板数据 2010–2020', kind: 'dataset' }, user);
  const entropy = knowledge.createEntity({ name: '熵权法', kind: 'method' }, ai);
  for (const entity of [fsqca, panel, entropy])
    knowledge.membership(project.id, 'entity:' + entity.id, true, user);
  knowledge.createEdge(
    {
      fromRef: 'source:' + paper.id,
      relation: 'uses',
      toRef: 'entity:' + fsqca.id,
      evidence: [{ ref: 'chunk:' + method.id, quote: method.text, page: 6 }],
    },
    user,
  );
  knowledge.createEdge(
    {
      fromRef: 'source:' + paper.id,
      relation: 'uses',
      toRef: 'entity:' + panel.id,
      evidence: [{ ref: 'chunk:' + passage.id, quote: passage.text, page: 5 }],
    },
    user,
  );
  knowledge.createEdge(
    {
      fromRef: 'source:' + paper.id,
      relation: 'uses',
      toRef: 'entity:' + entropy.id,
      evidence: [{ ref: 'chunk:' + passage.id, page: 5 }],
    },
    ai,
  );
  knowledge.closeTurn(ai.turnId);
  knowledge.createEdge(
    {
      fromRef: 'source:' + paper.id,
      relation: 'cites',
      toRef: 'source:' + ragin.id,
      evidence: [{ ref: 'chunk:' + method.id, page: 6 }],
    },
    user,
  );
  return { paper, ragin, fsqca, panel, entropy };
}

test(
  'the knowledge page lists nodes and shows connections, evidence, labels and history',
  { skip: browserSkip, timeout: 90000 },
  () =>
    withBrowserApp('kb-9-knowledge', silent, async ({ page, app, shot }) => {
      const project = await app.core.projects.create({ name: '城市韧性研究' });
      const nodes = seed(app, project);
      await page.locator('.ss-sidebar .ss-tree-row__open', { hasText: project.name }).waitFor();
      await page.locator('.ss-sidebar [data-route="database"]').click();
      const paperRow = page.locator('[data-rb-source]', { hasText: '组态视角' });
      await paperRow.filter({ hasText: '已解析' }).waitFor();
      assert.match(await paperRow.innerText(), /王晓; 陈立 · 2023 · 城市问题/);
      assert.match(await paperRow.innerText(), /4 条关系/);
      assert.match(await page.locator('[data-rb-tab="sources"]').innerText(), /2/);
      assert.match(await page.locator('[data-rb-tab="entities"]').innerText(), /3/);

      // A source: properties, grouped connections, the AI mark and evidence pages.
      await paperRow.click();
      const panel = page.locator('.kb-panel');
      await panel.locator('[data-kb-relation="uses"]').waitFor();
      assert.match(await panel.locator('.ss-props').innerText(), /S1/);
      const uses = panel.locator('[data-kb-relation="uses"]');
      assert.equal(await uses.locator('.kb-rel').count(), 3);
      await uses.locator('.kb-rel', { hasText: '熵权法' }).locator('.ss-ai').waitFor();
      await panel.locator('[data-kb-relation="cites"]', { hasText: 'Redesigning' }).waitFor();
      await shot('kb-9-source');
      await uses
        .locator('.kb-rel', { hasText: 'fsQCA' })
        .getByRole('button', { name: 'p.6' })
        .click();
      await page.locator('.file-preview-panel').waitFor();
      await page.locator('.file-preview-panel').getByRole('button', { name: '关闭' }).click();

      // Following a connection opens that entity; its incoming edge reads 「被使用」.
      await uses.getByRole('button', { name: 'fsQCA', exact: true }).click();
      await panel.locator('.ss-panel__title', { hasText: 'fsQCA' }).waitFor();
      await panel.locator('.ss-rel__head', { hasText: '被使用' }).waitFor();
      assert.match(await panel.locator('.ss-props').innerText(), /模糊集定性比较分析/);

      // Labels are added and removed in place.
      await panel.getByRole('button', { name: '添加标签' }).click();
      await panel.getByLabel('添加标签').fill('组态方法');
      await panel.getByLabel('添加标签').press('Enter');
      await panel.locator('.kb-label', { hasText: '组态方法' }).waitFor();
      const labels = await request(page, '/api/knowledge/entities/' + nodes.fsqca.id);
      assert.deepEqual(
        labels.labels.map((row) => row.label),
        ['组态方法'],
      );

      // Editing the entity adds a history row that can be restored.
      await panel.getByRole('button', { name: '编辑', exact: true }).click();
      await page.locator('#modal').getByLabel('名称').fill('fsQCA 方法');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      await panel.locator('.ss-panel__title', { hasText: 'fsQCA 方法' }).waitFor();
      await panel.locator('[data-kb-history]', { hasText: '你改了名称' }).waitFor();
      await shot('kb-9-entity');
      await panel
        .locator('[data-kb-history]')
        .getByRole('button', { name: '恢复到这一版' })
        .click();
      await panel.locator('.ss-panel__title', { hasText: /^fsQCA$/ }).waitFor();

      // The entities tab lists by name; AI-added entities carry the mark.
      await page.locator('[data-rb-tab="entities"]').click();
      const entity = page.locator('[data-kb-entity]', { hasText: '熵权法' });
      await entity.locator('.ss-ai').waitFor();
      const names = await page.locator('[data-kb-entity] .ss-list-row__title').allInnerTexts();
      assert.deepEqual(names, ['fsQCA（fuzzy-set QCA）', '地级市面板数据 2010–2020', '熵权法']);
      await entity.click();
      await panel.locator('.ss-panel__title', { hasText: '熵权法' }).waitFor();
      await shot('kb-9-entities');
      await page.getByRole('button', { name: '筛选' }).click();
      await page.getByLabel('只看 AI 添加的').check();
      await page.locator('[data-kb-entity]', { hasText: 'fsQCA' }).waitFor({ state: 'detached' });
      await page
        .getByRole('dialog', { name: '筛选' })
        .getByRole('button', { name: '清除' })
        .click();
      await page.locator('[data-kb-entity]', { hasText: 'fsQCA' }).waitFor();
      await page.keyboard.press('Escape');

      // A new entity joins the project; deleting it can be undone from the toast.
      await page.getByRole('button', { name: '新建实体' }).click();
      await page.locator('#modal').getByLabel('名称').fill('一致性阈值');
      await page.locator('#modal').getByLabel('种类').selectOption('metric');
      await page.locator('#modal').getByRole('button', { name: '保存', exact: true }).click();
      const created = page.locator('[data-kb-entity]', { hasText: '一致性阈值' });
      await created.waitFor();
      await panel.locator('.ss-panel__title', { hasText: '一致性阈值' }).waitFor();
      assert.match(await panel.locator('.ss-props').innerText(), /城市韧性研究/);
      await created.getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '删除' }).click();
      await created.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await created.waitFor();

      // Removing an edge from the panel is undone the same way.
      await page.locator('[data-rb-tab="sources"]').click();
      await paperRow.click();
      const entropyEdge = panel.locator('.kb-rel', { hasText: '熵权法' });
      await entropyEdge.hover();
      await entropyEdge.getByRole('button', { name: '删除这条关系' }).click();
      await entropyEdge.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '撤销', exact: true }).click();
      await entropyEdge.waitFor();

      // English interface text has no Chinese left (user content excluded).
      await page.evaluate(async () => {
        await fetch('/api/settings', {
          method: 'PATCH',
          headers: { authorization: 'Bearer ui-token', 'content-type': 'application/json' },
          body: JSON.stringify({ appearance: { language: 'en' } }),
        });
      });
      await page
        .locator('.research-base .ss-header__title', { hasText: 'Knowledge base' })
        .waitFor();
      await panel.locator('.ss-rel__head', { hasText: 'Uses' }).waitFor();
      const chrome = await page.evaluate(() => {
        const parts = [
          ...document.querySelectorAll(
            '.research-base .ss-header, .research-base .ss-toolbar, .kb-panel .ss-props dt, .kb-panel .ss-section-title, .kb-panel .ss-rel__head, .ss-list-row__meta',
          ),
        ];
        return parts.map((element) => element.textContent).join('\n');
      });
      assert.doesNotMatch(chrome.replace(/城市韧性研究/g, ''), /[一-鿿]/u);
      await shot('kb-9-source-en');
    }),
);
