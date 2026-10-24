// Settings → 技能 and MCP 服务器 as a person uses them: switch a skill off,
// copy a built-in one, import a ZIP and bind it to an expert; add an MCP
// server by form, switch one of its tools off, and approve its call in a chat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { browserSkip, withBrowserApp } from './browser-testing.js';
import { tempDir } from '../testing.js';

const settingsUrl = (page, id) => new URL(`/?token=ui-token#/settings/${id}`, page.url()).href;

test(
  'skills: switch off, copy a built-in, view one, import a ZIP and bind it to an expert',
  { skip: browserSkip },
  async () => {
    const temporary = await tempDir('skill-zip');
    try {
      const zip = new JSZip();
      zip.file(
        'stats-review/SKILL.md',
        '---\nname: stats-review\ndescription: 统计审稿清单：检查样本量和效应量。\nmetadata:\n  title: 统计审稿清单\n---\n\n# 统计审稿清单\n',
      );
      const file = path.join(temporary.dir, 'stats-review.zip');
      await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));

      await withBrowserApp(
        'skills',
        async function* () {},
        async ({ page, app, shot }) => {
          await page.goto(settingsUrl(page, 'skills'));
          const python = page.locator('[data-skill="python-analysis"]');
          await python.getByText('用 Python 分析数据').waitFor();
          await python.getByRole('switch').click();
          await page.waitForFunction(() =>
            document.querySelector('[data-skill="python-analysis"].ss-list-row--done'),
          );
          const saved = await app.core.workspace.read({ resource: 'settings', key: 'app' });
          assert.deepEqual(saved.value.skills.disabled, ['python-analysis']);

          const deliver = page.locator('[data-skill="deliver-files"]');
          await deliver.hover();
          await deliver.getByRole('button', { name: '更多' }).click();
          await page.getByRole('menuitem', { name: '复制一份来修改' }).click();
          await deliver.getByText('用的是你的副本').waitFor();

          await page.locator('[data-skill="cite-sources"]').getByText('查资料并引用原文').click();
          const dialog = page.getByRole('dialog', { name: '查资料并引用原文' });
          await dialog.getByText('cite-sources', { exact: true }).waitFor();
          await shot('skills-dialog');
          await dialog.getByRole('button', { name: '关闭' }).last().click();

          await page.locator('#skill-zip').setInputFiles(file);
          const imported = page.locator('[data-skill="stats-review"]');
          await imported.getByText('统计审稿清单').waitFor();
          await shot('skills-page');

          await page.goto(settingsUrl(page, 'experts'));
          await page.locator('[data-expert]').first().click();
          const expert = page.locator('[data-settings="expert"]');
          await expert.getByRole('button', { name: '添加' }).click();
          await page.getByRole('dialog', { name: '绑定的技能' }).getByText('统计审稿清单').click();
          await expert.locator('.ss-chip', { hasText: '统计审稿清单' }).waitFor();
          await shot('skills-binding');
          await page.keyboard.press('Escape');
          // The binding saves as soon as it changes.
          const bound = async () =>
            (
              await Promise.all(
                app.core.participants.list().map((item) => app.core.participants.get(item.id)),
              )
            ).some((item) => item.definition?.skills?.includes('stats-review'));
          for (let tries = 0; !(await bound()) && tries < 50; tries++)
            await new Promise((resolve) => setTimeout(resolve, 100));
          assert.ok(await bound());
          assert.equal(await page.locator('[data-settings="expert"]').count(), 1);

          await page.goto(settingsUrl(page, 'skills'));
          await page.locator('[data-skill="stats-review"] .ss-tag').waitFor();
        },
      );
    } finally {
      await temporary.cleanup();
    }
  },
);

const fixture = `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const server = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ['search_items', 'add_note'].map((name) => ({ name, description: name, inputSchema: { type: 'object', properties: {} } })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: request.params.name + ':' + process.env.TEST_TOKEN }],
}));
await server.connect(new StdioServerTransport());
`;

test(
  'MCP: add a server by form, switch a tool off, approve its call and see it in the timeline',
  { skip: browserSkip, timeout: 60000 },
  async () => {
    const temporary = await tempDir('mcp-ui');
    const file = path.join(temporary.dir, 'server.mjs');
    await writeFile(file, fixture);
    let id = '';
    const results = [];
    try {
      await withBrowserApp(
        'mcp-ui',
        async function* ({ call }) {
          results.push(await call(`mcp__${id}__search_items`, {}));
          yield '查到了';
        },
        async ({ page, app, shot }) => {
          await app.core.workspace.edit({
            resource: 'settings',
            key: 'app',
            op: 'patch',
            args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
          });
          await page.goto(settingsUrl(page, 'mcp'));
          await page.getByText('还没有 MCP 服务器').waitFor();
          await page.getByRole('button', { name: '添加服务器' }).click();
          const form = page.getByRole('dialog', { name: '添加 MCP 服务器' });
          await form.getByRole('textbox').first().fill('文献库');
          await form.getByPlaceholder('npx -y zotero-mcp').fill(`node "${file}"`);
          await form.getByRole('button', { name: '添加一行' }).click();
          await form.getByRole('textbox', { name: '环境变量名称' }).fill('TEST_TOKEN');
          await form.getByLabel('环境变量的值').fill('fixture-value');
          await shot('mcp-dialog');
          await form.getByRole('button', { name: '连接并保存' }).click();
          const card = page.locator('[data-server]');
          await card.getByText('已连接 · 2 个工具').waitFor({ timeout: 30000 });
          id = String(await card.getAttribute('data-server'));
          assert.doesNotMatch(await readFile(app.core.paths.settings, 'utf8'), /fixture-value/);
          await shot('mcp-page');

          await page.goto(settingsUrl(page, 'tools'));
          const note = page.locator(`[data-tool="mcp__${id}__add_note"]`);
          await note.getByRole('switch').click();
          await page.waitForFunction(
            (name) => document.querySelector(`[data-tool="${name}"].ss-list-row--done`),
            `mcp__${id}__add_note`,
          );
          assert.equal(await note.getByRole('switch').isChecked(), false);
          const saved = await app.core.workspace.read({ resource: 'settings', key: 'app' });
          assert.deepEqual(saved.value.mcp.servers[0].disabledTools, ['add_note']);
          await shot('tools-page');

          const meeting = app.core.meetings.create({
            members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
            policy: { mode: 'direct', respondent: 'agent_main' },
          });
          await page.goto(new URL('/?token=ui-token#/meeting/' + meeting.id, page.url()).href);
          await page.getByRole('textbox', { name: '主输入框' }).fill('查一下文献');
          await page.getByRole('button', { name: '发送', exact: true }).click();
          const answer = page.locator('.ss-msg:not([data-user])').last();
          const approval = answer.getByRole('group', { name: '需要你的批准' });
          await approval.getByText('文献库 · search_items').waitFor();
          await approval.getByRole('button', { name: '总是允许' }).click();
          await page.getByRole('menuitem', { name: '这个服务器的所有工具' }).waitFor();
          await shot('mcp-approval');
          await page.keyboard.press('Escape');
          await approval.getByRole('button', { name: '允许', exact: true }).click();
          await answer.getByText('查到了').waitFor();
          assert.match(JSON.stringify(results[0]), /search_items:fixture-value/);
          const activity = answer.locator('[data-turn-activity]');
          await activity.locator('.ss-act__summary').click();
          await activity.getByText('文献库 · search_items').first().waitFor();
        },
      );
    } finally {
      await temporary.cleanup();
    }
  },
);
