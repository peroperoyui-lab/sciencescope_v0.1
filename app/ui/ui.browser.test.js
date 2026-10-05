// The interface in a real browser against the real host with a scripted AI:
// a person creates a project, starts a meeting, asks a question, watches the
// answer stream in with its tool card, then finds the AI's plan on the
// workbench and undoes it. Skipped where no Chromium is installed.
//
// Set SCIENCESCOPE_SCREENSHOTS=<folder> to save screenshots of each view.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../app.js';
import { createScriptedRuntime } from '../runtime/scripted.js';
import { tempDir } from '../testing.js';

const CHROMIUM = [
  process.env.SCIENCESCOPE_CHROMIUM,
  '/opt/pw-browsers/chromium',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((candidate) => candidate && existsSync(candidate));
const SCREENSHOTS = process.env.SCIENCESCOPE_SCREENSHOTS;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import('../runtime/scripted.js').Script} */
async function* script({ instructions, call }) {
  const projectId = /（id：(prj_[a-z0-9]+)）/.exec(instructions)?.[1];
  yield '我先把这项工作';
  await pause(150);
  yield '记到计划里。';
  await call('workspace_edit', {
    resource: 'plans',
    key: projectId,
    op: 'append',
    args: { text: '- [ ] 清洗面板数据\n' },
  });
  yield '已记下：**清洗面板数据**。';
}

test(
  'a person meets the main expert in the interface and undoes its plan edit',
  {
    skip: CHROMIUM ? false : 'no Chromium found',
  },
  async () => {
    const { chromium } = await import('playwright-core');
    const { dir, cleanup } = await tempDir('ui');
    const app = await createApp({
      dataRoot: dir,
      token: 'ui-token',
      runtime: createScriptedRuntime({ script }),
      runtimeName: 'scripted',
    });
    const url = await app.listen();
    const browser = await chromium.launch({ executablePath: CHROMIUM });
    const shot = async (page, name) => {
      if (!SCREENSHOTS) return;
      await mkdir(SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) });
    };
    try {
      await app.core.workspace.edit(
        {
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'scripted', model: 'scripted' } } } },
        },
        {},
      );
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${url}/?token=ui-token`);
      await page.getByText('今天想研究什么？').waitFor();
      await shot(page, 'home');

      await page.getByRole('button', { name: '新建项目' }).click();
      await page.getByPlaceholder('项目名称').fill('城市就业韧性');
      await page.getByPlaceholder('项目名称').press('Enter');
      await page.getByText('项目计划').waitFor();

      await page.locator('.navproject').getByRole('button', { name: '项目操作' }).click();
      await page.getByRole('menuitem', { name: '新会议' }).click();
      await page.getByPlaceholder('输入问题或下一步工作…').fill('请把下一步记到计划里');
      await page.getByRole('button', { name: '发送' }).click();

      const answer = page.locator('.message.ai').last();
      await answer.getByText('已记下：').waitFor();
      assert.equal(await answer.locator('.tool .tag').textContent(), 'workspace_edit');
      assert.match(
        await answer.locator('.tool summary').textContent(),
        /我先把这项工作记到计划里。/,
      );
      assert.equal(await answer.locator('strong').textContent(), '清洗面板数据');
      await shot(page, 'meeting');

      await page.locator('.mainhead').getByRole('link', { name: '工作站' }).click();
      await page.locator('.plancard', { hasText: '清洗面板数据' }).waitFor();
      await shot(page, 'workbench');
      await page.locator('.changes').getByRole('button', { name: '撤销' }).first().click();
      await page.locator('.changes').getByText('已撤销').waitFor();
      assert.equal(await page.locator('.plancard', { hasText: '清洗面板数据' }).count(), 0);

      await page.getByRole('button', { name: 'English' }).click();
      await page.getByText('Project plans').waitFor();
      await shot(page, 'workbench-en');
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await app.close();
      await cleanup();
    }
  },
);
