import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { browserSkip, withBrowserApp } from './browser-testing.js';

test(
  'PDF preview has selectable text, page controls and citations jump to original page; code and CSV readers retain content',
  { skip: browserSkip },
  async () => {
    await withBrowserApp(
      'preview',
      async function* () {
        yield 'Evidence [S1 p.2]. Unknown [S1 appendix X].';
      },
      async ({ page, app, shot }) => {
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { models: { default: { provider: 'test', model: 'test' } } } },
        });
        const project = await app.core.projects.create({ name: '中文阅读器验证' });
        const meeting = app.core.meetings.create({
          projectId: project.id,
          members: [{ participantId: 'person_user' }, { participantId: 'agent_main' }],
        });
        const pdf = await PDFDocument.create();
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        for (const text of ['First page evidence', 'Second page: sample size 137'])
          pdf.addPage().drawText(text, { x: 40, y: 700, font, size: 14 });
        const source = await app.research.importSource({
          name: '中文论文.pdf',
          projectId: project.id,
          bytes: await pdf.save(),
        });
        const input = app.researchInput.change(meeting.id, {
          op: 'add',
          material: { id: source.id },
        });
        app.conductor.submit({
          meetingId: meeting.id,
          authorId: 'person_user',
          text: 'Read',
          researchInput: input,
        });
        await app.conductor.idle();
        await page.evaluate((id) => {
          location.hash = '#/meeting/' + id;
        }, meeting.id);
        await page.getByRole('button', { name: '[S1 p.2]', exact: true }).click();
        await page.locator('.file-preview-panel .page[data-page-number="2"] .textLayer').waitFor();
        await page.waitForFunction(() =>
          document
            .querySelector('.page[data-page-number="2"] .textLayer')
            ?.textContent.includes('sample size 137'),
        );
        assert.equal(await page.getByLabel('页码').inputValue(), '2');
        await page.getByLabel('页码').fill('1');
        await page.getByLabel('页码').dispatchEvent('change');
        await page.waitForFunction(() =>
          document
            .querySelector('.page[data-page-number="1"] .textLayer')
            ?.textContent.includes('First page'),
        );
        await shot('preview-pdf-zh');
        assert.match(
          await page.locator('.message-text').last().innerText(),
          /Unknown \[S1 appendix X\]/u,
        );
        await page.getByLabel('关闭侧栏').click();
        const csv = await app.research.importSource({
          name: '表格.csv',
          projectId: project.id,
          bytes: Buffer.from(Array.from({ length: 520 }, (_, i) => `${i},value`).join('\n')),
        });
        app.researchInput.change(meeting.id, { op: 'add', material: { id: csv.id } });
        await page
          .locator('.attachmentbar')
          .getByRole('button', { name: '表格.csv', exact: true })
          .click();
        await page.getByRole('menuitem', { name: '预览', exact: true }).click();
        await page.getByText('共 520 行，显示前 500 行', { exact: true }).waitFor();
        assert.equal(await page.locator('.file-preview-panel tbody tr').count(), 500);
        const code = await app.research.importSource({
          name: '代码.py',
          projectId: project.id,
          bytes: Buffer.from('def sample():\n    return 137'),
        });
        await page.getByLabel('关闭侧栏').click();
        app.researchInput.change(meeting.id, { op: 'add', material: { id: code.id } });
        await page
          .locator('.attachmentbar')
          .getByRole('button', { name: '代码.py', exact: true })
          .click();
        await page.getByRole('menuitem', { name: '预览', exact: true }).click();
        await page.locator('.file-preview-panel .cm-editor').waitFor();
        assert.match(await page.locator('.cm-content').innerText(), /return 137/u);
        assert.equal(await page.locator('.cm-content').getAttribute('contenteditable'), 'false');
        await app.core.workspace.edit({
          resource: 'settings',
          key: 'app',
          op: 'patch',
          args: { changes: { appearance: { language: 'en' } } },
        });
        await page.getByText('File preview and marks', { exact: true }).waitFor();
        await shot('preview-csv-en');
      },
    );
  },
);
