// KB-12: under an answer, the sources it used and the knowledge it wrote,
// with 在图中查看 and 撤回这组修改 (which can itself be undone).
import test from 'node:test';
import assert from 'node:assert/strict';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'an answer lists the sources it used and withdraws or restores the knowledge it wrote',
  { skip: browserSkip },
  () => {
    /** @type {any} */
    let ids = {};
    return withBrowserApp(
      'kb12-turn-knowledge',
      async function* ({ call }) {
        await call('research_read', { id: ids.source });
        await call('kb_write', {
          ops: [
            { op: 'createEntity', key: 'qca', name: 'QCA', kind: 'method' },
            { op: 'createEntity', key: 'fs', name: 'fsQCA', kind: 'method' },
            {
              op: 'createEdge',
              fromRef: '$fs',
              toRef: '$qca',
              relation: 'variant-of',
              evidence: [
                { ref: 'chunk:' + ids.chunk, quote: 'fsQCA is a variant of QCA.', page: 2 },
              ],
            },
            { op: 'createEdge', fromRef: 'source:' + ids.source, toRef: '$fs', relation: 'uses' },
          ],
        });
        yield '这项研究用的是 fsQCA [S1 p.2]。';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        });
        const project = await app.core.projects.create({ name: '方法整理' });
        const source = app.research.store.createSource({
          projectId: project.id,
          title: 'QCA study',
          kind: 'paper',
        });
        app.research.store.addChunks(source.id, [
          { text: 'This study uses fsQCA, a variant of QCA.', page: 2 },
        ]);
        ids = { source: source.id, chunk: app.research.store.chunks(source.id)[0].id };
        const meeting = app.core.meetings.create({
          title: '方法讨论',
          projectId: project.id,
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        await page.goto(new URL(`/?token=ui-token#/meeting/${meeting.id}`, page.url()).href);
        app.core.messages.post({
          meetingId: meeting.id,
          authorId: 'person_user',
          text: '整理方法',
        });
        await app.conductor.idle();

        const used = page.locator('[data-used-sources]');
        await used.locator('.ss-files__head', { hasText: '1 份资料' }).click();
        await used.locator('.ss-files__row', { hasText: 'QCA study' }).waitFor();
        assert.match(await used.locator('.ss-files__desc').textContent(), /项目导入的资料 · p\.2/u);

        const change = page.locator('[data-knowledge-change]');
        const head = change.locator('.ss-files__head');
        await head.filter({ hasText: '新增 2 个实体、2 条关系' }).click();
        const rows = change.locator('.ss-rel__row');
        assert.deepEqual(
          (await rows.locator('.ss-rel__label').allTextContents()).map((text) => text.trim()),
          ['新增实体 QCA', '新增实体 fsQCA', 'fsQCA —变体自→ QCA', 'QCA study —使用→ fsQCA'],
        );
        await rows.nth(2).getByText('依据 p.2').waitFor();
        await rows.nth(3).locator('.ss-ai--missing', { hasText: '缺证据' }).waitFor();
        await shot('turn-knowledge');

        const active = () =>
          app.core.db.prepare("SELECT COUNT(*) AS n FROM kb_entities WHERE status='active'").get()
            .n;
        assert.equal(active(), 2);
        await change.getByRole('button', { name: '撤回这组修改' }).click();
        await page.getByRole('status').filter({ hasText: '已撤回 4 条。' }).waitFor();
        assert.equal(active(), 0);
        await change.getByRole('button', { name: '恢复这组修改' }).click();
        await page.getByRole('status').filter({ hasText: '已恢复 4 条。' }).waitFor();
        assert.equal(active(), 2);
        await change.getByRole('button', { name: '撤回这组修改' }).waitFor();

        // Opened again, the answers' extras come in one request, not one per answer.
        const asked = [];
        page.on('request', (request) => asked.push(new URL(request.url()).pathname));
        await page.reload();
        await change.locator('.ss-files__head', { hasText: '新增 2 个实体、2 条关系' }).click();
        // Restored after a withdrawal: the batch reads the whole chain.
        await change.getByRole('button', { name: '撤回这组修改' }).waitFor();
        assert.equal(asked.filter((route) => route.endsWith('/message-extras')).length, 1);
        assert.equal(asked.filter((route) => route.startsWith('/api/turns/')).length, 0);
        assert.equal(asked.filter((route) => route.endsWith('/citations')).length, 0);
        assert.equal(asked.filter((route) => route === '/api/knowledge/versions').length, 0);

        await change.getByRole('button', { name: '在图中查看' }).click();
        await page.waitForFunction(() => location.hash === '#/library');
      },
    );
  },
);
